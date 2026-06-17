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
// Dashboard summary runs 10+ heavy aggregation queries. A 60-second cache
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

    // Fetch the org's configured payment terms so the overdue threshold is
    // accurate. This is a single-row PK lookup; hot-path cost is negligible.
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

    const itemsAgg = await db
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
      );
    const totalItems = Number(itemsAgg[0]?.totalItems ?? 0);

    const stockWhere = and(
      eq(itemWarehouseStockTable.organizationId, orgId),
      sql`${itemsTable.archivedAt} IS NULL`,
      warehouseId !== undefined
        ? eq(itemWarehouseStockTable.warehouseId, warehouseId)
        : undefined,
    );
    // Exclude virtual (job-worker) warehouses from the inventory valuation:
    // stock at a supplier inflates the book value shown on the dashboard.
    const stockAgg = await db
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
      .where(stockWhere);
    const totalStockValue = toNum(stockAgg[0]?.totalValue);

    // Use a correlated subquery so virtual (job-worker) warehouses are excluded
    // from the on-hand total.  Stock held at a supplier must not suppress
    // genuine low-stock alerts for items that are physically empty.
    const warehouseFilter = warehouseId !== undefined
      ? sql`AND iws.warehouse_id = ${warehouseId}`
      : sql``;
    const lowStockRows = await db
      .select({
        itemId: itemsTable.id,
        reorder: itemsTable.reorderLevel,
        // Use "items"."id" (table-qualified) inside the correlated subquery
        // because Drizzle's sql`` helper strips the table prefix when
        // interpolating a column reference, making plain ${itemsTable.id}
        // resolve to the ambiguous bare column name "id".
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
      );
    const lowStockCount = lowStockRows.filter(
      (r) => toNum(r.onHand) <= 0 || (toNum(r.reorder) > 0 && toNum(r.onHand) <= toNum(r.reorder)),
    ).length;

    const openSO = await db
      .select({ c: sql<string>`COUNT(*)` })
      .from(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.organizationId, orgId),
          sql`${salesOrdersTable.status} NOT IN ('delivered','cancelled')`,
        ),
      );
    const openSalesOrders = Number(openSO[0]?.c ?? 0);

    const openPO = await db
      .select({ c: sql<string>`COUNT(*)` })
      .from(purchaseOrdersTable)
      .where(
        and(
          eq(purchaseOrdersTable.organizationId, orgId),
          sql`${purchaseOrdersTable.status} NOT IN ('received','cancelled')`,
        ),
      );
    const openPurchaseOrders = Number(openPO[0]?.c ?? 0);

    // Compute the comparison (previous) period: same duration, shifted back by
    // one period so e.g. "This Month" compares against the prior calendar month.
    const fromDateMs = new Date(fromISO + "T00:00:00").getTime();
    const toDateMs   = new Date(toISO   + "T00:00:00").getTime();
    const periodDays = Math.round((toDateMs - fromDateMs) / 86_400_000) + 1;
    const prevToDate   = new Date(fromDateMs - 86_400_000); // day before fromISO
    const prevFromDate = new Date(prevToDate.getTime() - (periodDays - 1) * 86_400_000);
    const prevFromISO  = prevFromDate.toISOString().slice(0, 10);
    const prevToISO    = prevToDate.toISOString().slice(0, 10);

    // Revenue for the selected period (from → to, inclusive) and the prior period.
    // Also snapshot receivables/payables outstanding as-of end of prior period.
    const [salesMonth, salesPrevMonth, purchasesMonth, purchasesPrevMonth,
           recvSnapshotPrev, paySnapshotPrev] =
      await Promise.all([
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
        // Snapshot of outstanding receivables as-of end of prior period:
        // sum of balance_due on all non-draft/cancelled SOs whose orderDate falls
        // on or before prevToISO. This gives a like-for-like comparison against
        // the current outstandingReceivables (which has no date cap), using the
        // same balanceDue values — the best proxy available without event-sourcing.
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
        // Same snapshot for payables.
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
      ]);
    const salesThisMonth    = toNum(salesMonth[0]?.s);
    const salesPrevPeriod   = toNum(salesPrevMonth[0]?.s);
    const purchasesThisMonth  = toNum(purchasesMonth[0]?.s);
    const purchasesPrevPeriod = toNum(purchasesPrevMonth[0]?.s);
    const receivablesPrevPeriod = toNum(recvSnapshotPrev[0]?.s);
    const payablesPrevPeriod    = toNum(paySnapshotPrev[0]?.s);

    // New (opened) sales orders in each period — counts non-cancelled SOs whose
    // orderDate falls within the selected and comparison windows respectively.
    // Low-stock prev-period count: reconstruct stock-at-prevToISO by subtracting
    // net stock movements that occurred since the start of the current period
    // from the current on-hand values already fetched in lowStockRows.
    const [newSOThis, newSOPrev, movementsSincePeriodStart] = await Promise.all([
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
      // Net quantity moved per item since period start (inclusive). Subtracting
      // this from current on-hand gives the approximate stock-at-prevToISO.
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
    ]);
    const newSalesOrdersThisPeriod = Number(newSOThis[0]?.c ?? 0);
    const newSalesOrdersPrevPeriod = Number(newSOPrev[0]?.c ?? 0);

    // Build item → period-delta map then compute low-stock count as of prevToISO.
    const movementDeltaByItem = new Map<number, number>();
    for (const row of movementsSincePeriodStart) {
      movementDeltaByItem.set(row.itemId, toNum(row.delta));
    }
    const lowStockCountPrevPeriod = lowStockRows.filter((r) => {
      const currentOnHand = toNum(r.onHand);
      const delta = movementDeltaByItem.get(r.itemId) ?? 0;
      const prevOnHand = currentOnHand - delta;
      return prevOnHand <= 0 || (toNum(r.reorder) > 0 && prevOnHand <= toNum(r.reorder));
    }).length;

    // Derive receivables from open sales orders' balance_due rather
    // than reading the cached customers.outstanding_balance column —
    // that column can drift if a payment / cancellation path forgot
    // to decrement it. The actual liability is the sum of balances
    // on every non-draft, non-cancelled SO.
    const recvAgg = await db
      .select({
        s: sql<string>`COALESCE(SUM(${salesOrdersTable.balanceDue}), 0)`,
      })
      .from(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.organizationId, orgId),
          sql`${salesOrdersTable.status} NOT IN ('draft','cancelled')`,
        ),
      );
    const outstandingReceivables = toNum(recvAgg[0]?.s);

    // Overdue receivables: sales orders in a payable status whose derived
    // due date has passed. Since the schema has no explicit dueDate column,
    // we derive: dueDate = orderDate + paymentTermsDays, so
    // dueDate < today ⟺ orderDate < today - paymentTermsDays.
    // Payable statuses mirror the AR aging report in reports.ts.
    const overdueThreshold = new Date();
    overdueThreshold.setDate(overdueThreshold.getDate() - paymentTermsDays);
    const thirtyDaysAgoISO = overdueThreshold.toISOString().slice(0, 10);
    const overdueRecvAgg = await db
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
      );
    const overdueReceivables = toNum(overdueRecvAgg[0]?.s);

    // Overdue payables: purchase orders in a payable status whose derived
    // due date has passed. Mirrors the overdueReceivables logic above.
    const overduePayAgg = await db
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
      );
    const overduePayables = toNum(overduePayAgg[0]?.s);

    // Same derivation for payables: sum balance_due on every
    // non-draft, non-cancelled PO.
    const payAgg = await db
      .select({
        s: sql<string>`COALESCE(SUM(${purchaseOrdersTable.balanceDue}), 0)`,
      })
      .from(purchaseOrdersTable)
      .where(
        and(
          eq(purchaseOrdersTable.organizationId, orgId),
          sql`${purchaseOrdersTable.status} NOT IN ('draft','cancelled')`,
        ),
      );
    const outstandingPayables = toNum(payAgg[0]?.s);

    // Build daily trend series for the selected date range.
    const dailySales = await db
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
      .groupBy(salesOrdersTable.orderDate);

    const dailyPurchases = await db
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
      .groupBy(purchaseOrdersTable.orderDate);

    // Fill every day in [fromISO, toISO] with zeros, then overlay actuals.
    const trendMap = new Map<string, { sales: number; purchases: number }>();
    const trendCursor = new Date(fromISO + "T00:00:00Z");
    const trendEnd = new Date(toISO + "T00:00:00Z");
    while (trendCursor <= trendEnd) {
      trendMap.set(trendCursor.toISOString().slice(0, 10), { sales: 0, purchases: 0 });
      trendCursor.setUTCDate(trendCursor.getUTCDate() + 1);
    }
    for (const row of dailySales) {
      const e = trendMap.get(row.d);
      if (e) e.sales = toNum(row.s);
    }
    for (const row of dailyPurchases) {
      const e = trendMap.get(row.d);
      if (e) e.purchases = toNum(row.s);
    }
    const salesTrend = Array.from(trendMap.entries()).map(([date, v]) => ({
      date,
      sales: v.sales,
      purchases: v.purchases,
    }));

    const topItemsRows = await db
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
      .limit(5);
    const topItems = topItemsRows.map((r) => ({
      itemId: r.itemId,
      name: r.name,
      sku: r.sku,
      quantitySold: toNum(r.qty),
      revenue: toNum(r.revenue),
    }));

    const recentSO = await db
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
      .limit(5);

    const recentPO = await db
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
      .limit(5);

    const recentActivity = [
      ...recentSO.map((r) => ({
        id: `so-${r.id}`,
        kind: "sales_order",
        title: r.orderNumber,
        subtitle: r.customerName,
        amount: toNum(r.total),
        timestamp: r.createdAt.toISOString(),
      })),
      ...recentPO.map((r) => ({
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

    // Failed IRP submissions surfaced on the dashboard with the same
    // friendly "what to fix" treatment as the SalesOrderDetail panel.
    // We rely on `irpStatus = 'failed'` (set by the single-order route
    // and the bulk worker) and ignore rows without an error message —
    // there's nothing actionable to show without one.
    const failedRows = await db
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
      .limit(FAILED_EINVOICES_LIMIT);
    const failedEinvoices = failedRows.map((r) => ({
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
