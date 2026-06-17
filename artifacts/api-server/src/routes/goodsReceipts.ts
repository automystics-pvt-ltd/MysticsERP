import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  goodsReceiptsTable,
  goodsReceiptLinesTable,
  itemsTable,
  itemWarehouseStockTable,
  stockMovementsTable,
} from "@workspace/db";
import { tenantMiddleware, findBundleItems } from "../lib/tenant";
import {
  serializeGoodsReceipt,
  serializeGoodsReceiptLine,
} from "../lib/serializers";
import { nextOrderNumber } from "../lib/orderHelpers";
import { toNum, toStr } from "../lib/numeric";
import { pushStockToShopify } from "../lib/shopifyOutbound";
import { submitForApproval } from "../lib/approvalEngine";
import {
  applyBatchStockChange,
  insertBatchMovement,
  loadBatchMovementsForParents,
  parseBatchInArray,
  upsertBatchInTx,
  type ParsedBatchIn,
} from "../lib/batches";

const router: IRouter = Router();
router.use(tenantMiddleware);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const RECEIVABLE_ORDER_STATUSES = ["ordered", "partially_received"] as const;
const CANCEL_RECEIPT_ORDER_STATUSES = [
  "received",
  "partially_received",
] as const;

async function deriveAndUpdatePurchaseOrderStatus(
  tx: Tx,
  orgId: number,
  orderId: number,
) {
  const lines = await tx
    .select({
      quantity: purchaseOrderLinesTable.quantity,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
    })
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, orderId));
  let totalOrdered = 0;
  let totalReceived = 0;
  for (const l of lines) {
    totalOrdered += toNum(l.quantity);
    totalReceived += toNum(l.quantityReceived);
  }
  let nextStatus: "ordered" | "partially_received" | "received";
  if (totalReceived <= 0) nextStatus = "ordered";
  else if (totalReceived < totalOrdered) nextStatus = "partially_received";
  else nextStatus = "received";
  await tx
    .update(purchaseOrdersTable)
    .set({ status: nextStatus })
    .where(
      and(
        eq(purchaseOrdersTable.id, orderId),
        eq(purchaseOrdersTable.organizationId, orgId),
      ),
    );
  return nextStatus;
}

async function loadGoodsReceiptsForOrder(orgId: number, orderId: number) {
  const receipts = await db
    .select()
    .from(goodsReceiptsTable)
    .where(
      and(
        eq(goodsReceiptsTable.organizationId, orgId),
        eq(goodsReceiptsTable.purchaseOrderId, orderId),
      ),
    )
    .orderBy(desc(goodsReceiptsTable.createdAt));
  if (receipts.length === 0) return [];
  const ids = receipts.map((r) => r.id);
  const lineRows = await db
    .select({
      line: goodsReceiptLinesTable,
      itemName: itemsTable.name,
      sku: itemsTable.sku,
      purchaseOrderLineId: purchaseOrderLinesTable.id,
    })
    .from(goodsReceiptLinesTable)
    .innerJoin(
      purchaseOrderLinesTable,
      eq(purchaseOrderLinesTable.id, goodsReceiptLinesTable.purchaseOrderLineId),
    )
    .innerJoin(itemsTable, eq(itemsTable.id, purchaseOrderLinesTable.itemId))
    .where(
      and(
        eq(goodsReceiptLinesTable.organizationId, orgId),
        inArray(goodsReceiptLinesTable.goodsReceiptId, ids),
      ),
    );
  const linesByReceipt = new Map<number, typeof lineRows>();
  for (const r of lineRows) {
    const arr = linesByReceipt.get(r.line.goodsReceiptId) ?? [];
    arr.push(r);
    linesByReceipt.set(r.line.goodsReceiptId, arr);
  }

  // Determine which non-cancelled receipts have had their stock consumed.
  // We load purchase movements for all non-cancelled receipts in one query,
  // then compare summed movement qty per (item, warehouse) against current
  // on-hand stock. If on-hand < movement qty the stock has been used elsewhere
  // and the receipt cannot be cancelled.
  const activeIds = receipts
    .filter((r) => r.status !== "cancelled")
    .map((r) => r.id);

  const stockConsumedByReceipt = new Map<number, boolean>();

  if (activeIds.length > 0) {
    const movements = await db
      .select({
        referenceId: stockMovementsTable.referenceId,
        itemId: stockMovementsTable.itemId,
        warehouseId: stockMovementsTable.warehouseId,
        quantity: stockMovementsTable.quantity,
      })
      .from(stockMovementsTable)
      .where(
        and(
          eq(stockMovementsTable.organizationId, orgId),
          eq(stockMovementsTable.referenceType, "goods_receipt"),
          eq(stockMovementsTable.movementType, "purchase"),
          inArray(stockMovementsTable.referenceId, activeIds),
        ),
      ); // org-scope-allow: filtered by orgId above

    // Aggregate needed qty per (itemId, warehouseId) per receipt.
    type Key = `${number}:${number}`;
    type ReceiptNeeds = Map<Key, { itemId: number; warehouseId: number; qty: number }>;
    const needsByReceipt = new Map<number, ReceiptNeeds>();
    for (const m of movements) {
      const receiptId = m.referenceId!;
      if (!needsByReceipt.has(receiptId)) needsByReceipt.set(receiptId, new Map());
      const needs = needsByReceipt.get(receiptId)!;
      const key: Key = `${m.itemId}:${m.warehouseId}`;
      const prev = needs.get(key) ?? { itemId: m.itemId, warehouseId: m.warehouseId, qty: 0 };
      needs.set(key, { ...prev, qty: prev.qty + toNum(m.quantity) });
    }

    // Collect all (itemId, warehouseId) pairs we need to check.
    const pairsSet = new Set<Key>();
    for (const needs of needsByReceipt.values()) {
      for (const key of needs.keys()) pairsSet.add(key);
    }

    // Load current stock for all touched (item, warehouse) pairs.
    // We query item_warehouse_stock per unique itemId/warehouseId combo.
    const onHandMap = new Map<Key, number>();
    if (pairsSet.size > 0) {
      const uniqueItemIds = Array.from(new Set(movements.map((m) => m.itemId)));
      const uniqueWarehouseIds = Array.from(new Set(movements.map((m) => m.warehouseId)));
      const stockRows = await db
        .select({
          itemId: itemWarehouseStockTable.itemId,
          warehouseId: itemWarehouseStockTable.warehouseId,
          quantity: itemWarehouseStockTable.quantity,
        })
        .from(itemWarehouseStockTable)
        .where(
          and(
            eq(itemWarehouseStockTable.organizationId, orgId),
            inArray(itemWarehouseStockTable.itemId, uniqueItemIds),
            inArray(itemWarehouseStockTable.warehouseId, uniqueWarehouseIds),
          ),
        ); // org-scope-allow: filtered by orgId above
      for (const row of stockRows) {
        const key: Key = `${row.itemId}:${row.warehouseId}`;
        onHandMap.set(key, toNum(row.quantity));
      }
    }

    // Evaluate each receipt.
    for (const [receiptId, needs] of needsByReceipt) {
      let consumed = false;
      for (const [key, { qty }] of needs) {
        const onHand = onHandMap.get(key) ?? 0;
        if (onHand < qty) {
          consumed = true;
          break;
        }
      }
      stockConsumedByReceipt.set(receiptId, consumed);
    }
  }

  return receipts.map((r) => ({
    ...serializeGoodsReceipt(r),
    stockConsumed: stockConsumedByReceipt.get(r.id) ?? false,
    lines: (linesByReceipt.get(r.id) ?? []).map((row) =>
      serializeGoodsReceiptLine(
        row.line,
        row.itemName,
        row.sku,
        row.purchaseOrderLineId,
      ),
    ),
  }));
}

router.get("/purchase-orders/:id/goods-receipts", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orderId = Number(req.params.id);
    const owner = await db
      .select({ id: purchaseOrdersTable.id })
      .from(purchaseOrdersTable)
      .where(
        and(
          eq(purchaseOrdersTable.id, orderId),
          eq(purchaseOrdersTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!owner[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const receipts = await loadGoodsReceiptsForOrder(
      t.organizationId,
      orderId,
    );
    res.json(receipts);
  } catch (err) {
    next(err);
  }
});

router.post("/purchase-orders/:id/goods-receipts", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orderId = Number(req.params.id);
    const b = req.body ?? {};
    const inputLines = Array.isArray(b.lines) ? b.lines : [];
    if (inputLines.length === 0) {
      res
        .status(400)
        .json({ error: "At least one receipt line is required" });
      return;
    }
    type Input = {
      purchaseOrderLineId: number;
      quantity: number;
      // Raw batches array as supplied by the client; null when omitted.
      // Validated against the batch-tracked flag inside the transaction.
      batchesRaw: unknown;
    };
    const parsed: Input[] = [];
    for (const l of inputLines) {
      const lineId = Number(l?.purchaseOrderLineId);
      const qty = toNum(l?.quantity);
      if (!Number.isFinite(lineId) || lineId <= 0) {
        res
          .status(400)
          .json({ error: "Each line must include purchaseOrderLineId" });
        return;
      }
      if (!(qty > 0)) {
        res.status(400).json({
          error: "Each line quantity must be greater than zero",
        });
        return;
      }
      parsed.push({
        purchaseOrderLineId: lineId,
        quantity: qty,
        batchesRaw: l && typeof l === "object" ? (l as { batches?: unknown }).batches : undefined,
      });
    }
    const lineIds = parsed.map((p) => p.purchaseOrderLineId);
    if (new Set(lineIds).size !== lineIds.length) {
      res.status(400).json({
        error: "Duplicate purchaseOrderLineId in receipt lines",
      });
      return;
    }

    let receivedDate: string;
    if (typeof b.receivedDate === "string" && b.receivedDate.trim()) {
      const raw = b.receivedDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        res.status(400).json({
          error: "receivedDate must be an ISO date in YYYY-MM-DD format",
        });
        return;
      }
      const d = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
        res.status(400).json({ error: "receivedDate is not a valid date" });
        return;
      }
      receivedDate = raw;
    } else {
      receivedDate = new Date().toISOString().slice(0, 10);
    }
    const notes =
      typeof b.notes === "string" && b.notes.trim()
        ? String(b.notes).trim()
        : null;

    const result = await db.transaction(async (tx) => {
      const orderRows = await tx
        .select()
        .from(purchaseOrdersTable)
        .where(
          and(
            eq(purchaseOrdersTable.id, orderId),
            eq(purchaseOrdersTable.organizationId, t.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      const order = orderRows[0];
      if (!order) return { kind: "notfound" as const };
      if (
        !(RECEIVABLE_ORDER_STATUSES as readonly string[]).includes(order.status)
      ) {
        return {
          kind: "bad" as const,
          message: `Only ordered or partially-received purchase orders can record receipts (current: ${order.status}).`,
        };
      }

      // Block if there is already a pending-approval GRN for this order
      const pendingGrn = await tx
        .select({ id: goodsReceiptsTable.id })
        .from(goodsReceiptsTable)
        .where(
          and(
            eq(goodsReceiptsTable.organizationId, t.organizationId),
            eq(goodsReceiptsTable.purchaseOrderId, orderId),
            eq(goodsReceiptsTable.status, "pending_approval"),
          ),
        )
        .limit(1);
      if (pendingGrn[0]) {
        return {
          kind: "bad" as const,
          message:
            "A goods receipt is already pending approval for this order. Resolve it before creating a new one.",
        };
      }

      const lineRows = await tx
        .select()
        .from(purchaseOrderLinesTable)
        .where(eq(purchaseOrderLinesTable.purchaseOrderId, orderId));
      const linesById = new Map(lineRows.map((l) => [l.id, l]));

      for (const p of parsed) {
        const line = linesById.get(p.purchaseOrderLineId);
        if (!line) {
          return {
            kind: "bad" as const,
            message: `Line ${p.purchaseOrderLineId} does not belong to this order`,
          };
        }
        const ordered = toNum(line.quantity);
        const alreadyReceived = toNum(line.quantityReceived);
        const remaining = ordered - alreadyReceived;
        if (p.quantity - remaining > 1e-6) {
          return {
            kind: "bad" as const,
            message: `Line ${p.purchaseOrderLineId}: cannot receive ${p.quantity} (remaining ${remaining}).`,
          };
        }
      }

      // Pre-load referenced items so we can detect bundles (rejected) and
      // batch-tracked items (require batch capture) in one round-trip.
      const recvItemIds = Array.from(
        new Set(
          parsed.map((p) => linesById.get(p.purchaseOrderLineId)!.itemId),
        ),
      );
      const itemRows = recvItemIds.length
        ? await tx
            .select({
              id: itemsTable.id,
              isBundle: itemsTable.isBundle,
              trackBatches: itemsTable.trackBatches,
              sku: itemsTable.sku,
              name: itemsTable.name,
            })
            .from(itemsTable)
            .where(
              and(
                eq(itemsTable.organizationId, t.organizationId),
                inArray(itemsTable.id, recvItemIds),
              ),
            )
        : [];
      const itemById = new Map(itemRows.map((r) => [r.id, r]));

      const bundleItems = await findBundleItems(t.organizationId, recvItemIds);
      if (bundleItems.length > 0) {
        return {
          kind: "bad" as const,
          message:
            "Cannot receive lines whose item is now a bundle. Bundles do not hold physical stock.",
        };
      }

      // Validate batch capture for tracked items, and reject batches
      // payload for non-tracked items so UI bugs surface loudly.
      const lineBatches = new Map<number, ParsedBatchIn[]>();
      for (const p of parsed) {
        const line = linesById.get(p.purchaseOrderLineId)!;
        const itemMeta = itemById.get(line.itemId);
        const tracked = !!itemMeta?.trackBatches;
        if (tracked) {
          const parsedBatches = parseBatchInArray(p.batchesRaw, p.quantity);
          if (!parsedBatches.ok) {
            const label = itemMeta
              ? `${itemMeta.name} (${itemMeta.sku})`
              : `item ${line.itemId}`;
            return {
              kind: "bad" as const,
              message: `${label}: ${parsedBatches.error}`,
            };
          }
          lineBatches.set(p.purchaseOrderLineId, parsedBatches.rows);
        } else if (p.batchesRaw !== undefined) {
          // Non-tracked item received a batches payload — reject.
          if (Array.isArray(p.batchesRaw) && p.batchesRaw.length > 0) {
            const label = itemMeta
              ? `${itemMeta.name} (${itemMeta.sku})`
              : `item ${line.itemId}`;
            return {
              kind: "bad" as const,
              message: `${label} is not batch-tracked; remove the batches array from this line`,
            };
          }
        }
      }

      const inserted = await tx
        .insert(goodsReceiptsTable)
        .values({
          organizationId: t.organizationId,
          purchaseOrderId: orderId,
          receiptNumber: nextOrderNumber("GRN"),
          receivedDate,
          status: "received",
          notes,
        })
        .returning();
      const receipt = inserted[0]!;

      await tx.insert(goodsReceiptLinesTable).values(
        parsed.map((p) => ({
          organizationId: t.organizationId,
          goodsReceiptId: receipt.id,
          purchaseOrderLineId: p.purchaseOrderLineId,
          quantity: toStr(p.quantity),
        })),
      );

      // Approval workflow gate: if configured, stage the receipt for approval
      // instead of applying stock immediately.  For batch-tracked lines we
      // upsert the item_batch rows now (so they exist when approval fires) and
      // store the resolved (itemBatchId, quantity, poLineId) triples in
      // pendingBatchPicksJson so the callback can write batch stock movements.
      const approvalResult = await submitForApproval(
        tx,
        t.organizationId,
        "goods_receipts",
        receipt.id,
        receipt.receiptNumber,
        t.userId,
      );
      if (approvalResult) {
        const batchPicksList: Array<{
          purchaseOrderLineId: number;
          itemBatchId: number;
          quantity: number;
        }> = [];
        for (const [poLineId, batchRows] of lineBatches) {
          const poLine = linesById.get(poLineId)!;
          for (const br of batchRows) {
            const upserted = await upsertBatchInTx(
              tx,
              t.organizationId,
              poLine.itemId,
              br,
            );
            if (!upserted.ok) {
              return { kind: "bad" as const, message: upserted.error };
            }
            batchPicksList.push({
              purchaseOrderLineId: poLineId,
              itemBatchId: upserted.itemBatchId,
              quantity: br.quantity,
            });
          }
        }
        await tx
          .update(goodsReceiptsTable)
          .set({
            status: "pending_approval",
            pendingBatchPicksJson:
              batchPicksList.length > 0 ? batchPicksList : null,
          })
          .where(
            and(
              eq(goodsReceiptsTable.id, receipt.id),
              eq(goodsReceiptsTable.organizationId, t.organizationId),
            ),
          );
        return {
          kind: "pending_approval" as const,
          receiptId: receipt.id,
        };
      }

      const touchedItems = new Set<number>();
      // Collect qty and value per item to compute weighted avg cost after all
      // stock rows have been updated (so the SUM query sees the final on-hand).
      const receivedByItem = new Map<number, { totalQty: number; totalValue: number }>();
      for (const p of parsed) {
        const line = linesById.get(p.purchaseOrderLineId)!;
        const qty = p.quantity;
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
        const movementInserted = await tx
          .insert(stockMovementsTable)
          .values({
            organizationId: t.organizationId,
            itemId: line.itemId,
            warehouseId: order.warehouseId,
            movementType: "purchase",
            quantity: toStr(qty),
            referenceType: "goods_receipt",
            referenceId: receipt.id,
            notes: `Receipt ${receipt.receiptNumber} for order ${order.orderNumber}`,
          })
          .returning({ id: stockMovementsTable.id });
        const parentMovementId = movementInserted[0]!.id;

        // Batch fan-out: upsert each batch and write a per-batch ledger
        // row tied to the parent stock movement. Sum equals the parent
        // quantity by construction (validated above).
        const batchRows = lineBatches.get(p.purchaseOrderLineId);
        if (batchRows) {
          for (const br of batchRows) {
            const upserted = await upsertBatchInTx(
              tx,
              t.organizationId,
              line.itemId,
              br,
            );
            if (!upserted.ok) {
              return { kind: "bad" as const, message: upserted.error };
            }
            await applyBatchStockChange(
              tx,
              t.organizationId,
              upserted.itemBatchId,
              order.warehouseId,
              br.quantity,
            );
            await insertBatchMovement(
              tx,
              t.organizationId,
              parentMovementId,
              upserted.itemBatchId,
              order.warehouseId,
              br.quantity,
            );
          }
        }

        await tx
          .update(purchaseOrderLinesTable)
          .set({
            quantityReceived: toStr(toNum(line.quantityReceived) + qty),
          })
          .where(eq(purchaseOrderLinesTable.id, line.id));
        touchedItems.add(line.itemId);

        // Accumulate received qty and value for weighted avg cost update below.
        const unitPrice = toNum(line.unitPrice);
        const prev = receivedByItem.get(line.itemId) ?? { totalQty: 0, totalValue: 0 };
        receivedByItem.set(line.itemId, {
          totalQty: prev.totalQty + qty,
          totalValue: prev.totalValue + qty * unitPrice,
        });
      }

      // Update avg_cost for each received item using a weighted average.
      // Formula: newAvg = (prevOnHand × prevAvgCost + receivedQty × unitPrice) / newOnHand
      // We read total on-hand AFTER stock updates (still within tx) so we can
      // back-calculate prevOnHand = newOnHand - receivedQty.
      for (const [itemId, { totalQty, totalValue }] of receivedByItem) {
        const [onHandRow] = await tx
          .select({ total: sql<string>`SUM(quantity)` })
          .from(itemWarehouseStockTable)
          .where(
            and(
              eq(itemWarehouseStockTable.organizationId, t.organizationId),
              eq(itemWarehouseStockTable.itemId, itemId),
            ),
          );
        const newOnHand = toNum(onHandRow?.total ?? "0");
        if (newOnHand <= 0) continue;
        const [itemRow] = await tx
          .select({ avgCost: itemsTable.avgCost })
          .from(itemsTable)
          .where(
            and(
              eq(itemsTable.organizationId, t.organizationId),
              eq(itemsTable.id, itemId),
            ),
          )
          .limit(1); // org-scope-allow: item is already locked by GR transaction
        const prevOnHand = newOnHand - totalQty;
        const currentAvg = toNum(itemRow?.avgCost ?? "0");
        const prevValue = prevOnHand > 0 ? prevOnHand * currentAvg : 0;
        const newAvgCost = (prevValue + totalValue) / newOnHand;
        await tx
          .update(itemsTable)
          .set({ avgCost: toStr(newAvgCost) })
          .where(
            and(
              eq(itemsTable.organizationId, t.organizationId),
              eq(itemsTable.id, itemId),
            ),
          );
      }

      await deriveAndUpdatePurchaseOrderStatus(tx, t.organizationId, orderId);
      return {
        kind: "ok" as const,
        receiptId: receipt.id,
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
    if (result.kind === "pending_approval") {
      const receipts = await loadGoodsReceiptsForOrder(
        t.organizationId,
        orderId,
      );
      const staged = receipts.find((r) => r.id === result.receiptId);
      res.status(202).json({ ...(staged ?? {}), approvalRequired: true });
      return;
    }
    for (const itemId of result.itemIds) {
      pushStockToShopify(t.organizationId, itemId);
    }
    const receipts = await loadGoodsReceiptsForOrder(
      t.organizationId,
      orderId,
    );
    const created = receipts.find((r) => r.id === result.receiptId);
    res.status(201).json(created ?? null);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/goods-receipts/:goodsReceiptId/cancel",
  async (req, res, next) => {
    try {
      const t = req.tenant!;
      const receiptId = Number(req.params.goodsReceiptId);

      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(goodsReceiptsTable)
          .where(
            and(
              eq(goodsReceiptsTable.id, receiptId),
              eq(goodsReceiptsTable.organizationId, t.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        const receipt = rows[0];
        if (!receipt) return { kind: "notfound" as const };
        if (receipt.status === "cancelled") {
          return {
            kind: "bad" as const,
            message: "Receipt is already cancelled",
          };
        }
        const orderRows = await tx
          .select()
          .from(purchaseOrdersTable)
          .where(
            and(
              eq(purchaseOrdersTable.id, receipt.purchaseOrderId),
              eq(purchaseOrdersTable.organizationId, t.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        const order = orderRows[0];
        if (!order) return { kind: "notfound" as const };
        if (
          !(CANCEL_RECEIPT_ORDER_STATUSES as readonly string[]).includes(
            order.status,
          )
        ) {
          return {
            kind: "bad" as const,
            message: `Cannot cancel a receipt when the order is ${order.status}.`,
          };
        }

        const receiptLines = await tx
          .select({
            line: goodsReceiptLinesTable,
            itemId: purchaseOrderLinesTable.itemId,
            orderLineId: purchaseOrderLinesTable.id,
            orderLineQuantityReceived:
              purchaseOrderLinesTable.quantityReceived,
          })
          .from(goodsReceiptLinesTable)
          .innerJoin(
            purchaseOrderLinesTable,
            eq(
              purchaseOrderLinesTable.id,
              goodsReceiptLinesTable.purchaseOrderLineId,
            ),
          )
          .where(
            and(
              eq(goodsReceiptLinesTable.organizationId, t.organizationId),
              eq(goodsReceiptLinesTable.goodsReceiptId, receiptId),
            ),
          );

        // Look up all original purchase parent movements BEFORE marking
        // as cancelled so we can run the stock-sufficiency pre-check.
        const originalParents = await tx
          .select({
            id: stockMovementsTable.id,
            itemId: stockMovementsTable.itemId,
            warehouseId: stockMovementsTable.warehouseId,
            quantity: stockMovementsTable.quantity,
          })
          .from(stockMovementsTable)
          .where(
            and(
              eq(stockMovementsTable.organizationId, t.organizationId),
              eq(stockMovementsTable.referenceType, "goods_receipt"),
              eq(stockMovementsTable.referenceId, receiptId),
              eq(stockMovementsTable.movementType, "purchase"),
            ),
          )
          .orderBy(stockMovementsTable.id);

        // Pre-check: ensure every (item, warehouse) has enough on-hand
        // stock to absorb the reversal. Reject with 409 if not.
        for (const parent of originalParents) {
          const qty = toNum(parent.quantity);
          const stockRows = await tx
            .select({ quantity: itemWarehouseStockTable.quantity })
            .from(itemWarehouseStockTable)
            .where(
              and(
                eq(itemWarehouseStockTable.organizationId, t.organizationId),
                eq(itemWarehouseStockTable.itemId, parent.itemId),
                eq(itemWarehouseStockTable.warehouseId, parent.warehouseId),
              ),
            )
            .limit(1);
          const onHand = toNum(stockRows[0]?.quantity ?? "0");
          if (onHand < qty) {
            return {
              kind: "insufficient" as const,
              message:
                "Cannot cancel this receipt — some of the received stock has already been consumed or transferred out. Reverse those transactions first.",
            };
          }
        }

        // All checks passed — mark the receipt as cancelled.
        await tx
          .update(goodsReceiptsTable)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(goodsReceiptsTable.organizationId, t.organizationId),
              eq(goodsReceiptsTable.id, receiptId),
            ),
          );

        const allBatchMvts = await loadBatchMovementsForParents(
          t.organizationId,
          originalParents.map((p) => p.id),
        );
        const batchByParent = new Map<number, typeof allBatchMvts>();
        for (const m of allBatchMvts) {
          const arr = batchByParent.get(m.stockMovementId) ?? [];
          arr.push(m);
          batchByParent.set(m.stockMovementId, arr);
        }

        const touchedItems = new Set<number>();
        // Reverse stock from each original parent. Each cancellation
        // parent mirrors its original 1:1, with the batch ledger
        // reversed onto the new cancellation parent.
        for (const parent of originalParents) {
          const qty = toNum(parent.quantity); // positive
          const stockRows = await tx
            .select()
            .from(itemWarehouseStockTable)
            .where(
              and(
                eq(itemWarehouseStockTable.organizationId, t.organizationId),
                eq(itemWarehouseStockTable.itemId, parent.itemId),
                eq(itemWarehouseStockTable.warehouseId, parent.warehouseId),
              ),
            )
            .limit(1);
          if (stockRows[0]) {
            await tx
              .update(itemWarehouseStockTable)
              .set({
                quantity: toStr(toNum(stockRows[0].quantity) - qty),
              })
              .where(
                and(
                  eq(itemWarehouseStockTable.organizationId, t.organizationId),
                  eq(itemWarehouseStockTable.id, stockRows[0].id),
                ),
              );
          } else {
            await tx.insert(itemWarehouseStockTable).values({
              organizationId: t.organizationId,
              itemId: parent.itemId,
              warehouseId: parent.warehouseId,
              quantity: toStr(-qty),
            });
          }
          const cancelInserted = await tx
            .insert(stockMovementsTable)
            .values({
              organizationId: t.organizationId,
              itemId: parent.itemId,
              warehouseId: parent.warehouseId,
              movementType: "goods_receipt_cancelled",
              quantity: toStr(-qty),
              referenceType: "goods_receipt",
              referenceId: receiptId,
              notes: `Cancelled receipt ${receipt.receiptNumber}`,
            })
            .returning({ id: stockMovementsTable.id });
          const cancelParentId = cancelInserted[0]!.id;
          for (const bm of batchByParent.get(parent.id) ?? []) {
            // bm.quantity is the original positive batch qty.
            await applyBatchStockChange(
              tx,
              t.organizationId,
              bm.itemBatchId,
              bm.warehouseId,
              -bm.quantity,
            );
            await insertBatchMovement(
              tx,
              t.organizationId,
              cancelParentId,
              bm.itemBatchId,
              bm.warehouseId,
              -bm.quantity,
            );
          }
          touchedItems.add(parent.itemId);
        }

        // Update each PO line's quantityReceived from the receipt-line
        // metadata. Independent of the parent-movement loop above.
        for (const rl of receiptLines) {
          const qty = toNum(rl.line.quantity);
          await tx
            .update(purchaseOrderLinesTable)
            .set({
              quantityReceived: toStr(
                Math.max(0, toNum(rl.orderLineQuantityReceived) - qty),
              ),
            })
            .where(eq(purchaseOrderLinesTable.id, rl.orderLineId));
          touchedItems.add(rl.itemId);
        }

        await deriveAndUpdatePurchaseOrderStatus(
          tx,
          t.organizationId,
          receipt.purchaseOrderId,
        );
        return {
          kind: "ok" as const,
          purchaseOrderId: receipt.purchaseOrderId,
          itemIds: Array.from(touchedItems),
        };
      });

      if (result.kind === "notfound") {
        res.status(404).json({ message: "Not found" });
        return;
      }
      if (result.kind === "insufficient") {
        res.status(409).json({ message: result.message });
        return;
      }
      if (result.kind === "bad") {
        res.status(400).json({ message: result.message });
        return;
      }
      for (const itemId of result.itemIds) {
        pushStockToShopify(t.organizationId, itemId);
      }
      const receipts = await loadGoodsReceiptsForOrder(
        t.organizationId,
        result.purchaseOrderId,
      );
      const updated = receipts.find((r) => r.id === receiptId);
      res.json(updated ?? null);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/goods-receipts/:id/pdf", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid goods receipt id" });
      return;
    }
    const { loadGoodsReceiptPdf } = await import("../lib/goodsReceiptPdfData");
    const result = await loadGoodsReceiptPdf(t.organizationId, id);
    if ("notFound" in result) {
      res.status(404).json({ error: "Goods receipt not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="grn-${result.receiptNumber}.pdf"`,
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.setHeader("Content-Length", String(result.pdf.length));
    res.send(result.pdf);
  } catch (err) {
    next(err);
  }
});

export default router;
export { loadGoodsReceiptsForOrder, deriveAndUpdatePurchaseOrderStatus };
