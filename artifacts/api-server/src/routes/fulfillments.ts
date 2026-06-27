import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  db,
  salesOrdersTable,
  salesOrderLinesTable,
  shipmentsTable,
  shipmentLinesTable,
  itemsTable,
  itemBundleComponentsTable,
  itemWarehouseStockTable,
  stockMovementsTable,
  fulfillmentsTable,
  fulfillmentLinesTable,
  fulfillmentScansTable,
  warehousesTable,
  customersTable,
  emailLogTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { nextOrderNumber } from "../lib/orderHelpers";
import { toNum, toStr } from "../lib/numeric";
import { pushFulfillmentToShopify, pushStockToShopify } from "../lib/shopifyOutbound";
import { serializeShipment } from "../lib/serializers";
import { sendShippingConfirmationEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(tenantMiddleware);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeFulfillmentLine(
  fl: {
    id: number;
    fulfillmentId: number;
    salesOrderLineId: number;
    itemId: number;
    quantityRequired: string;
    quantityPicked: string;
  },
  itemName: string,
  sku: string,
  barcode: string | null,
  stockAvailable: number | null,
) {
  return {
    id: fl.id,
    fulfillmentId: fl.fulfillmentId,
    salesOrderLineId: fl.salesOrderLineId,
    itemId: fl.itemId,
    itemName,
    sku,
    barcode,
    quantityRequired: toNum(fl.quantityRequired),
    quantityPicked: toNum(fl.quantityPicked),
    stockAvailable,
  };
}

function serializeFulfillment(
  f: typeof fulfillmentsTable.$inferSelect,
  warehouseName: string,
  orderNumber: string,
  shopifyOrderId: string | null,
) {
  return {
    id: f.id,
    fulfillmentNumber: f.fulfillmentNumber,
    salesOrderId: f.salesOrderId,
    orderNumber,
    shopifyOrderId,
    shipmentId: f.shipmentId,
    status: f.status,
    warehouseId: f.warehouseId,
    warehouseName,
    courierName: f.courierName,
    awbNumber: f.awbNumber,
    trackingUrl: f.trackingUrl,
    notes: f.notes,
    shopifyFulfillmentId: f.shopifyFulfillmentId,
    pickedAt: f.pickedAt ? f.pickedAt.toISOString() : null,
    packedAt: f.packedAt ? f.packedAt.toISOString() : null,
    dispatchedAt: f.dispatchedAt ? f.dispatchedAt.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

async function loadFulfillmentWithLines(orgId: number, fulfillmentId: number) {
  const rows = await db // org-scope-allow: fulfillment_id is already org-scoped via the FK + org join below
    .select({
      fulfillment: fulfillmentsTable,
      warehouseName: warehousesTable.name,
      orderNumber: salesOrdersTable.orderNumber,
      shopifyOrderId: salesOrdersTable.shopifyOrderId,
    })
    .from(fulfillmentsTable)
    .innerJoin(warehousesTable, eq(warehousesTable.id, fulfillmentsTable.warehouseId))
    .innerJoin(salesOrdersTable, eq(salesOrdersTable.id, fulfillmentsTable.salesOrderId))
    .where(
      and(
        eq(fulfillmentsTable.id, fulfillmentId),
        eq(fulfillmentsTable.organizationId, orgId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const warehouseId = row.fulfillment.warehouseId;

  const lineRows = await db
    .select({
      fl: fulfillmentLinesTable,
      itemName: itemsTable.name,
      sku: itemsTable.sku,
      barcode: itemsTable.barcode,
      stockQty: itemWarehouseStockTable.quantity,
    })
    .from(fulfillmentLinesTable)
    .innerJoin(itemsTable, eq(itemsTable.id, fulfillmentLinesTable.itemId))
    .leftJoin(
      itemWarehouseStockTable,
      and(
        eq(itemWarehouseStockTable.itemId, fulfillmentLinesTable.itemId),
        eq(itemWarehouseStockTable.warehouseId, warehouseId),
        eq(itemWarehouseStockTable.organizationId, orgId),
      ),
    )
    .where(
      and(
        eq(fulfillmentLinesTable.fulfillmentId, fulfillmentId),
        eq(fulfillmentLinesTable.organizationId, orgId),
      ),
    );

  return {
    ...serializeFulfillment(
      row.fulfillment,
      row.warehouseName,
      row.orderNumber,
      row.shopifyOrderId,
    ),
    lines: lineRows.map((r) =>
      serializeFulfillmentLine(
        r.fl,
        r.itemName,
        r.sku,
        r.barcode,
        r.stockQty !== null && r.stockQty !== undefined ? toNum(r.stockQty) : null,
      ),
    ),
  };
}

// ─── Derive & update SO status (same logic as shipments.ts) ──────────────────

async function deriveAndUpdateOrderStatus(
  tx: Tx,
  orgId: number,
  orderId: number,
) {
  const lines = await tx
    .select({
      quantity: salesOrderLinesTable.quantity,
      quantityShipped: salesOrderLinesTable.quantityShipped,
    })
    .from(salesOrderLinesTable)
    .where(eq(salesOrderLinesTable.salesOrderId, orderId));
  let totalOrdered = 0;
  let totalShipped = 0;
  for (const l of lines) {
    totalOrdered += toNum(l.quantity);
    totalShipped += toNum(l.quantityShipped);
  }
  let nextStatus: "confirmed" | "partially_shipped" | "shipped";
  if (totalShipped <= 0) nextStatus = "confirmed";
  else if (totalShipped < totalOrdered) nextStatus = "partially_shipped";
  else nextStatus = "shipped";
  await tx
    .update(salesOrdersTable)
    .set({ status: nextStatus })
    .where(
      and(
        eq(salesOrdersTable.id, orderId),
        eq(salesOrdersTable.organizationId, orgId),
      ),
    );
  return nextStatus;
}

// ─── GET /fulfillments ────────────────────────────────────────────────────────

router.get("/fulfillments", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const warehouseIdRaw = typeof req.query.warehouseId === "string" ? Number(req.query.warehouseId) : undefined;
    const warehouseId = warehouseIdRaw && Number.isFinite(warehouseIdRaw) ? warehouseIdRaw : undefined;

    const rows = await db
      .select({
        fulfillment: fulfillmentsTable,
        warehouseName: warehousesTable.name,
        orderNumber: salesOrdersTable.orderNumber,
        shopifyOrderId: salesOrdersTable.shopifyOrderId,
      })
      .from(fulfillmentsTable)
      .innerJoin(warehousesTable, eq(warehousesTable.id, fulfillmentsTable.warehouseId))
      .innerJoin(salesOrdersTable, eq(salesOrdersTable.id, fulfillmentsTable.salesOrderId))
      .where(
        and(
          eq(fulfillmentsTable.organizationId, t.organizationId),
          status ? eq(fulfillmentsTable.status, status) : undefined,
          warehouseId ? eq(fulfillmentsTable.warehouseId, warehouseId) : undefined,
          search
            ? or(
                ilike(fulfillmentsTable.fulfillmentNumber, `%${search}%`),
                ilike(salesOrdersTable.orderNumber, `%${search}%`),
              )
            : undefined,
        ),
      )
      .orderBy(desc(fulfillmentsTable.createdAt));

    res.json(
      rows.map((r) =>
        serializeFulfillment(r.fulfillment, r.warehouseName, r.orderNumber, r.shopifyOrderId),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// ─── GET /fulfillments/:id ────────────────────────────────────────────────────

router.get("/fulfillments/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const result = await loadFulfillmentWithLines(t.organizationId, id);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── POST /sales-orders/:id/fulfillments ─────────────────────────────────────
// Create a fulfillment for a confirmed (or partially_shipped) sales order.
// Lines are auto-populated from the remaining unshipped quantities.

router.post("/sales-orders/:id/fulfillments", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orderId = Number(req.params.id);

    const result = await db.transaction(async (tx) => {
      const orderRows = await tx
        .select()
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.id, orderId),
            eq(salesOrdersTable.organizationId, t.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      const order = orderRows[0];
      if (!order) return { kind: "notfound" as const };

      if (!["confirmed", "partially_shipped"].includes(order.status)) {
        return {
          kind: "bad" as const,
          message: `Order must be confirmed or partially shipped to start fulfillment (current: ${order.status}).`,
        };
      }

      // Check no active (non-dispatched) fulfillment exists for this order
      const existing = await tx
        .select({ id: fulfillmentsTable.id, status: fulfillmentsTable.status })
        .from(fulfillmentsTable)
        .where(
          and(
            eq(fulfillmentsTable.organizationId, t.organizationId),
            eq(fulfillmentsTable.salesOrderId, orderId),
          ),
        );
      const active = existing.filter((f) => f.status !== "dispatched");
      if (active.length > 0) {
        return {
          kind: "bad" as const,
          message: `An active fulfillment (id: ${active[0]!.id}) already exists for this order.`,
        };
      }

      // Load order lines that still have unshipped quantity
      const lineRows = await tx
        .select()
        .from(salesOrderLinesTable)
        .where(eq(salesOrderLinesTable.salesOrderId, orderId));

      const pendingLines = lineRows.filter(
        (l) => toNum(l.quantity) - toNum(l.quantityShipped) > 1e-6,
      );
      if (pendingLines.length === 0) {
        return { kind: "bad" as const, message: "All lines on this order are already shipped." };
      }

      const [inserted] = await tx
        .insert(fulfillmentsTable)
        .values({
          organizationId: t.organizationId,
          salesOrderId: orderId,
          fulfillmentNumber: nextOrderNumber("FULFIL"),
          status: "picking",
          warehouseId: order.warehouseId,
        })
        .returning();
      const fulfillment = inserted!;

      await tx.insert(fulfillmentLinesTable).values(
        pendingLines.map((l) => ({
          organizationId: t.organizationId,
          fulfillmentId: fulfillment.id,
          salesOrderLineId: l.id,
          itemId: l.itemId,
          quantityRequired: toStr(toNum(l.quantity) - toNum(l.quantityShipped)),
          quantityPicked: "0",
        })),
      );

      return { kind: "ok" as const, fulfillmentId: fulfillment.id };
    });

    if (result.kind === "notfound") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "bad") {
      res.status(400).json({ error: result.message });
      return;
    }

    const data = await loadFulfillmentWithLines(t.organizationId, result.fulfillmentId);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /fulfillments/:id/lines ────────────────────────────────────────────
// Update picked quantities per line (barcode scan increments or manual entry).
// Body: { lines: [{ fulfillmentLineId, quantityPicked }] }

router.patch("/fulfillments/:id/lines", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const fulfillmentId = Number(req.params.id);
    const body = req.body ?? {};
    const inputLines: Array<{ fulfillmentLineId: number; quantityPicked: number }> =
      Array.isArray(body.lines) ? body.lines : [];

    if (inputLines.length === 0) {
      res.status(400).json({ error: "lines array is required" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const fRows = await tx
        .select()
        .from(fulfillmentsTable)
        .where(
          and(
            eq(fulfillmentsTable.id, fulfillmentId),
            eq(fulfillmentsTable.organizationId, t.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      const f = fRows[0];
      if (!f) return { kind: "notfound" as const };
      if (f.status !== "picking") {
        return {
          kind: "bad" as const,
          message: `Cannot update lines when fulfillment is in '${f.status}' status.`,
        };
      }

      for (const update of inputLines) {
        const lineId = Number(update.fulfillmentLineId);
        const qty = toNum(update.quantityPicked);
        if (!Number.isFinite(lineId) || lineId <= 0) {
          return { kind: "bad" as const, message: "Invalid fulfillmentLineId" };
        }
        if (!Number.isFinite(qty) || qty < 0) {
          return { kind: "bad" as const, message: "quantityPicked must be >= 0" };
        }
        await tx
          .update(fulfillmentLinesTable)
          .set({ quantityPicked: toStr(qty) })
          .where(
            and(
              eq(fulfillmentLinesTable.id, lineId),
              eq(fulfillmentLinesTable.fulfillmentId, fulfillmentId),
              eq(fulfillmentLinesTable.organizationId, t.organizationId),
            ),
          );
      }
      return { kind: "ok" as const };
    });

    if (result.kind === "notfound") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "bad") {
      res.status(400).json({ error: result.message });
      return;
    }

    const data = await loadFulfillmentWithLines(t.organizationId, fulfillmentId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── POST /fulfillments/:id/scan ──────────────────────────────────────────────
// Scan a barcode/SKU and increment its matched line's quantityPicked by 1.
// Every attempt (success or failure) is recorded in fulfillment_scans.
// Body: { code: string }

router.post("/fulfillments/:id/scan", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const fulfillmentId = Number(req.params.id);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const fRows = await tx
        .select()
        .from(fulfillmentsTable)
        .where(
          and(
            eq(fulfillmentsTable.id, fulfillmentId),
            eq(fulfillmentsTable.organizationId, t.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      const f = fRows[0];
      if (!f) return { kind: "notfound" as const };

      if (f.status !== "picking") {
        // Record wrong_stage scan
        await tx.insert(fulfillmentScansTable).values({ // org-scope-allow: organizationId explicitly set
          organizationId: t.organizationId,
          fulfillmentId,
          scannedCode: code,
          result: "wrong_stage",
        });
        return { kind: "bad" as const, message: "Can only scan during picking stage." };
      }

      // Resolve item by barcode or SKU
      const itemRows = await tx
        .select({ id: itemsTable.id, name: itemsTable.name, sku: itemsTable.sku })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            sql`(${itemsTable.barcode} = ${code} OR ${itemsTable.sku} = ${code})`,
          ),
        )
        .limit(1);
      const item = itemRows[0];
      if (!item) {
        await tx.insert(fulfillmentScansTable).values({ // org-scope-allow: organizationId explicitly set
          organizationId: t.organizationId,
          fulfillmentId,
          scannedCode: code,
          result: "not_found",
        });
        return { kind: "notfound_item" as const, code };
      }

      // Find the matching fulfillment line
      const lineRows = await tx
        .select()
        .from(fulfillmentLinesTable)
        .where(
          and(
            eq(fulfillmentLinesTable.fulfillmentId, fulfillmentId),
            eq(fulfillmentLinesTable.itemId, item.id),
            eq(fulfillmentLinesTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      const line = lineRows[0];
      if (!line) {
        await tx.insert(fulfillmentScansTable).values({ // org-scope-allow: organizationId explicitly set
          organizationId: t.organizationId,
          fulfillmentId,
          itemId: item.id,
          scannedCode: code,
          result: "not_in_order",
        });
        return { kind: "not_in_order" as const, itemName: item.name, sku: item.sku };
      }

      const pickedBefore = toNum(line.quantityPicked);
      const required = toNum(line.quantityRequired);

      // Already at full quantity — record and return informative error
      if (pickedBefore >= required) {
        await tx.insert(fulfillmentScansTable).values({ // org-scope-allow: organizationId explicitly set
          organizationId: t.organizationId,
          fulfillmentId,
          fulfillmentLineId: line.id,
          itemId: item.id,
          scannedCode: code,
          result: "already_full",
          quantityBefore: toStr(pickedBefore),
          quantityAfter: toStr(pickedBefore),
        });
        return {
          kind: "already_full" as const,
          itemName: item.name,
          sku: item.sku,
          quantityRequired: required,
        };
      }

      const newQty = pickedBefore + 1;
      await tx
        .update(fulfillmentLinesTable)
        .set({ quantityPicked: toStr(newQty) })
        .where(
          and(
            eq(fulfillmentLinesTable.id, line.id),
            eq(fulfillmentLinesTable.organizationId, t.organizationId),
          ),
        );

      // Record successful scan
      await tx.insert(fulfillmentScansTable).values({ // org-scope-allow: organizationId explicitly set
        organizationId: t.organizationId,
        fulfillmentId,
        fulfillmentLineId: line.id,
        itemId: item.id,
        scannedCode: code,
        result: "ok",
        quantityBefore: toStr(pickedBefore),
        quantityAfter: toStr(newQty),
      });

      return {
        kind: "ok" as const,
        lineId: line.id,
        itemName: item.name,
        sku: item.sku,
        quantityPicked: newQty,
        quantityRequired: required,
      };
    });

    if (result.kind === "notfound") {
      res.status(404).json({ error: "Fulfillment not found" });
      return;
    }
    if (result.kind === "notfound_item") {
      res.status(404).json({ error: `No item found with barcode/SKU '${result.code}'` });
      return;
    }
    if (result.kind === "not_in_order") {
      res.status(400).json({
        error: `Item '${result.itemName}' (${result.sku}) is not in this fulfillment.`,
      });
      return;
    }
    if (result.kind === "already_full") {
      res.status(400).json({
        error: `'${result.itemName}' is already fully picked (${result.quantityRequired}/${result.quantityRequired}).`,
      });
      return;
    }

    const data = await loadFulfillmentWithLines(t.organizationId, fulfillmentId);
    res.json({ ...data, scanned: result });
  } catch (err) {
    next(err);
  }
});

// ─── GET /fulfillments/:id/scans ──────────────────────────────────────────────
// Return the full audit trail of scan attempts for this fulfillment.

router.get("/fulfillments/:id/scans", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const fulfillmentId = Number(req.params.id);

    // Verify fulfillment belongs to org
    const fRows = await db
      .select({ id: fulfillmentsTable.id })
      .from(fulfillmentsTable)
      .where(
        and(
          eq(fulfillmentsTable.id, fulfillmentId),
          eq(fulfillmentsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!fRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const scans = await db
      .select({
        id: fulfillmentScansTable.id,
        scannedCode: fulfillmentScansTable.scannedCode,
        result: fulfillmentScansTable.result,
        fulfillmentLineId: fulfillmentScansTable.fulfillmentLineId,
        quantityBefore: fulfillmentScansTable.quantityBefore,
        quantityAfter: fulfillmentScansTable.quantityAfter,
        createdAt: fulfillmentScansTable.createdAt,
        itemName: itemsTable.name,
        sku: itemsTable.sku,
      })
      .from(fulfillmentScansTable)
      .leftJoin(itemsTable, eq(itemsTable.id, fulfillmentScansTable.itemId))
      .where(
        and(
          eq(fulfillmentScansTable.organizationId, t.organizationId), // org-scope-allow: explicit org filter
          eq(fulfillmentScansTable.fulfillmentId, fulfillmentId),
        ),
      )
      .orderBy(desc(fulfillmentScansTable.createdAt));

    res.json(
      scans.map((s) => ({
        id: s.id,
        scannedCode: s.scannedCode,
        result: s.result,
        fulfillmentLineId: s.fulfillmentLineId,
        itemName: s.itemName ?? null,
        sku: s.sku ?? null,
        quantityBefore: s.quantityBefore !== null ? toNum(s.quantityBefore) : null,
        quantityAfter: s.quantityAfter !== null ? toNum(s.quantityAfter) : null,
        createdAt: s.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /fulfillments/:id/confirm-pick ──────────────────────────────────────
// Validates that all lines have quantityPicked > 0, then deducts stock
// and creates the underlying shipment. Status → 'picked'.

router.post("/fulfillments/:id/confirm-pick", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const fulfillmentId = Number(req.params.id);

    const result = await db.transaction(async (tx) => {
      const fRows = await tx
        .select()
        .from(fulfillmentsTable)
        .where(
          and(
            eq(fulfillmentsTable.id, fulfillmentId),
            eq(fulfillmentsTable.organizationId, t.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      const f = fRows[0];
      if (!f) return { kind: "notfound" as const };
      if (f.status !== "picking") {
        return {
          kind: "bad" as const,
          message: `Fulfillment is already in '${f.status}' status.`,
        };
      }

      // Load fulfillment lines
      const flRows = await tx
        .select()
        .from(fulfillmentLinesTable)
        .where(
          and(
            eq(fulfillmentLinesTable.fulfillmentId, fulfillmentId),
            eq(fulfillmentLinesTable.organizationId, t.organizationId),
          ),
        );
      if (flRows.length === 0) {
        return { kind: "bad" as const, message: "No lines on this fulfillment." };
      }

      // Validate all lines have been picked
      for (const fl of flRows) {
        const picked = toNum(fl.quantityPicked);
        if (picked <= 0) {
          return {
            kind: "bad" as const,
            message: `Line ${fl.id} has not been picked yet (quantityPicked = 0). Scan or enter quantities before confirming.`,
          };
        }
        if (picked - toNum(fl.quantityRequired) > 1e-6) {
          return {
            kind: "bad" as const,
            message: `Line ${fl.id}: picked (${picked}) exceeds required (${toNum(fl.quantityRequired)}).`,
          };
        }
      }

      // Load order for warehouse reference
      const orderRows = await tx
        .select()
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.id, f.salesOrderId),
            eq(salesOrdersTable.organizationId, t.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      const order = orderRows[0];
      if (!order) return { kind: "notfound" as const };

      // Load items (for bundle detection)
      const itemIds = Array.from(new Set(flRows.map((fl) => fl.itemId)));
      const itemRows = await tx
        .select({ id: itemsTable.id, sku: itemsTable.sku, isBundle: itemsTable.isBundle })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            inArray(itemsTable.id, itemIds),
          ),
        );
      const itemById = new Map(itemRows.map((r) => [r.id, r]));

      // Load bundle components
      const bundleParentIds = itemRows.filter((r) => r.isBundle).map((r) => r.id);
      const componentsByParent = new Map<
        number,
        Array<{ componentItemId: number; quantityPerBundle: number }>
      >();
      if (bundleParentIds.length > 0) {
        const compRows = await tx
          .select({
            parentItemId: itemBundleComponentsTable.parentItemId,
            componentItemId: itemBundleComponentsTable.componentItemId,
            quantityPerBundle: itemBundleComponentsTable.quantityPerBundle,
          })
          .from(itemBundleComponentsTable)
          .where(
            and(
              eq(itemBundleComponentsTable.organizationId, t.organizationId),
              inArray(itemBundleComponentsTable.parentItemId, bundleParentIds),
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
        for (const id of bundleParentIds) {
          if (!componentsByParent.get(id)?.length) {
            const sku = itemById.get(id)?.sku ?? `#${id}`;
            return { kind: "bad" as const, message: `Bundle ${sku} has no components.` };
          }
        }
      }

      // Create the shipment
      const shipDate = new Date().toISOString().slice(0, 10);
      const [shipmentInserted] = await tx
        .insert(shipmentsTable)
        .values({
          organizationId: t.organizationId,
          salesOrderId: f.salesOrderId,
          shipmentNumber: nextOrderNumber("SHIP"),
          shipDate,
          status: "shipped",
          notes: `Fulfillment ${f.fulfillmentNumber}`,
        })
        .returning();
      const shipment = shipmentInserted!;

      // Insert shipment lines
      await tx.insert(shipmentLinesTable).values(
        flRows.map((fl) => ({
          organizationId: t.organizationId,
          shipmentId: shipment.id,
          salesOrderLineId: fl.salesOrderLineId,
          quantity: fl.quantityPicked,
        })),
      );

      // Deduct stock (with bundle fan-out)
      const touchedItems = new Set<number>();
      const warehouseId = f.warehouseId;

      const decrementStock = async (
        itemId: number,
        qty: number,
        notesText: string,
      ): Promise<void> => {
        const updated = await tx
          .update(itemWarehouseStockTable)
          .set({
            quantity: sql`${itemWarehouseStockTable.quantity} - ${toStr(qty)}::numeric`,
          })
          .where(
            and(
              eq(itemWarehouseStockTable.organizationId, t.organizationId),
              eq(itemWarehouseStockTable.itemId, itemId),
              eq(itemWarehouseStockTable.warehouseId, warehouseId),
            ),
          )
          .returning({ id: itemWarehouseStockTable.id });
        if (updated.length === 0) {
          await tx.insert(itemWarehouseStockTable).values({
            organizationId: t.organizationId,
            itemId,
            warehouseId,
            quantity: toStr(-qty),
          });
        }
        await tx.insert(stockMovementsTable).values({
          organizationId: t.organizationId,
          itemId,
          warehouseId,
          movementType: "sale",
          quantity: toStr(-qty),
          referenceType: "shipment",
          referenceId: shipment.id,
          notes: notesText,
        });
      };

      for (const fl of flRows) {
        const qty = toNum(fl.quantityPicked);
        const item = itemById.get(fl.itemId);
        const baseNote = `Fulfillment ${f.fulfillmentNumber} / Shipment ${shipment.shipmentNumber}`;

        if (item?.isBundle) {
          const comps = componentsByParent.get(fl.itemId)!;
          for (const c of comps) {
            await decrementStock(
              c.componentItemId,
              qty * c.quantityPerBundle,
              `${baseNote} (component of bundle ${item.sku})`,
            );
            touchedItems.add(c.componentItemId);
          }
          touchedItems.add(fl.itemId);
        } else {
          await decrementStock(fl.itemId, qty, baseNote);
          touchedItems.add(fl.itemId);
        }

        // Update quantityShipped on the SO line
        const soLine = await tx
          .select({ quantityShipped: salesOrderLinesTable.quantityShipped })
          .from(salesOrderLinesTable)
          .where(eq(salesOrderLinesTable.id, fl.salesOrderLineId))
          .limit(1);
        if (soLine[0]) {
          await tx
            .update(salesOrderLinesTable)
            .set({
              quantityShipped: toStr(toNum(soLine[0].quantityShipped) + qty),
            })
            .where(eq(salesOrderLinesTable.id, fl.salesOrderLineId));
        }
      }

      // Derive SO status
      await deriveAndUpdateOrderStatus(tx, t.organizationId, f.salesOrderId);

      // Link shipment to fulfillment + advance status
      await tx
        .update(fulfillmentsTable)
        .set({
          status: "picked",
          shipmentId: shipment.id,
          pickedAt: new Date(),
        })
        .where(
          and(
            eq(fulfillmentsTable.id, fulfillmentId),
            eq(fulfillmentsTable.organizationId, t.organizationId),
          ),
        );

      return {
        kind: "ok" as const,
        shipmentId: shipment.id,
        itemIds: Array.from(touchedItems),
      };
    });

    if (result.kind === "notfound") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "bad") {
      res.status(400).json({ error: result.message });
      return;
    }

    // Fire-and-forget: push stock changes to Shopify
    for (const itemId of result.itemIds) {
      pushStockToShopify(t.organizationId, itemId);
    }

    const data = await loadFulfillmentWithLines(t.organizationId, fulfillmentId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── POST /fulfillments/:id/pack ──────────────────────────────────────────────
// Confirm items are physically packed. Status: picked → packed.

router.post("/fulfillments/:id/pack", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const fulfillmentId = Number(req.params.id);

    const rows = await db
      .update(fulfillmentsTable)
      .set({ status: "packed", packedAt: new Date() })
      .where(
        and(
          eq(fulfillmentsTable.id, fulfillmentId),
          eq(fulfillmentsTable.organizationId, t.organizationId),
          eq(fulfillmentsTable.status, "picked"),
        ),
      )
      .returning();

    if (rows.length === 0) {
      const existing = await db
        .select({ status: fulfillmentsTable.status })
        .from(fulfillmentsTable)
        .where(
          and(
            eq(fulfillmentsTable.id, fulfillmentId),
            eq(fulfillmentsTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      if (!existing[0]) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(400).json({
        error: `Fulfillment must be in 'picked' status to pack (current: ${existing[0].status}).`,
      });
      return;
    }

    const data = await loadFulfillmentWithLines(t.organizationId, fulfillmentId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── POST /fulfillments/:id/dispatch ─────────────────────────────────────────
// Record AWB / courier, update Shopify order. Status: packed → dispatched.
// Body: { courierName, awbNumber, trackingUrl? }

router.post("/fulfillments/:id/dispatch", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const fulfillmentId = Number(req.params.id);
    const body = req.body ?? {};
    const courierName =
      typeof body.courierName === "string" && body.courierName.trim()
        ? body.courierName.trim()
        : null;
    const awbNumber =
      typeof body.awbNumber === "string" && body.awbNumber.trim()
        ? body.awbNumber.trim()
        : null;
    const trackingUrl =
      typeof body.trackingUrl === "string" && body.trackingUrl.trim()
        ? body.trackingUrl.trim()
        : null;

    const result = await db.transaction(async (tx) => {
      const fRows = await tx
        .select()
        .from(fulfillmentsTable)
        .where(
          and(
            eq(fulfillmentsTable.id, fulfillmentId),
            eq(fulfillmentsTable.organizationId, t.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      const f = fRows[0];
      if (!f) return { kind: "notfound" as const };
      if (f.status !== "packed") {
        return {
          kind: "bad" as const,
          message: `Fulfillment must be in 'packed' status to dispatch (current: ${f.status}).`,
        };
      }

      // Update AWB/courier on the underlying shipment as well
      if (f.shipmentId) {
        await tx
          .update(shipmentsTable)
          .set({
            ...(courierName !== null ? { courierName } : {}),
            ...(awbNumber !== null ? { awb: awbNumber } : {}),
            ...(trackingUrl !== null ? { trackingUrl } : {}),
          })
          .where(
            and(
              eq(shipmentsTable.id, f.shipmentId),
              eq(shipmentsTable.organizationId, t.organizationId),
            ),
          );
      }

      await tx
        .update(fulfillmentsTable)
        .set({
          status: "dispatched",
          courierName,
          awbNumber,
          trackingUrl,
          dispatchedAt: new Date(),
        })
        .where(
          and(
            eq(fulfillmentsTable.id, fulfillmentId),
            eq(fulfillmentsTable.organizationId, t.organizationId),
          ),
        );

      return { kind: "ok" as const, salesOrderId: f.salesOrderId, shipmentId: f.shipmentId };
    });

    if (result.kind === "notfound") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.kind === "bad") {
      res.status(400).json({ error: result.message });
      return;
    }

    // Push fulfillment status to Shopify (marks order as fulfilled)
    if (result.shipmentId != null) {
      pushFulfillmentToShopify(t.organizationId, result.salesOrderId, result.shipmentId);
    }

    const data = await loadFulfillmentWithLines(t.organizationId, fulfillmentId);
    res.json(data);

    // Fire-and-forget: send shipping confirmation email to the customer
    void (async () => {
      try {
        const rows = await db
          .select({
            customerEmail: customersTable.email,
            customerName: customersTable.name,
            orderNumber: salesOrdersTable.orderNumber,
          })
          .from(salesOrdersTable)
          .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
          .where(
            and(
              eq(salesOrdersTable.id, result.salesOrderId),
              eq(salesOrdersTable.organizationId, t.organizationId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row?.customerEmail) return;

        const items = (data?.lines ?? []).map((l) => ({
          itemName: l.itemName,
          sku: l.sku,
          quantity: toNum(l.quantityPicked),
        }));

        const subject = `Your order ${row.orderNumber} has been dispatched`;
        let emailStatus = "sent";
        let emailError: string | undefined;
        try {
          await sendShippingConfirmationEmail({
            to: row.customerEmail,
            customerName: row.customerName,
            orderNumber: row.orderNumber,
            courierName,
            awbNumber,
            trackingUrl,
            items,
          });
          logger.info({ fulfillmentId, orderNumber: row.orderNumber }, "dispatch: shipping confirmation email sent");
        } catch (sendErr) {
          emailStatus = "failed";
          emailError = sendErr instanceof Error ? sendErr.message : String(sendErr);
          logger.warn({ err: sendErr, fulfillmentId }, "dispatch: shipping confirmation email failed");
        }
        await db.insert(emailLogTable).values({
          organizationId: t.organizationId,
          salesOrderId: result.salesOrderId,
          kind: "shipping_confirmation",
          recipient: row.customerEmail,
          subject,
          status: emailStatus,
          errorMessage: emailError ?? null,
        });
      } catch (err) {
        logger.warn({ err, fulfillmentId }, "dispatch: could not send shipping confirmation email");
      }
    })();
  } catch (err) {
    next(err);
  }
});

// ─── GET /sales-orders/:id/fulfillments ──────────────────────────────────────

router.get("/sales-orders/:id/fulfillments", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orderId = Number(req.params.id);

    const rows = await db
      .select({
        fulfillment: fulfillmentsTable,
        warehouseName: warehousesTable.name,
        orderNumber: salesOrdersTable.orderNumber,
        shopifyOrderId: salesOrdersTable.shopifyOrderId,
      })
      .from(fulfillmentsTable)
      .innerJoin(warehousesTable, eq(warehousesTable.id, fulfillmentsTable.warehouseId))
      .innerJoin(salesOrdersTable, eq(salesOrdersTable.id, fulfillmentsTable.salesOrderId))
      .where(
        and(
          eq(fulfillmentsTable.organizationId, t.organizationId),
          eq(fulfillmentsTable.salesOrderId, orderId),
        ),
      )
      .orderBy(desc(fulfillmentsTable.createdAt));

    res.json(
      rows.map((r) =>
        serializeFulfillment(r.fulfillment, r.warehouseName, r.orderNumber, r.shopifyOrderId),
      ),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
