import { Router, type IRouter } from "express";
import { and, desc, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import {
  db,
  itemsTable,
  itemWarehouseStockTable,
  customersTable,
  suppliersTable,
  salesOrdersTable,
  salesOrderLinesTable,
  purchaseOrdersTable,
  warehousesTable,
  organizationsTable,
  stockMovementsTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { toNum } from "../lib/numeric";

const router: IRouter = Router();
router.use(tenantMiddleware);

// ─── Simple in-memory TTL cache for dashboard aggregations ─────────────────
// Dashboard summary runs 20+ heavy aggregation queries. A 60-second cache
// prevents re-computation on every page navigation without sacrificing accuracy
// for an ops tool where minute-level freshness is sufficient.
const DASHBOARD_CACHE_TTL_MS = 60_000;
interface DashboardCacheEntry {
  data: unknown;
  expiresAt: number;
}
const dashboardCache = new Map<string, DashboardCacheEntry>();

function getDashboardCacheKey(
  orgId: number,
  warehouseId: number | undefined,
  fromISO: string,
  toISO: string,
  paymentTermsDays: number,
): string {
  return `${orgId}:${warehouseId ?? "all"}:${fromISO}:${toISO}:pt${paymentTermsDays}`;
}
function getDashboardCache(key: string): unknown | null {
  const entry = dashboardCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    dashboardCache.delete(key);
    return null;
  }
  return entry.data;
}
function setDashboardCache(key: string, data: unknown): void {
  dashboardCache.set(key, { data, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS });
}

// We cap the failed-IRP feed on the dashboard so the panel stays a
// glanceable summary; tenants with more than this should drill into
// the sales-order list (which surfaces the same friendly "what to
// fix" guidance per row).
const FAILED_EINVOICES_LIMIT = 5;

router.get("/dashboard/summary", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgId = t.organizationId;

    // Optional warehouse filter — scopes stock metrics to a single location.
    let warehouseId: number | undefined;
    if (req.query.warehouseId !== undefined && req.query.warehouseId !== "") {
      const n = Number(req.query.warehouseId);
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: "warehouseId must be a positive integer" });
        return;
      }
      // Verify warehouse belongs to this org before using it.
      const whRows = await db
        .select({ id: warehousesTable.id })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.id, n),
            eq(warehousesTable.organizationId, orgId),
          ),
        )
        .limit(1);
      if (whRows.length === 0) {
        res.status(404).json({ error: "Warehouse not found" });
        return;
      }
      warehouseId = n;
    }

    // Optional date-range filter — scopes revenue, trend, and top-item queries.
    // Accepts ISO dates (YYYY-MM-DD). Defaults to the current calendar month.
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    let fromISO: string;
    let toISO: string;

    if (req.query.from && req.query.to) {
      const fromStr = String(req.query.from);
      const toStr = String(req.query.to);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
        res.status(400).json({ error: "from and to must be ISO dates (YYYY-MM-DD)" });
        return;
      }
      if (fromStr > toStr) {
        res.status(400).json({ error: "from must be on or before to" });
        return;
      }
      fromISO = fromStr;
      toISO = toStr;
    } else {
      const startOfMonth = new Date(todayDate);
      startOfMonth.setDate(1);
      fromISO = startOfMonth.toISOString().slice(0, 10);
      toISO = todayDate.toISOString().slice(0, 10);
    }

    // Compute the comparison (previous) period: same duration, shifted back by
    // one period so e.g. "This Month" compares against the prior calendar month.
    const fromDateMs = new Date(fromISO + "T00:00:00").getTime();
    const toDateMs   = new Date(toISO   + "T00:00:00").getTime();
    const periodDays = Math.round((toDateMs - fromDateMs) / 86_400_000) + 1;
    const prevToDate   = new Date(fromDateMs - 86_400_000); // day before fromISO
    const prevFromDate = new Date(prevToDate.getTime() - (periodDays - 1) * 86_400_000);
    const prevFromISO  = prevFromDate.toISOString().slice(0, 10);
    const prevToISO    = prevToDate.toISOString().slice(0, 10);

    // Fetch the org's configured payment terms so the overdue threshold is
    // accurate. This is a single-row PK lookup; hot-path cost is negligible.
    // Run it first (before the big parallel batch) because overdueThreshold
    // depends on paymentTermsDays for its WHERE clause.
    const orgRow = await db
      .select({ defaultPaymentTermsDays: organizationsTable.defaultPaymentTermsDays })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);
    const paymentTermsDays: number =
      (orgRow[0]?.defaultPaymentTermsDays as number | null | undefined) ?? 30;

    // Serve from cache if available (60s TTL).
    const cacheKey = getDashboardCacheKey(orgId, warehouseId, fromISO, toISO, paymentTermsDays);
    const cached = getDashboardCache(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    // Overdue threshold: orderDate < today - paymentTermsDays means the
    // derived dueDate (orderDate + terms) has already passed.
    const overdueThreshold = new Date();
    overdueThreshold.setDate(overdueThreshold.getDate() - paymentTermsDays);
    const thirtyDaysAgoISO = overdueThreshold.toISOString().slice(0, 10);

    // ── Fire all 24 aggregation queries in parallel ─────────────────────────
    // Previously these ran in ~8 sequential groups; running them all at once
    // reduces wall-clock time from Σ(query latencies) to max(query latency).
    const warehouseFilter = warehouseId !== undefined
      ? sql`AND iws.warehouse_id = ${warehouseId}`
      : sql``;

    const [
      itemsAggResult,
      stockAggResult,
      lowStockRowsResult,
      openSOResult,
      openPOResult,
      salesMonthResult,
      salesPrevMonthResult,
      purchasesMonthResult,
      purchasesPrevMonthResult,
      recvSnapshotPrevResult,
      paySnapshotPrevResult,
      newSOThisResult,
      newSOPrevResult,
      movementsSincePeriodStartResult,
      recvAggResult,
      overdueRecvAggResult,
      overduePayAggResult,
      payAggResult,
      dailySalesResult,
      dailyPurchasesResult,
      topItemsRowsResult,
      recentSOResult,
      recentPOResult,
      failedRowsResult,
    ] = await Promise.all([

      // 1. Total active items (optionally scoped to warehouse)
      db
        .select({
          totalItems: sql<string>`COUNT(DISTINCT ${itemsTable.id})`,
        })
        .from(itemsTable)
        .leftJoin(
          itemWarehouseStockTable,
          and(
            eq(itemWarehouseStockTable.itemId, itemsTable.id),
            warehouseId !== undefined
              ? eq(itemWarehouseStockTable.warehouseId, warehouseId)
              : undefined,
          ),
        )
        .where(
          and(
            eq(itemsTable.organizationId, orgId),
            sql`${itemsTable.archivedAt} IS NULL`,
            warehouseId !== undefined
              ? sql`${itemWarehouseStockTable.quantity} > 0`
              : undefined,
          ),
        ),

      // 2. Total stock value (excludes virtual/job-worker warehouses)
      db
        .select({
          totalValue: sql<string>`COALESCE(SUM(${itemWarehouseStockTable.quantity} * ${itemsTable.purchasePrice}), 0)`,
        })
        .from(itemWarehouseStockTable)
        .innerJoin(itemsTable, eq(itemsTable.id, itemWarehouseStockTable.itemId))
        .innerJoin(
          warehousesTable,
          and(
            eq(warehousesTable.id, itemWarehouseStockTable.warehouseId),
            eq(warehousesTable.isVirtual, false),
          ),
        )
        .where(
          and(
            eq(itemWarehouseStockTable.organizationId, orgId),
            sql`${itemsTable.archivedAt} IS NULL`,
            warehouseId !== undefined
              ? eq(itemWarehouseStockTable.warehouseId, warehouseId)
              : undefined,
          ),
        ),

      // 3. Low-stock rows — correlated subquery excludes virtual warehouses
      db
        .select({
          itemId: itemsTable.id,
          reorder: itemsTable.reorderLevel,
          onHand: sql<string>`COALESCE((
            SELECT SUM(iws.quantity)
            FROM item_warehouse_stock iws
            INNER JOIN warehouses w ON w.id = iws.warehouse_id AND w.is_virtual = false
            WHERE iws.item_id = "items"."id"
              AND iws.organization_id = ${orgId}
              ${warehouseFilter}
          ), 0)`,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, orgId),
            sql`${itemsTable.archivedAt} IS NULL`,
          ),
        ),

      // 4. Open sales orders
      db
        .select({ c: sql<string>`COUNT(*)` })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            sql`${salesOrdersTable.status} NOT IN ('delivered','cancelled')`,
          ),
        ),

      // 5. Open purchase orders
      db
        .select({ c: sql<string>`COUNT(*)` })
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, orgId),
            sql`${purchaseOrdersTable.status} NOT IN ('received','cancelled')`,
          ),
        ),

      // 6. Sales revenue — current period
      db
        .select({ s: sql<string>`COALESCE(SUM(${salesOrdersTable.total}), 0)` })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            gte(salesOrdersTable.orderDate, fromISO),
            lte(salesOrdersTable.orderDate, toISO),
          ),
        ),

      // 7. Sales revenue — previous period
      db
        .select({ s: sql<string>`COALESCE(SUM(${salesOrdersTable.total}), 0)` })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            gte(salesOrdersTable.orderDate, prevFromISO),
            lte(salesOrdersTable.orderDate, prevToISO),
          ),
        ),

      // 8. Purchase spend — current period
      db
        .select({ s: sql<string>`COALESCE(SUM(${purchaseOrdersTable.total}), 0)` })
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, orgId),
            gte(purchaseOrdersTable.orderDate, fromISO),
            lte(purchaseOrdersTable.orderDate, toISO),
          ),
        ),

      // 9. Purchase spend — previous period
      db
        .select({ s: sql<string>`COALESCE(SUM(${purchaseOrdersTable.total}), 0)` })
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, orgId),
            gte(purchaseOrdersTable.orderDate, prevFromISO),
            lte(purchaseOrdersTable.orderDate, prevToISO),
          ),
        ),

      // 10. Outstanding receivables snapshot as-of end of prior period
      db
        .select({ s: sql<string>`COALESCE(SUM(${salesOrdersTable.balanceDue}), 0)` })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            sql`${salesOrdersTable.status} NOT IN ('draft','cancelled')`,
            lte(salesOrdersTable.orderDate, prevToISO),
          ),
        ),

      // 11. Outstanding payables snapshot as-of end of prior period
      db
        .select({ s: sql<string>`COALESCE(SUM(${purchaseOrdersTable.balanceDue}), 0)` })
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, orgId),
            sql`${purchaseOrdersTable.status} NOT IN ('draft','cancelled')`,
            lte(purchaseOrdersTable.orderDate, prevToISO),
          ),
        ),

      // 12. New (non-cancelled) sales orders — current period
      db
        .select({ c: sql<string>`COUNT(*)` })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            sql`${salesOrdersTable.status} != 'cancelled'`,
            gte(salesOrdersTable.orderDate, fromISO),
            lte(salesOrdersTable.orderDate, toISO),
          ),
        ),

      // 13. New (non-cancelled) sales orders — previous period
      db
        .select({ c: sql<string>`COUNT(*)` })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            sql`${salesOrdersTable.status} != 'cancelled'`,
            gte(salesOrdersTable.orderDate, prevFromISO),
            lte(salesOrdersTable.orderDate, prevToISO),
          ),
        ),

      // 14. Net stock movements since period start (for low-stock prev-period delta)
      db
        .select({
          itemId: stockMovementsTable.itemId,
          delta: sql<string>`COALESCE(SUM(${stockMovementsTable.quantity}), 0)`,
        })
        .from(stockMovementsTable)
        .where(
          and(
            eq(stockMovementsTable.organizationId, orgId),
            gte(stockMovementsTable.createdAt, new Date(fromISO + "T00:00:00")),
            warehouseId !== undefined
              ? eq(stockMovementsTable.warehouseId, warehouseId)
              : undefined,
          ),
        )
        .groupBy(stockMovementsTable.itemId),

      // 15. Current outstanding receivables (all active SOs)
      db
        .select({
          s: sql<string>`COALESCE(SUM(${salesOrdersTable.balanceDue}), 0)`,
        })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            sql`${salesOrdersTable.status} NOT IN ('draft','cancelled')`,
          ),
        ),

      // 16. Overdue receivables
      db
        .select({
          s: sql<string>`COALESCE(SUM(${salesOrdersTable.balanceDue}), 0)`,
        })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            sql`${salesOrdersTable.status} IN ('confirmed','partially_shipped','shipped','delivered','invoiced')`,
            sql`${salesOrdersTable.balanceDue} > 0`,
            lt(salesOrdersTable.orderDate, thirtyDaysAgoISO),
          ),
        ),

      // 17. Overdue payables
      db
        .select({
          s: sql<string>`COALESCE(SUM(${purchaseOrdersTable.balanceDue}), 0)`,
        })
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, orgId),
            sql`${purchaseOrdersTable.status} IN ('ordered','partially_received','received','billed')`,
            sql`${purchaseOrdersTable.balanceDue} > 0`,
            lt(purchaseOrdersTable.orderDate, thirtyDaysAgoISO),
          ),
        ),

      // 18. Current outstanding payables (all active POs)
      db
        .select({
          s: sql<string>`COALESCE(SUM(${purchaseOrdersTable.balanceDue}), 0)`,
        })
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, orgId),
            sql`${purchaseOrdersTable.status} NOT IN ('draft','cancelled')`,
          ),
        ),

      // 19. Daily sales by orderDate (for revenue trend)
      db
        .select({
          d: salesOrdersTable.orderDate,
          s: sql<string>`COALESCE(SUM(${salesOrdersTable.total}), 0)`,
        })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            gte(salesOrdersTable.orderDate, fromISO),
            lte(salesOrdersTable.orderDate, toISO),
          ),
        )
        .groupBy(salesOrdersTable.orderDate),

      // 20. Daily purchases by orderDate (for revenue trend)
      db
        .select({
          d: purchaseOrdersTable.orderDate,
          s: sql<string>`COALESCE(SUM(${purchaseOrdersTable.total}), 0)`,
        })
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, orgId),
            gte(purchaseOrdersTable.orderDate, fromISO),
            lte(purchaseOrdersTable.orderDate, toISO),
          ),
        )
        .groupBy(purchaseOrdersTable.orderDate),

      // 21. Top 5 items by revenue in the selected period
      db
        .select({
          itemId: itemsTable.id,
          name: itemsTable.name,
          sku: itemsTable.sku,
          qty: sql<string>`COALESCE(SUM(${salesOrderLinesTable.quantity}), 0)`,
          revenue: sql<string>`COALESCE(SUM(${salesOrderLinesTable.lineTotal}), 0)`,
        })
        .from(salesOrderLinesTable)
        .innerJoin(itemsTable, eq(itemsTable.id, salesOrderLinesTable.itemId))
        .innerJoin(
          salesOrdersTable,
          eq(salesOrdersTable.id, salesOrderLinesTable.salesOrderId),
        )
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            gte(salesOrdersTable.orderDate, fromISO),
            lte(salesOrdersTable.orderDate, toISO),
          ),
        )
        .groupBy(itemsTable.id, itemsTable.name, itemsTable.sku)
        .orderBy(desc(sql`SUM(${salesOrderLinesTable.lineTotal})`))
        .limit(5),

      // 22. 5 most recent sales orders (for activity feed)
      db
        .select({
          id: salesOrdersTable.id,
          orderNumber: salesOrdersTable.orderNumber,
          total: salesOrdersTable.total,
          createdAt: salesOrdersTable.createdAt,
          customerName: customersTable.name,
        })
        .from(salesOrdersTable)
        .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
        .where(eq(salesOrdersTable.organizationId, orgId))
        .orderBy(desc(salesOrdersTable.createdAt))
        .limit(5),

      // 23. 5 most recent purchase orders (for activity feed)
      db
        .select({
          id: purchaseOrdersTable.id,
          orderNumber: purchaseOrdersTable.orderNumber,
          total: purchaseOrdersTable.total,
          createdAt: purchaseOrdersTable.createdAt,
          supplierName: suppliersTable.name,
        })
        .from(purchaseOrdersTable)
        .innerJoin(suppliersTable, eq(suppliersTable.id, purchaseOrdersTable.supplierId))
        .where(eq(purchaseOrdersTable.organizationId, orgId))
        .orderBy(desc(purchaseOrdersTable.createdAt))
        .limit(5),

      // 24. Failed IRP submissions (e-invoice errors)
      db
        .select({
          id: salesOrdersTable.id,
          orderNumber: salesOrdersTable.orderNumber,
          customerId: salesOrdersTable.customerId,
          customerName: customersTable.name,
          irpError: salesOrdersTable.irpError,
          irpErrorCode: salesOrdersTable.irpErrorCode,
          irpErrorContext: salesOrdersTable.irpErrorContext,
          updatedAt: salesOrdersTable.updatedAt,
        })
        .from(salesOrdersTable)
        .innerJoin(
          customersTable,
          eq(customersTable.id, salesOrdersTable.customerId),
        )
        .where(
          and(
            eq(salesOrdersTable.organizationId, orgId),
            eq(salesOrdersTable.irpStatus, "failed"),
            isNotNull(salesOrdersTable.irpError),
          ),
        )
        .orderBy(desc(salesOrdersTable.updatedAt))
        .limit(FAILED_EINVOICES_LIMIT),
    ]);

    // ── Derive scalar values from query results ──────────────────────────────

    const totalItems      = Number(itemsAggResult[0]?.totalItems ?? 0);
    const totalStockValue = toNum(stockAggResult[0]?.totalValue);

    // Only flag an item as low-stock when it has an explicit reorder level and
    // on-hand stock has dropped to or below that level.
    const lowStockCount = lowStockRowsResult.filter(
      (r) => toNum(r.reorder) > 0 && toNum(r.onHand) <= toNum(r.reorder),
    ).length;

    const openSalesOrders    = Number(openSOResult[0]?.c ?? 0);
    const openPurchaseOrders = Number(openPOResult[0]?.c ?? 0);

    const salesThisMonth      = toNum(salesMonthResult[0]?.s);
    const salesPrevPeriod     = toNum(salesPrevMonthResult[0]?.s);
    const purchasesThisMonth  = toNum(purchasesMonthResult[0]?.s);
    const purchasesPrevPeriod = toNum(purchasesPrevMonthResult[0]?.s);

    const receivablesPrevPeriod = toNum(recvSnapshotPrevResult[0]?.s);
    const payablesPrevPeriod    = toNum(paySnapshotPrevResult[0]?.s);

    const newSalesOrdersThisPeriod = Number(newSOThisResult[0]?.c ?? 0);
    const newSalesOrdersPrevPeriod = Number(newSOPrevResult[0]?.c ?? 0);

    // Build item → period-delta map then compute low-stock count as of prevToISO.
    const movementDeltaByItem = new Map<number, number>();
    for (const row of movementsSincePeriodStartResult) {
      movementDeltaByItem.set(row.itemId, toNum(row.delta));
    }
    const lowStockCountPrevPeriod = lowStockRowsResult.filter((r) => {
      const currentOnHand = toNum(r.onHand);
      const delta = movementDeltaByItem.get(r.itemId) ?? 0;
      const prevOnHand = currentOnHand - delta;
      return toNum(r.reorder) > 0 && prevOnHand <= toNum(r.reorder);
    }).length;

    const outstandingReceivables = toNum(recvAggResult[0]?.s);
    const overdueReceivables     = toNum(overdueRecvAggResult[0]?.s);
    const overduePayables        = toNum(overduePayAggResult[0]?.s);
    const outstandingPayables    = toNum(payAggResult[0]?.s);

    // ── Build daily trend series ─────────────────────────────────────────────
    const trendMap = new Map<string, { sales: number; purchases: number }>();
    const trendCursor = new Date(fromISO + "T00:00:00Z");
    const trendEnd = new Date(toISO + "T00:00:00Z");
    while (trendCursor <= trendEnd) {
      trendMap.set(trendCursor.toISOString().slice(0, 10), { sales: 0, purchases: 0 });
      trendCursor.setUTCDate(trendCursor.getUTCDate() + 1);
    }
    for (const row of dailySalesResult) {
      const e = trendMap.get(row.d);
      if (e) e.sales = toNum(row.s);
    }
    for (const row of dailyPurchasesResult) {
      const e = trendMap.get(row.d);
      if (e) e.purchases = toNum(row.s);
    }
    const salesTrend = Array.from(trendMap.entries()).map(([date, v]) => ({
      date,
      sales: v.sales,
      purchases: v.purchases,
    }));

    // ── Top selling items ────────────────────────────────────────────────────
    const topItems = topItemsRowsResult.map((r) => ({
      itemId: r.itemId,
      name: r.name,
      sku: r.sku,
      quantitySold: toNum(r.qty),
      revenue: toNum(r.revenue),
    }));

    // ── Recent activity feed (merge SO + PO, newest first) ──────────────────
    const recentActivity = [
      ...recentSOResult.map((r) => ({
        id: `so-${r.id}`,
        kind: "sales_order",
        title: r.orderNumber,
        subtitle: r.customerName,
        amount: toNum(r.total),
        timestamp: r.createdAt.toISOString(),
      })),
      ...recentPOResult.map((r) => ({
        id: `po-${r.id}`,
        kind: "purchase_order",
        title: r.orderNumber,
        subtitle: r.supplierName,
        amount: toNum(r.total),
        timestamp: r.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 8);

    // ── Failed e-invoices ────────────────────────────────────────────────────
    const failedEinvoices = failedRowsResult.map((r) => ({
      salesOrderId: r.id,
      orderNumber: r.orderNumber,
      customerId: r.customerId,
      customerName: r.customerName,
      errorCode: r.irpErrorCode,
      errorContext:
        r.irpErrorContext &&
        typeof r.irpErrorContext === "object" &&
        !Array.isArray(r.irpErrorContext)
          ? (r.irpErrorContext as Record<string, unknown>)
          : null,
      error: r.irpError,
      updatedAt: r.updatedAt.toISOString(),
    }));

    const payload = {
      totalItems,
      totalStockValue,
      lowStockCount,
      lowStockCountPrevPeriod,
      openSalesOrders,
      openPurchaseOrders,
      newSalesOrdersThisPeriod,
      newSalesOrdersPrevPeriod,
      salesThisMonth,
      salesPrevPeriod,
      purchasesThisMonth,
      purchasesPrevPeriod,
      outstandingReceivables,
      overdueReceivables,
      outstandingPayables,
      overduePayables,
      receivablesPrevPeriod,
      payablesPrevPeriod,
      prevFromISO,
      prevToISO,
      salesTrend,
      topItems,
      recentActivity,
      failedEinvoices,
    };
    setDashboardCache(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
