import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  db,
  salesOrdersTable,
  salesOrderLinesTable,
  shipmentLinesTable,
  shipmentsTable,
  customerPaymentAllocationsTable,
  customersTable,
  warehousesTable,
  itemsTable,
  itemWarehouseStockTable,
  stockMovementsTable,
  emailLogTable,
  itemBundleComponentsTable,
  organizationsTable,
} from "@workspace/db";
import { tenantMiddleware, assertOwnership, findParentItems } from "../lib/tenant";
import {
  serializeSalesOrder,
  serializeOrderLine,
  serializeEmailLog,
} from "../lib/serializers";
import { computeOrderTotals, nextOrderNumber } from "../lib/orderHelpers";
import { toNum, toStr } from "../lib/numeric";
import { pushStockToShopify } from "../lib/shopifyOutbound";
import { loadShipmentsForOrder } from "./shipments";
import { loadInvoiceForOrder } from "../lib/invoiceData";
import { sendEmail, EmailNotConfiguredError } from "../lib/email";
import { signInvoiceUrl } from "../lib/invoiceLinks";
import { getActivePaymentLink } from "./paymentLinks";
import { logger } from "../lib/logger";
import { tryAutoGenerateIrn } from "./einvoice";

// `shipped` and `partially_shipped` are derived server-side from
// recorded shipments — clients cannot set them directly via PATCH /status.
const PATCHABLE_SALES_STATUSES = [
  "draft",
  "confirmed",
  "delivered",
  "invoiced",
  "paid",
  "cancelled",
] as const;
type PatchableSalesStatus = (typeof PATCHABLE_SALES_STATUSES)[number];
function isPatchableSalesStatus(s: string): s is PatchableSalesStatus {
  return (PATCHABLE_SALES_STATUSES as readonly string[]).includes(s);
}

const router: IRouter = Router();
router.use(tenantMiddleware);

router.get("/sales-orders", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const conds = [eq(salesOrdersTable.organizationId, t.organizationId)];
    if (req.query.overdue === "true") {
      // Overdue = payable status + balance > 0 + orderDate older than org's payment terms.
      const orgRow = await db
        .select({ defaultPaymentTermsDays: organizationsTable.defaultPaymentTermsDays })
        .from(organizationsTable) // org-scope-allow: single-org fetch by tenant id
        .where(eq(organizationsTable.id, t.organizationId))
        .limit(1);
      const ptDays = (orgRow[0]?.defaultPaymentTermsDays as number | null | undefined) ?? 30;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoffDate = new Date(today.getTime() - ptDays * 86_400_000);
      const cutoffISO = cutoffDate.toISOString().slice(0, 10);
      conds.push(inArray(salesOrdersTable.status, ["confirmed", "partially_shipped", "shipped", "delivered", "invoiced"]));
      conds.push(sql`${salesOrdersTable.balanceDue} > 0`);
      conds.push(lt(salesOrdersTable.orderDate, cutoffISO));
    } else if (req.query.status) {
      const rawStatus = String(req.query.status);
      if (rawStatus === "outstanding") {
        conds.push(inArray(salesOrdersTable.status, ["confirmed", "partially_shipped", "shipped", "delivered", "invoiced"]));
      } else {
        conds.push(eq(salesOrdersTable.status, rawStatus));
      }
    }
    if (req.query.customerId)
      conds.push(eq(salesOrdersTable.customerId, Number(req.query.customerId)));
    // Inclusive date range on orderDate (YYYY-MM-DD strings sort
    // lexicographically the same as chronologically, so plain
    // gte/lte on the `date` column is correct).
    if (req.query.from) {
      conds.push(gte(salesOrdersTable.orderDate, String(req.query.from)));
    }
    if (req.query.to) {
      conds.push(lte(salesOrdersTable.orderDate, String(req.query.to)));
    }
    // POS counter sales always have `stockAppliedAt` set (posCheckout
    // writes it on creation). This is the durable POS marker — it
    // survives order-number prefix changes (e.g. custom bill prefixes)
    // and notes edits without a schema migration.
    if (req.query.orderType === "pos") {
      conds.push(isNotNull(salesOrdersTable.stockAppliedAt));
    } else if (req.query.orderType === "sales_order") {
      conds.push(isNull(salesOrdersTable.stockAppliedAt));
    }
    // Full-text search across order number and customer name.
    // The join on customersTable is always present so customerName is safe.
    if (req.query.search) {
      const s = `%${String(req.query.search).trim()}%`;
      conds.push(
        or(
          ilike(salesOrdersTable.orderNumber, s),
          ilike(customersTable.name, s),
        )!,
      );
    }
    // Sale channel filter — channel is stored in notes as "Channel: <Label>\n..."
    // so we use ILIKE on notes rather than a dedicated column.
    if (req.query.channel && typeof req.query.channel === "string") {
      const CHANNEL_TO_LABEL: Record<string, string> = {
        walkin: "Walk-in",
        website: "Website",
        store: "Store",
        whatsapp: "WhatsApp",
        phone: "Phone",
        instagram: "Instagram",
        other: "Other",
        pos: "POS",
      };
      const label = CHANNEL_TO_LABEL[req.query.channel];
      if (label) {
        conds.push(ilike(salesOrdersTable.notes, `Channel: ${label}%`));
      }
    }

    // Sort — sortBy: "date" (default) | "created" | "total"; sortDir: "desc" (default) | "asc"
    const sortDirParam = req.query.sortDir === "asc" ? "asc" : "desc";
    const sortByParam = String(req.query.sortBy ?? "date");
    const sortCol =
      sortByParam === "total"
        ? salesOrdersTable.total
        : sortByParam === "created"
          ? salesOrdersTable.createdAt
          : salesOrdersTable.orderDate;
    const orderExpr = sortDirParam === "asc" ? asc(sortCol) : desc(sortCol);

    // Pagination — only activated when `page` is explicitly supplied.
    // Omitting it falls back to the legacy array shape for backward
    // compatibility with detail-page hooks that don't need paging.
    const rawPage = req.query.page !== undefined ? Number(req.query.page) : null;
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 15)));

    const selectShape = {
      order: salesOrdersTable,
      customerName: customersTable.name,
      customerGstNumber: customersTable.gstNumber,
      warehouseName: warehousesTable.name,
      discountTotal: sql<string>`(
        SELECT COALESCE(SUM(sol.discount_amount), 0)
        FROM sales_order_lines sol
        WHERE sol.sales_order_id = ${salesOrdersTable.id}
      )`,
      cashPaid: sql<string>`(
        SELECT COALESCE(SUM(cpa.amount), 0)
        FROM customer_payment_allocations cpa
        JOIN customer_payments cp ON cp.id = cpa.payment_id
        WHERE cpa.sales_order_id = ${salesOrdersTable.id}
        AND cp.mode = 'cash'
      )`,
      upiPaid: sql<string>`(
        SELECT COALESCE(SUM(cpa.amount), 0)
        FROM customer_payment_allocations cpa
        JOIN customer_payments cp ON cp.id = cpa.payment_id
        WHERE cpa.sales_order_id = ${salesOrdersTable.id}
        AND cp.mode = 'upi'
      )`,
      cardPaid: sql<string>`(
        SELECT COALESCE(SUM(cpa.amount), 0)
        FROM customer_payment_allocations cpa
        JOIN customer_payments cp ON cp.id = cpa.payment_id
        WHERE cpa.sales_order_id = ${salesOrdersTable.id}
        AND cp.mode = 'card'
      )`,
    };

    const serializeRow = (r: {
      order: typeof salesOrdersTable.$inferSelect;
      customerName: string;
      customerGstNumber: string | null;
      warehouseName: string;
      discountTotal: string;
      cashPaid: string;
      upiPaid: string;
      cardPaid: string;
    }) => ({
      ...serializeSalesOrder(
        r.order,
        r.customerName,
        r.warehouseName,
        r.customerGstNumber,
        r.discountTotal,
      ),
      cashPaid: Number(r.cashPaid),
      upiPaid: Number(r.upiPaid),
      cardPaid: Number(r.cardPaid),
    });

    if (rawPage !== null && !Number.isNaN(rawPage)) {
      const page = Math.max(1, rawPage);
      const [countRows, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(salesOrdersTable)
          .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
          .innerJoin(warehousesTable, eq(warehousesTable.id, salesOrdersTable.warehouseId))
          .where(and(...conds)),
        db
          .select(selectShape)
          .from(salesOrdersTable)
          .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
          .innerJoin(warehousesTable, eq(warehousesTable.id, salesOrdersTable.warehouseId))
          .where(and(...conds))
          .orderBy(orderExpr)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);
      res.json({
        orders: rows.map(serializeRow),
        total: Number(countRows[0]?.total ?? 0),
        page,
        pageSize,
      });
      return;
    }

    // Legacy: return plain array (backward-compat for hooks that don't paginate).
    const rows = await db
      .select(selectShape)
      .from(salesOrdersTable)
      .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
      .innerJoin(
        warehousesTable,
        eq(warehousesTable.id, salesOrdersTable.warehouseId),
      )
      .where(and(...conds))
      .orderBy(orderExpr);
    res.json(rows.map(serializeRow));
  } catch (err) {
    next(err);
  }
});

async function loadDetail(orgId: number, orderId: number) {
  const orderRows = await db
    .select({
      order: salesOrdersTable,
      customerName: customersTable.name,
      customerPhone: customersTable.phone,
      customerGstNumber: customersTable.gstNumber,
      warehouseName: warehousesTable.name,
      cashPaid: sql<string>`(
        SELECT COALESCE(SUM(cpa.amount), 0)
        FROM customer_payment_allocations cpa
        JOIN customer_payments cp ON cp.id = cpa.payment_id
        WHERE cpa.sales_order_id = ${salesOrdersTable.id}
        AND cp.mode = 'cash'
      )`,
      upiPaid: sql<string>`(
        SELECT COALESCE(SUM(cpa.amount), 0)
        FROM customer_payment_allocations cpa
        JOIN customer_payments cp ON cp.id = cpa.payment_id
        WHERE cpa.sales_order_id = ${salesOrdersTable.id}
        AND cp.mode = 'upi'
      )`,
      cardPaid: sql<string>`(
        SELECT COALESCE(SUM(cpa.amount), 0)
        FROM customer_payment_allocations cpa
        JOIN customer_payments cp ON cp.id = cpa.payment_id
        WHERE cpa.sales_order_id = ${salesOrdersTable.id}
        AND cp.mode = 'card'
      )`,
    })
    .from(salesOrdersTable)
    .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
    .innerJoin(warehousesTable, eq(warehousesTable.id, salesOrdersTable.warehouseId))
    .where(
      and(eq(salesOrdersTable.id, orderId), eq(salesOrdersTable.organizationId, orgId)),
    )
    .limit(1);
  if (!orderRows[0]) return null;
  const lineRows = await db
    .select({
      line: salesOrderLinesTable,
      itemName: itemsTable.name,
      sku: itemsTable.sku,
      variantOptions: itemsTable.variantOptions,
      trackBatches: itemsTable.trackBatches,
    })
    .from(salesOrderLinesTable)
    .innerJoin(itemsTable, eq(itemsTable.id, salesOrderLinesTable.itemId))
    .where(eq(salesOrderLinesTable.salesOrderId, orderId));
  const shipments = await loadShipmentsForOrder(orgId, orderId);
  const discountTotal = lineRows.reduce(
    (sum, r) => sum + toNum(r.line.discountAmount ?? "0"),
    0,
  );
  return {
    order: {
      ...serializeSalesOrder(
        orderRows[0].order,
        orderRows[0].customerName,
        orderRows[0].warehouseName,
        orderRows[0].customerGstNumber,
        discountTotal,
      ),
      cashPaid: Number(orderRows[0].cashPaid),
      upiPaid: Number(orderRows[0].upiPaid),
      cardPaid: Number(orderRows[0].cardPaid),
    },
    customerPhone: (() => {
      if (orderRows[0].customerPhone) return orderRows[0].customerPhone;
      const notes = orderRows[0].order.notes ?? "";
      const m = notes.match(/Walk-in:[^(]*\((\d{5,15})\)/) ?? notes.match(/Walk-in:\s*(\d{5,15})\b/);
      return m ? m[1] : null;
    })(),
    lines: lineRows.map((r) =>
      serializeOrderLine(
        r.line,
        r.itemName,
        r.sku,
        (r.variantOptions as Record<string, string> | null) ?? null,
        !!r.trackBatches,
      ),
    ),
    shipments,
  };
}

router.post("/sales-orders", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const b = req.body ?? {};
    if (!b.customerId || !b.warehouseId || !b.orderDate || !Array.isArray(b.lines) || b.lines.length === 0) {
      res.status(400).json({ error: "customerId, warehouseId, orderDate and lines are required" });
      return;
    }
    const itemIds = b.lines
      .map((l: { itemId: number }) => Number(l.itemId))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    if (itemIds.length !== b.lines.length) {
      res.status(400).json({ error: "Every line must include itemId" });
      return;
    }
    const own = await assertOwnership({
      organizationId: t.organizationId,
      customerIds: [Number(b.customerId)],
      warehouseIds: [Number(b.warehouseId)],
      itemIds,
    });
    if (!own.ok) {
      res.status(400).json({ error: `Invalid ${own.missing}` });
      return;
    }
    const parents = await findParentItems(t.organizationId, itemIds);
    if (parents.length > 0) {
      res.status(400).json({
        error: `Cannot use parent items on a sales order. Pick a variant instead. Offending: ${parents
          .map((p) => p.sku)
          .join(", ")}`,
      });
      return;
    }
    const totals = computeOrderTotals(b.lines);
    const rawOrderDisc =
      b.orderDiscountAmount != null && Number.isFinite(Number(b.orderDiscountAmount))
        ? Math.max(0, Number(b.orderDiscountAmount))
        : 0;
    const effectiveTotal = Math.max(0, Number(totals.total) - rawOrderDisc).toFixed(2);
    const order = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(salesOrdersTable)
        .values({
          organizationId: t.organizationId,
          orderNumber: nextOrderNumber("SO"),
          customerId: b.customerId,
          warehouseId: b.warehouseId,
          status: "draft",
          orderDate: b.orderDate,
          expectedShipDate: b.expectedShipDate ?? null,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          total: effectiveTotal,
          amountPaid: "0",
          balanceDue: effectiveTotal,
          notes: b.notes ?? null,
        })
        .returning();
      if (totals.lines.length > 0) {
        await tx.insert(salesOrderLinesTable).values(
          totals.lines.map((l) => ({
            salesOrderId: inserted!.id,
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            discountPercent: l.discountPercent,
            discountAmount: l.discountAmount,
            lineSubtotal: l.lineSubtotal,
            lineTax: l.lineTax,
            lineTotal: l.lineTotal,
          })),
        );
      }
      return inserted!;
    });
    const detail = await loadDetail(t.organizationId, order.id);
    res.status(201).json(detail);
  } catch (err) {
    next(err);
  }
});

router.get("/sales-orders/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const detail = await loadDetail(t.organizationId, Number(req.params.id));
    if (!detail) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.patch("/sales-orders/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const orderRows = await db
      .select()
      .from(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.id, id),
          eq(salesOrdersTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    const existing = orderRows[0];
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!["draft", "confirmed", "invoiced", "paid"].includes(existing.status)) {
      res.status(400).json({
        error: "Only draft, confirmed, invoiced, or paid orders can be edited.",
      });
      return;
    }
    const b = req.body ?? {};
    const customerId = b.customerId ? Number(b.customerId) : existing.customerId;
    const warehouseId = b.warehouseId ? Number(b.warehouseId) : existing.warehouseId;
    const itemIds = Array.isArray(b.lines)
      ? b.lines.map((l: { itemId: number }) => Number(l.itemId))
      : [];
    const own = await assertOwnership({
      organizationId: t.organizationId,
      customerIds: b.customerId ? [customerId] : undefined,
      warehouseIds: b.warehouseId ? [warehouseId] : undefined,
      itemIds: itemIds.length ? itemIds : undefined,
    });
    if (!own.ok) {
      res.status(400).json({ error: `Invalid ${own.missing}` });
      return;
    }
    if (itemIds.length) {
      const parents = await findParentItems(t.organizationId, itemIds);
      if (parents.length > 0) {
        res.status(400).json({
          error: `Cannot use parent items on a sales order. Pick a variant instead. Offending: ${parents
            .map((p) => p.sku)
            .join(", ")}`,
        });
        return;
      }
    }

    const update: Partial<typeof salesOrdersTable.$inferInsert> = {
      customerId,
      warehouseId,
      orderDate: b.orderDate ? String(b.orderDate) : existing.orderDate,
      expectedShipDate:
        b.expectedShipDate === undefined
          ? existing.expectedShipDate
          : b.expectedShipDate
            ? String(b.expectedShipDate)
            : null,
      notes: b.notes === undefined ? existing.notes : b.notes,
    };

    if (Array.isArray(b.lines)) {
      const totals = computeOrderTotals(b.lines);
      // Apply an optional order-level discount (e.g. preserved from a POS
      // checkout where an order-level discount was applied on top of line
      // discounts). Clamp to [0, lineTotal].
      const rawOrderDisc =
        b.orderDiscountAmount != null && Number.isFinite(Number(b.orderDiscountAmount))
          ? Math.max(0, Number(b.orderDiscountAmount))
          : 0;
      const lineTotal = Number(totals.total);
      const effectiveTotal = Math.max(0, lineTotal - rawOrderDisc).toFixed(2);
      update.subtotal = totals.subtotal;
      update.taxTotal = totals.taxTotal;
      update.total = effectiveTotal;
      // Recalculate balanceDue as newTotal - existing amountPaid so
      // invoiced/paid orders keep their payment records intact.
      const alreadyPaid = Number(existing.amountPaid ?? "0");
      const newTotal = Number(effectiveTotal);
      const newBalance = Math.max(0, newTotal - alreadyPaid).toFixed(2);
      update.amountPaid = existing.amountPaid;
      update.balanceDue = newBalance;

      // Keep paymentStatus in sync with the new balance.
      // Only update when paymentStatus was already explicitly "paid" or
      // "partially_paid" — leave null / "refunded" / "void" untouched so
      // we never introduce a badge that wasn't there before an edit.
      const eps = existing.paymentStatus;
      if (eps === "paid" || eps === "partially_paid") {
        if (alreadyPaid <= 0) {
          update.paymentStatus = null;
        } else if (Number(newBalance) <= 0) {
          update.paymentStatus = "paid";
        } else {
          update.paymentStatus = "partially_paid";
        }
      }

      // For POS orders (stockAppliedAt set), snapshot the current line
      // quantities BEFORE mutations so we can compute deltas afterward.
      const isPosOrder = !!existing.stockAppliedAt;
      const oldQtyByItemId = new Map<number, number>();
      // lineId → old quantityShipped (used to cap shipped qty after POS correction)
      const oldShippedByLineId = new Map<number, number>();
      if (isPosOrder) {
        const existingLineRows = await db
          .select({
            id: salesOrderLinesTable.id,
            itemId: salesOrderLinesTable.itemId,
            quantity: salesOrderLinesTable.quantity,
            quantityShipped: salesOrderLinesTable.quantityShipped,
          })
          .from(salesOrderLinesTable)
          .where(eq(salesOrderLinesTable.salesOrderId, id));
        for (const lr of existingLineRows) {
          oldQtyByItemId.set(
            lr.itemId,
            (oldQtyByItemId.get(lr.itemId) ?? 0) + toNum(lr.quantity),
          );
          oldShippedByLineId.set(lr.id, toNum(lr.quantityShipped ?? "0"));
        }
      }

      // For POS corrections: re-sync amountPaid to the new total so the
      // Summary card stays accurate. POS sales are always fully paid at the
      // point of sale — an edit is a correction of the original entry.
      if (isPosOrder) {
        update.amountPaid = effectiveTotal;
        update.balanceDue = "0.00";
        update.paymentStatus = "paid";
      }

      // Upsert strategy — avoids FK violations from shipment_lines which
      // has ON DELETE RESTRICT against sales_order_lines.
      // 1. Load current lines for this order.
      const currentLines = await db
        .select({ id: salesOrderLinesTable.id })
        .from(salesOrderLinesTable)
        .where(eq(salesOrderLinesTable.salesOrderId, id));
      const currentLineIds = currentLines.map((l) => l.id);

      // 2. Find which current line IDs are referenced by a shipment line
      //    (they cannot be deleted).
      let lockedLineIds = new Set<number>();
      if (currentLineIds.length > 0) {
        const locked = await db
          .select({ id: shipmentLinesTable.salesOrderLineId })
          .from(shipmentLinesTable) // org-scope-allow: filtered by salesOrderLineId which are already scoped to this org's order lines above
          .where(inArray(shipmentLinesTable.salesOrderLineId, currentLineIds));
        lockedLineIds = new Set(locked.map((r) => r.id));
      }

      // 3. Pair incoming lines with existing lines by the id the frontend
      //    echoes back (set when pre-filling from saved order detail).
      const incomingIds = new Set(
        (b.lines as Array<{ id?: number }>)
          .map((l) => l.id)
          .filter((x): x is number => typeof x === "number"),
      );

      // 4. Update lines whose id was submitted and exists in current set.
      for (let i = 0; i < totals.lines.length; i++) {
        const rawLine = (b.lines as Array<{ id?: number }>)[i];
        const l = totals.lines[i];
        if (rawLine?.id && currentLineIds.includes(rawLine.id)) {
          // For POS corrections: cap quantityShipped at the new quantity so
          // the detail page stays consistent after a qty reduction.
          const newQty = toNum(l.quantity);
          let newShipped: number | undefined;
          if (isPosOrder && oldShippedByLineId.has(rawLine.id)) {
            const oldShipped = oldShippedByLineId.get(rawLine.id)!;
            newShipped = Math.min(oldShipped, newQty);
          }
          await db
            .update(salesOrderLinesTable)
            .set({
              // Never change the item on a locked (shipped) line.
              itemId: lockedLineIds.has(rawLine.id) ? undefined : l.itemId,
              description: l.description,
              quantity: l.quantity,
              ...(newShipped !== undefined ? { quantityShipped: toStr(newShipped) } : {}),
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              discountPercent: l.discountPercent,
              discountAmount: l.discountAmount,
              lineSubtotal: l.lineSubtotal,
              lineTax: l.lineTax,
              lineTotal: l.lineTotal,
            })
            .where(eq(salesOrderLinesTable.id, rawLine.id));
          // Also sync the corresponding shipment_line(s) so the Shipments
          // card reflects the corrected quantity.
          if (newShipped !== undefined) {
            await db
              .update(shipmentLinesTable) // org-scope-allow: salesOrderLineId already scoped to this org's order lines above
              .set({ quantity: toStr(newShipped) })
              .where(eq(shipmentLinesTable.salesOrderLineId, rawLine.id));
          }
        } else {
          // 5. Insert genuinely new lines (no id, or id not in current set).
          await db.insert(salesOrderLinesTable).values({
            salesOrderId: id,
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            discountPercent: l.discountPercent,
            discountAmount: l.discountAmount,
            lineSubtotal: l.lineSubtotal,
            lineTax: l.lineTax,
            lineTotal: l.lineTotal,
          });
        }
      }

      // 6. Delete current lines that were not submitted AND are not locked.
      const toDelete = currentLineIds.filter(
        (cid) => !incomingIds.has(cid) && !lockedLineIds.has(cid),
      );
      if (toDelete.length > 0) {
        await db
          .delete(salesOrderLinesTable)
          .where(inArray(salesOrderLinesTable.id, toDelete));
      }

      // 7. POS stock adjustment — only for POS orders (stockAppliedAt set).
      //    Compute qty delta per item (new − old) and adjust POS warehouse stock.
      //    Bundles are expanded to their components exactly as posCheckout does.
      if (isPosOrder) {
        const newQtyByItemId = new Map<number, number>();
        for (const l of totals.lines) {
          newQtyByItemId.set(l.itemId, (newQtyByItemId.get(l.itemId) ?? 0) + toNum(l.quantity));
        }

        const allItemIds = new Set([...oldQtyByItemId.keys(), ...newQtyByItemId.keys()]);
        if (allItemIds.size > 0) {
          // Check which items are bundles.
          const itemFlagRows = await db
            .select({ id: itemsTable.id, isBundle: itemsTable.isBundle })
            .from(itemsTable)
            .where(
              and(
                eq(itemsTable.organizationId, t.organizationId),
                inArray(itemsTable.id, [...allItemIds]),
              ),
            );
          const bundleItemIds = itemFlagRows.filter((r) => r.isBundle).map((r) => r.id);

          // Load components for any bundle items.
          const componentsByParent = new Map<
            number,
            Array<{ componentItemId: number; quantityPerBundle: number }>
          >();
          if (bundleItemIds.length > 0) {
            const compRows = await db
              .select({
                parentItemId: itemBundleComponentsTable.parentItemId,
                componentItemId: itemBundleComponentsTable.componentItemId,
                quantityPerBundle: itemBundleComponentsTable.quantityPerBundle,
              })
              .from(itemBundleComponentsTable)
              .where(
                and(
                  eq(itemBundleComponentsTable.organizationId, t.organizationId),
                  inArray(itemBundleComponentsTable.parentItemId, bundleItemIds),
                ),
              );
            for (const c of compRows) {
              const arr = componentsByParent.get(c.parentItemId) ?? [];
              arr.push({
                componentItemId: c.componentItemId,
                quantityPerBundle: toNum(c.quantityPerBundle),
              });
              componentsByParent.set(c.parentItemId, arr);
            }
          }

          // Aggregate delta per physical stock item (after bundle expansion).
          // positive delta = more sold (deduct from stock)
          // negative delta = less sold (restore to stock)
          const stockDelta = new Map<number, number>();
          for (const itemId of allItemIds) {
            const oldQty = oldQtyByItemId.get(itemId) ?? 0;
            const newQty = newQtyByItemId.get(itemId) ?? 0;
            const delta = newQty - oldQty;
            if (Math.abs(delta) < 1e-9) continue;

            if (componentsByParent.has(itemId)) {
              for (const c of componentsByParent.get(itemId)!) {
                stockDelta.set(
                  c.componentItemId,
                  (stockDelta.get(c.componentItemId) ?? 0) + delta * c.quantityPerBundle,
                );
              }
            } else {
              stockDelta.set(itemId, (stockDelta.get(itemId) ?? 0) + delta);
            }
          }

          // Apply adjustments.
          const adjustedItemIds: number[] = [];
          for (const [stockItemId, delta] of stockDelta) {
            if (Math.abs(delta) < 1e-9) continue;
            adjustedItemIds.push(stockItemId);
            await db
              .update(itemWarehouseStockTable)
              .set({
                quantity: sql`${itemWarehouseStockTable.quantity} - ${toStr(delta)}::numeric`,
              })
              .where(
                and(
                  eq(itemWarehouseStockTable.organizationId, t.organizationId),
                  eq(itemWarehouseStockTable.itemId, stockItemId),
                  eq(itemWarehouseStockTable.warehouseId, warehouseId),
                ),
              );
            await db.insert(stockMovementsTable).values({
              organizationId: t.organizationId,
              itemId: stockItemId,
              warehouseId,
              movementType: delta > 0 ? "sale" : "sales_return",
              quantity: toStr(-delta),
              referenceType: "pos_sale",
              referenceId: id,
              notes: `POS order edit: ${existing.orderNumber}`,
            });
          }

          for (const stockItemId of adjustedItemIds) {
            pushStockToShopify(t.organizationId, stockItemId);
          }
        }
      }
    }

    await db
      .update(salesOrdersTable)
      .set(update)
      .where(
        and(
          eq(salesOrdersTable.organizationId, t.organizationId),
          eq(salesOrdersTable.id, id),
        ),
      );
    const detail = await loadDetail(t.organizationId, id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.delete("/sales-orders/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);

    // Confirm the order belongs to this org before touching anything.
    const orderRows = await db
      .select({ id: salesOrdersTable.id })
      .from(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.id, id),
          eq(salesOrdersTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!orderRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Delete in dependency order to satisfy FK RESTRICT constraints.

    // 1. customer_payment_allocations.sales_order_id → RESTRICT
    //    Remove allocations against this order (the payment row itself stays).
    await db
      .delete(customerPaymentAllocationsTable)
      .where(
        and(
          eq(customerPaymentAllocationsTable.salesOrderId, id),
          eq(customerPaymentAllocationsTable.organizationId, t.organizationId),
        ),
      );

    // 2. shipment_lines.sales_order_line_id → RESTRICT
    //    sales_order_lines would cascade-delete from sales_orders, but Postgres
    //    checks the RESTRICT before the cascade fires. Delete shipment_lines
    //    first via the shipments that belong to this order.
    const shipmentRows = await db
      .select({ id: shipmentsTable.id })
      .from(shipmentsTable)
      .where(
        and(
          eq(shipmentsTable.salesOrderId, id),
          eq(shipmentsTable.organizationId, t.organizationId),
        ),
      );
    if (shipmentRows.length > 0) {
      const shipmentIds = shipmentRows.map((s) => s.id);
      await db
        .delete(shipmentLinesTable) // org-scope-allow: filtered by shipmentId which are already scoped to this org's order above
        .where(inArray(shipmentLinesTable.shipmentId, shipmentIds));
    }

    // 3. Now the cascade from sales_orders → sales_order_lines and
    //    sales_orders → shipments (→ shipment_lines already gone) is unblocked.
    await db
      .delete(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.id, id),
          eq(salesOrdersTable.organizationId, t.organizationId),
        ),
      );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.patch("/sales-orders/:id/status", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const newStatus = String(req.body?.status ?? "");
    if (!newStatus) {
      res.status(400).json({ error: "status is required" });
      return;
    }
    if (newStatus === "returned") {
      res.status(400).json({
        error: "Use POST /sales-orders/:id/return to mark an order as returned.",
      });
      return;
    }
    if (newStatus === "shipped" || newStatus === "partially_shipped") {
      res.status(400).json({
        error:
          "Use POST /sales-orders/:id/shipments to record shipments. The order's shipped status is derived from recorded shipments.",
      });
      return;
    }
    if (!isPatchableSalesStatus(newStatus)) {
      res.status(400).json({
        error: `Invalid status. Allowed: ${PATCHABLE_SALES_STATUSES.join(", ")}`,
      });
      return;
    }
    const orderRows = await db
      .select()
      .from(salesOrdersTable)
      .where(
        and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.organizationId, t.organizationId)),
      )
      .limit(1);
    const order = orderRows[0];
    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (order.status === "returned") {
      res.status(400).json({
        error: "Returned orders are final and cannot change status.",
      });
      return;
    }

    // Validate per-status transition rules.
    const lineRows = await db
      .select({ qty: salesOrderLinesTable.quantity, shipped: salesOrderLinesTable.quantityShipped })
      .from(salesOrderLinesTable)
      .where(eq(salesOrderLinesTable.salesOrderId, id));
    const totalShipped = lineRows.reduce((s, l) => s + toNum(l.shipped), 0);

    if (newStatus === "draft" || newStatus === "confirmed") {
      if (totalShipped > 0) {
        res.status(400).json({
          error:
            "Cannot revert to draft or confirmed once shipments have been recorded. Cancel the shipments first.",
        });
        return;
      }
    }
    if (newStatus === "cancelled") {
      if (totalShipped > 0) {
        res.status(400).json({
          error:
            "Cannot cancel an order with recorded shipments. Cancel the shipments first, or use the return flow.",
        });
        return;
      }
      if (!["draft", "confirmed"].includes(order.status)) {
        res.status(400).json({
          error:
            "Cancellation is only allowed from draft or confirmed orders.",
        });
        return;
      }
    }
    if (newStatus === "delivered" && order.status !== "shipped") {
      res.status(400).json({
        error:
          "Mark the order delivered only after every line is fully shipped.",
      });
      return;
    }
    if (newStatus === "invoiced" && !["shipped", "delivered"].includes(order.status)) {
      res.status(400).json({
        error: "Invoiced is only valid after the order has shipped.",
      });
      return;
    }
    if (newStatus === "paid" && !["shipped", "delivered", "invoiced"].includes(order.status)) {
      res.status(400).json({
        error: "Paid is only valid after the order has shipped.",
      });
      return;
    }

    await db
      .update(salesOrdersTable)
      .set({ status: newStatus })
      .where(
        and(
          eq(salesOrdersTable.organizationId, t.organizationId),
          eq(salesOrdersTable.id, id),
        ),
      );

    // Best-effort auto-register an IRN with the IRP whenever an
    // order transitions into `invoiced`. tryAutoGenerateIrn caps
    // its own total time budget (and uses per-fetch timeouts plus a
    // small retry policy), so awaiting it here gives a fast IRP
    // response time to land in the immediate detail payload while
    // never blocking the status transition: any failure is
    // persisted as irpStatus="failed" and the status update still
    // succeeds.
    if (newStatus === "invoiced" && order.status !== "invoiced") {
      await tryAutoGenerateIrn(t.organizationId, id);
    }

    const detail = await loadDetail(t.organizationId, id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

const RETURNABLE_SALES_STATUSES = [
  "shipped",
  "delivered",
  "invoiced",
  "paid",
];

router.post("/sales-orders/:id/return", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const notes =
      typeof req.body?.notes === "string" && req.body.notes.trim()
        ? String(req.body.notes).trim()
        : null;

    const orderRows = await db
      .select()
      .from(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.id, id),
          eq(salesOrdersTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    const order = orderRows[0];
    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!RETURNABLE_SALES_STATUSES.includes(order.status)) {
      res.status(400).json({
        error: `Only ${RETURNABLE_SALES_STATUSES.join(", ")} sales orders can be returned`,
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(salesOrdersTable)
        .set({ status: "returned" })
        .where(
          and(
            eq(salesOrdersTable.id, id),
            eq(salesOrdersTable.organizationId, t.organizationId),
            sql`${salesOrdersTable.status} IN ('shipped','delivered','invoiced','paid')`,
          ),
        )
        .returning({ id: salesOrdersTable.id });
      if (claimed.length === 0) {
        return { conflict: true as const };
      }

      const lines = await tx
        .select()
        .from(salesOrderLinesTable)
        .where(eq(salesOrderLinesTable.salesOrderId, id));

      let anyStockReversed = false;
      for (const line of lines) {
        const qty = toNum(line.quantityShipped);
        if (qty <= 0) continue;
        anyStockReversed = true;
        const stockRows = await tx
          .select()
          .from(itemWarehouseStockTable)
          .where(
            and(
              eq(itemWarehouseStockTable.organizationId, t.organizationId),
              eq(itemWarehouseStockTable.itemId, line.itemId),
              eq(itemWarehouseStockTable.warehouseId, order.warehouseId),
            ),
          )
          .limit(1);
        if (stockRows[0]) {
          await tx
            .update(itemWarehouseStockTable)
            .set({ quantity: toStr(toNum(stockRows[0].quantity) + qty) })
            .where(
              and(
                eq(itemWarehouseStockTable.organizationId, t.organizationId),
                eq(itemWarehouseStockTable.id, stockRows[0].id),
              ),
            );
        } else {
          await tx.insert(itemWarehouseStockTable).values({
            organizationId: t.organizationId,
            itemId: line.itemId,
            warehouseId: order.warehouseId,
            quantity: toStr(qty),
          });
        }
        await tx.insert(stockMovementsTable).values({
          organizationId: t.organizationId,
          itemId: line.itemId,
          warehouseId: order.warehouseId,
          movementType: "sales_return",
          quantity: toStr(qty),
          referenceType: "sales_order",
          referenceId: id,
          notes:
            notes ??
            `Sales return for order ${order.orderNumber}`,
        });
      }
      if (!anyStockReversed) {
        return {
          conflict: false as const,
          empty: true as const,
          itemIds: [] as number[],
        };
      }
      return {
        conflict: false as const,
        empty: false as const,
        itemIds: lines.map((l) => l.itemId),
      };
    });

    if (result.conflict) {
      res.status(409).json({
        error: "Order has already been returned by another request.",
      });
      return;
    }
    for (const itemId of new Set(result.itemIds)) {
      pushStockToShopify(t.organizationId, itemId);
    }

    const detail = await loadDetail(t.organizationId, id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Invoice PDF + email-to-customer
// ---------------------------------------------------------------------------

router.get("/sales-orders/:id/pdf", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid sales order id" });
      return;
    }
    const { loadSalesOrderAckPdf } = await import(
      "../lib/salesOrderAckPdfData"
    );
    const result = await loadSalesOrderAckPdf(t.organizationId, id);
    if ("notFound" in result) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="order-${result.orderNumber}.pdf"`,
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.setHeader("Content-Length", String(result.pdf.length));
    res.send(result.pdf);
  } catch (err) {
    next(err);
  }
});

router.get("/sales-orders/:id/invoice.pdf", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid sales order id" });
      return;
    }
    const result = await loadInvoiceForOrder(t.organizationId, id);
    if ("notFound" in result) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if ("wrongStatus" in result) {
      res.status(400).json({
        error: `Invoice PDF is available after the order has shipped. Current status: ${result.wrongStatus}.`,
      });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice-${result.orderNumber}.pdf"`,
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.setHeader("Content-Length", String(result.pdf.length));
    res.send(result.pdf);
  } catch (err) {
    next(err);
  }
});

router.post("/sales-orders/:id/invoice/email", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid sales order id" });
      return;
    }
    const b = req.body ?? {};
    const to =
      typeof b.to === "string" && b.to.trim() ? String(b.to).trim() : null;
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ error: "A valid recipient email (to) is required." });
      return;
    }
    const result = await loadInvoiceForOrder(t.organizationId, id);
    if ("notFound" in result) {
      res.status(404).json({ error: "Sales order not found" });
      return;
    }
    if ("wrongStatus" in result) {
      res.status(400).json({
        error: `Invoice can only be emailed after the order has shipped. Current status: ${result.wrongStatus}.`,
      });
      return;
    }
    const subject =
      typeof b.subject === "string" && b.subject.trim()
        ? String(b.subject).trim().slice(0, 200)
        : `Invoice ${result.orderNumber}`;
    const bodyText =
      typeof b.body === "string" && b.body.trim()
        ? String(b.body).trim()
        : `Hi ${result.customerName},\n\nPlease find attached invoice ${result.orderNumber} for your records.\n\nThanks!`;

    let baseUrl =
      process.env.PUBLIC_BASE_URL?.trim() ||
      process.env.REPLIT_DEV_DOMAIN?.trim() ||
      "";
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
    // Full HTML attribute encoder: escapes the four characters that can break
    // out of an `href="..."` context.
    const escapeAttr = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const escapeText = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let html = bodyText
      .split("\n")
      .map((line) => `<p>${escapeText(line)}</p>`)
      .join("");
    let textWithLinks = bodyText;
    if (baseUrl) {
      try {
        const link = signInvoiceUrl(baseUrl, t.organizationId, id);
        html += `<p><a href="${escapeAttr(link.url)}">View invoice online</a></p>`;
        textWithLinks += `\n\nView invoice online: ${link.url}`;
      } catch {
        // Signing secret missing — skip the link rather than failing the send.
      }
    }
    // Inject the active Razorpay payment link, if any. Surfacing this in the
    // invoice email is the whole point of generating one.
    try {
      const activeLink = await getActivePaymentLink(t.organizationId, id);
      if (activeLink) {
        html += `<p><strong>Pay this invoice online:</strong> <a href="${escapeAttr(activeLink.shortUrl)}">${escapeText(activeLink.shortUrl)}</a></p>`;
        textWithLinks += `\n\nPay this invoice online: ${activeLink.shortUrl}`;
      }
    } catch (linkErr) {
      // A failure here must not abort the send — payment link is auxiliary.
      logger.warn(
        { err: linkErr, salesOrderId: id },
        "Could not look up payment link for invoice email; sending without it",
      );
    }

    // Step 1: attempt to send. Capture outcome — never let an exception escape
    // out of this block so we can always attempt to log it before responding.
    let sendError: unknown = null;
    try {
      await sendEmail({
        to,
        subject,
        text: textWithLinks,
        html,
        attachments: [
          {
            filename: `invoice-${result.orderNumber}.pdf`,
            content: result.pdf,
            contentType: "application/pdf",
          },
        ],
      });
    } catch (err) {
      sendError = err;
    }

    const sendStatus: "sent" | "failed" = sendError ? "failed" : "sent";
    const errorMessage = sendError
      ? sendError instanceof Error
        ? sendError.message
        : "Email send failed"
      : null;

    // Step 2: try to record the outcome. Logging failure must NOT flip a
    // successful send into a "failed" response to the user.
    let logRow:
      | typeof emailLogTable.$inferSelect
      | { synthetic: true; status: "sent" | "failed"; errorMessage: string | null };
    try {
      const inserted = await db
        .insert(emailLogTable)
        .values({
          organizationId: t.organizationId,
          salesOrderId: id,
          kind: "invoice",
          recipient: to,
          subject,
          status: sendStatus,
          errorMessage,
          sentByUserId: t.userId,
        })
        .returning();
      logRow = inserted[0]!;
    } catch (logErr) {
      logger.error(
        { err: logErr, salesOrderId: id, sendStatus },
        "Failed to write email_log row",
      );
      logRow = { synthetic: true, status: sendStatus, errorMessage };
    }

    // Step 3: respond based on the *send* outcome (the user-observable truth),
    // independent of whether the log write succeeded.
    if (sendError) {
      const httpStatus =
        sendError instanceof EmailNotConfiguredError ? 503 : 502;
      res.status(httpStatus).json({
        error: errorMessage,
        emailLog:
          "synthetic" in logRow ? null : serializeEmailLog(logRow),
      });
      return;
    }
    res.status(201).json(
      "synthetic" in logRow
        ? {
            id: -1,
            organizationId: t.organizationId,
            salesOrderId: id,
            kind: "invoice",
            recipient: to,
            subject,
            status: "sent",
            errorMessage: null,
            sentByUserId: t.userId,
            sentAt: new Date().toISOString(),
            warning: "Email sent but the activity record could not be saved.",
          }
        : serializeEmailLog(logRow),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/sales-orders/:id/email-log", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid sales order id" });
      return;
    }
    const rows = await db
      .select()
      .from(emailLogTable)
      .where(
        and(
          eq(emailLogTable.organizationId, t.organizationId),
          eq(emailLogTable.salesOrderId, id),
        ),
      )
      .orderBy(desc(emailLogTable.sentAt));
    res.json(rows.map(serializeEmailLog));
  } catch (err) {
    next(err);
  }
});

export default router;
