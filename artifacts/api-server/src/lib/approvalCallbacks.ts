import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  stockTransfersTable,
  stockTransferLinesTable,
  goodsReceiptsTable,
  goodsReceiptLinesTable,
  itemWarehouseStockTable,
  stockMovementsTable,
  supplierPaymentsTable,
  supplierPaymentAllocationsTable,
  suppliersTable,
  itemsTable,
  stagedWriteOffsTable,
} from "@workspace/db";
import { toNum, toStr } from "./numeric";
import { applyBatchStockChange, insertBatchMovement } from "./batches";

const PAYABLE_PURCHASE_STATUSES = [
  "ordered",
  "partially_received",
  "received",
  "billed",
] as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function upsertItemWarehouseStock(
  tx: Tx,
  orgId: number,
  itemId: number,
  warehouseId: number,
  delta: number,
): Promise<void> {
  const updated = await tx
    .update(itemWarehouseStockTable)
    .set({
      quantity: sql`${itemWarehouseStockTable.quantity} + ${toStr(delta)}::numeric`,
    })
    .where(
      and(
        eq(itemWarehouseStockTable.organizationId, orgId),
        eq(itemWarehouseStockTable.itemId, itemId),
        eq(itemWarehouseStockTable.warehouseId, warehouseId),
      ),
    )
    .returning({ id: itemWarehouseStockTable.id });
  if (updated.length === 0 && delta > 0) {
    await tx.insert(itemWarehouseStockTable).values({
      organizationId: orgId,
      itemId,
      warehouseId,
      quantity: toStr(delta),
    });
  }
}

async function derivePurchaseOrderStatus(
  tx: Tx,
  orgId: number,
  orderId: number,
): Promise<void> {
  const lines = await tx
    .select({
      quantityOrdered: purchaseOrderLinesTable.quantity,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
    })
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, orderId)); // org-scope via PK join

  if (lines.length === 0) return;

  const totalOrdered = lines.reduce((s, l) => s + toNum(l.quantityOrdered), 0);
  const totalReceived = lines.reduce(
    (s, l) => s + toNum(l.quantityReceived),
    0,
  );

  let nextStatus = "ordered";
  if (totalReceived >= totalOrdered - 1e-6) {
    nextStatus = "received";
  } else if (totalReceived > 1e-6) {
    nextStatus = "partially_received";
  }

  await tx
    .update(purchaseOrdersTable)
    .set({ status: nextStatus })
    .where(
      and(
        eq(purchaseOrdersTable.id, orderId),
        eq(purchaseOrdersTable.organizationId, orgId),
      ),
    );
}

// ─── Execute callback (on full approval) ────────────────────────────────────

export async function executeApprovalCallback(
  tx: Tx,
  orgId: number,
  module: string,
  recordId: number,
): Promise<{ touchedItemIds: number[] }> {
  switch (module) {
    case "purchase_orders": {
      await tx
        .update(purchaseOrdersTable)
        .set({ status: "ordered" })
        .where(
          and(
            eq(purchaseOrdersTable.id, recordId),
            eq(purchaseOrdersTable.organizationId, orgId),
            eq(purchaseOrdersTable.status, "pending_approval"),
          ),
        );
      return { touchedItemIds: [] };
    }

    case "stock_transfers": {
      const [transfer] = await tx
        .select()
        .from(stockTransfersTable)
        .where(
          and(
            eq(stockTransfersTable.id, recordId),
            eq(stockTransfersTable.organizationId, orgId),
          ),
        )
        .for("update")
        .limit(1);
      if (!transfer || transfer.status !== "pending_approval") {
        return { touchedItemIds: [] };
      }

      const lines = await tx
        .select()
        .from(stockTransferLinesTable)
        .where(
          and(
            eq(stockTransferLinesTable.organizationId, orgId),
            eq(stockTransferLinesTable.stockTransferId, recordId),
          ),
        );

      // Decode staged batch picks (shape: [{itemId, picks:[{itemBatchId,quantity}]}])
      const stagedPicks = (
        transfer.pendingBatchPicksJson as Array<{
          itemId: number;
          picks: Array<{ itemBatchId: number; quantity: number }>;
        }> | null
      ) ?? [];
      const batchPicksByItem = new Map<
        number,
        Array<{ itemBatchId: number; quantity: number }>
      >();
      for (const entry of stagedPicks) {
        batchPicksByItem.set(entry.itemId, entry.picks);
      }

      const touchedItemIds: number[] = [];

      for (const line of lines) {
        const qty = toNum(line.quantity);

        // Re-validate source stock
        const [stockRow] = await tx
          .select({ quantity: itemWarehouseStockTable.quantity })
          .from(itemWarehouseStockTable)
          .where(
            and(
              eq(itemWarehouseStockTable.organizationId, orgId),
              eq(itemWarehouseStockTable.itemId, line.itemId),
              eq(itemWarehouseStockTable.warehouseId, transfer.fromWarehouseId),
            ),
          )
          .for("update")
          .limit(1);

        const onHand = stockRow ? toNum(stockRow.quantity) : 0;
        if (qty > onHand + 1e-6) {
          // Insufficient stock — revert to draft and fail
          await tx
            .update(stockTransfersTable)
            .set({ status: "draft", pendingBatchPicksJson: null })
            .where(
              and(
                eq(stockTransfersTable.id, recordId),
                eq(stockTransfersTable.organizationId, orgId),
              ),
            );
          throw Object.assign(
            new Error(
              `Insufficient stock for item #${line.itemId} at source warehouse when executing dispatch. Transfer reverted to draft.`,
            ),
            { status: 409 },
          );
        }

        await upsertItemWarehouseStock(
          tx,
          orgId,
          line.itemId,
          transfer.fromWarehouseId,
          -qty,
        );
        const mvt = await tx
          .insert(stockMovementsTable)
          .values({
            organizationId: orgId,
            itemId: line.itemId,
            warehouseId: transfer.fromWarehouseId,
            movementType: "transfer_out",
            quantity: toStr(-qty),
            referenceType: "stock_transfer",
            referenceId: recordId,
            notes: transfer.notes ?? undefined,
          })
          .returning({ id: stockMovementsTable.id });
        const parentMovementId = mvt[0]!.id;

        const picks = batchPicksByItem.get(line.itemId);
        if (picks) {
          for (const pick of picks) {
            await applyBatchStockChange(
              tx,
              orgId,
              pick.itemBatchId,
              transfer.fromWarehouseId,
              -pick.quantity,
            );
            await insertBatchMovement(
              tx,
              orgId,
              parentMovementId,
              pick.itemBatchId,
              transfer.fromWarehouseId,
              -pick.quantity,
            );
          }
        }

        touchedItemIds.push(line.itemId);
      }

      await tx
        .update(stockTransfersTable)
        .set({ status: "in_transit", pendingBatchPicksJson: null })
        .where(
          and(
            eq(stockTransfersTable.id, recordId),
            eq(stockTransfersTable.organizationId, orgId),
          ),
        );

      return { touchedItemIds };
    }

    case "goods_receipts": {
      const [receipt] = await tx
        .select()
        .from(goodsReceiptsTable)
        .where(
          and(
            eq(goodsReceiptsTable.id, recordId),
            eq(goodsReceiptsTable.organizationId, orgId),
          ),
        )
        .for("update")
        .limit(1);
      if (!receipt || receipt.status !== "pending_approval") {
        return { touchedItemIds: [] };
      }

      const lineRows = await tx
        .select({
          grLineId: goodsReceiptLinesTable.id,
          grLinePoLineId: goodsReceiptLinesTable.purchaseOrderLineId,
          grLineQty: goodsReceiptLinesTable.quantity,
          poLineItemId: purchaseOrderLinesTable.itemId,
          poLineUnitPrice: purchaseOrderLinesTable.unitPrice,
          poLineQuantityReceived: purchaseOrderLinesTable.quantityReceived,
          orderId: purchaseOrdersTable.id,
          warehouseId: purchaseOrdersTable.warehouseId,
        })
        .from(goodsReceiptLinesTable)
        .innerJoin(
          purchaseOrderLinesTable,
          eq(purchaseOrderLinesTable.id, goodsReceiptLinesTable.purchaseOrderLineId),
        )
        .innerJoin(
          purchaseOrdersTable,
          eq(purchaseOrdersTable.id, purchaseOrderLinesTable.purchaseOrderId),
        )
        .where(
          and(
            eq(goodsReceiptLinesTable.organizationId, orgId),
            eq(goodsReceiptLinesTable.goodsReceiptId, recordId),
          ),
        );

      if (lineRows.length === 0) {
        return { touchedItemIds: [] };
      }

      // Decode staged batch picks (shape: [{purchaseOrderLineId, itemBatchId, quantity}])
      const stagedBatchPicks = (
        receipt.pendingBatchPicksJson as Array<{
          purchaseOrderLineId: number;
          itemBatchId: number;
          quantity: number;
        }> | null
      ) ?? [];
      const batchPicksByPoLine = new Map<
        number,
        Array<{ itemBatchId: number; quantity: number }>
      >();
      for (const pick of stagedBatchPicks) {
        const arr = batchPicksByPoLine.get(pick.purchaseOrderLineId) ?? [];
        arr.push({ itemBatchId: pick.itemBatchId, quantity: pick.quantity });
        batchPicksByPoLine.set(pick.purchaseOrderLineId, arr);
      }

      const orderId = lineRows[0].orderId;
      const touchedItemIds: number[] = [];
      const receivedByItem = new Map<
        number,
        { totalQty: number; totalValue: number }
      >();

      for (const row of lineRows) {
        const qty = toNum(row.grLineQty);
        const warehouseId = row.warehouseId;
        const itemId = row.poLineItemId;
        const unitPrice = toNum(row.poLineUnitPrice ?? "0");

        await upsertItemWarehouseStock(tx, orgId, itemId, warehouseId, qty);
        const mvt = await tx
          .insert(stockMovementsTable)
          .values({
            organizationId: orgId,
            itemId,
            warehouseId,
            movementType: "purchase",
            quantity: toStr(qty),
            referenceType: "goods_receipt",
            referenceId: recordId,
          })
          .returning({ id: stockMovementsTable.id });
        const parentMovementId = mvt[0]!.id;

        const picks = batchPicksByPoLine.get(row.grLinePoLineId) ?? [];
        for (const pick of picks) {
          await applyBatchStockChange(tx, orgId, pick.itemBatchId, warehouseId, pick.quantity);
          await insertBatchMovement(tx, orgId, parentMovementId, pick.itemBatchId, warehouseId, pick.quantity);
        }

        await tx
          .update(purchaseOrderLinesTable)
          .set({
            quantityReceived: toStr(toNum(row.poLineQuantityReceived) + qty),
          })
          .where(eq(purchaseOrderLinesTable.id, row.grLinePoLineId));

        touchedItemIds.push(itemId);
        const prev = receivedByItem.get(itemId) ?? {
          totalQty: 0,
          totalValue: 0,
        };
        receivedByItem.set(itemId, {
          totalQty: prev.totalQty + qty,
          totalValue: prev.totalValue + qty * unitPrice,
        });
      }

      // Update weighted-average cost for each received item
      for (const [itemId, { totalQty, totalValue }] of receivedByItem) {
        const [onHandRow] = await tx
          .select({ total: sql<string>`SUM(quantity)` })
          .from(itemWarehouseStockTable)
          .where(
            and(
              eq(itemWarehouseStockTable.organizationId, orgId),
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
              eq(itemsTable.organizationId, orgId),
              eq(itemsTable.id, itemId),
            ),
          )
          .limit(1); // org-scope-allow: scoped by organizationId above
        const prevOnHand = newOnHand - totalQty;
        const currentAvg = toNum(itemRow?.avgCost ?? "0");
        const prevValue = prevOnHand > 0 ? prevOnHand * currentAvg : 0;
        const newAvgCost = (prevValue + totalValue) / newOnHand;
        await tx
          .update(itemsTable)
          .set({ avgCost: toStr(newAvgCost) })
          .where(
            and(
              eq(itemsTable.organizationId, orgId),
              eq(itemsTable.id, itemId),
            ),
          );
      }

      await tx
        .update(goodsReceiptsTable)
        .set({ status: "received" })
        .where(
          and(
            eq(goodsReceiptsTable.id, recordId),
            eq(goodsReceiptsTable.organizationId, orgId),
          ),
        );

      await derivePurchaseOrderStatus(tx, orgId, orderId);

      return { touchedItemIds: Array.from(new Set(touchedItemIds)) };
    }

    case "supplier_payments": {
      const [payment] = await tx
        .select()
        .from(supplierPaymentsTable)
        .where(
          and(
            eq(supplierPaymentsTable.id, recordId),
            eq(supplierPaymentsTable.organizationId, orgId),
          ),
        )
        .for("update")
        .limit(1);
      if (!payment || payment.status !== "pending_approval") {
        return { touchedItemIds: [] };
      }

      const allocations = (
        payment.pendingAllocationsJson as Array<{
          purchaseOrderId: number;
          amount: string;
        }> | null
      ) ?? [];

      for (const alloc of allocations) {
        const allocAmt = toNum(alloc.amount);
        // Re-validate: order must still be payable and have sufficient balance.
        // Mirror the precondition check from the direct payment creation path
        // so that state changes while the payment was pending don't produce
        // over-allocations or payments against cancelled/received orders.
        const updated = await tx
          .update(purchaseOrdersTable)
          .set({
            amountPaid: sql`${purchaseOrdersTable.amountPaid} + ${toStr(allocAmt)}::numeric`,
            balanceDue: sql`${purchaseOrdersTable.balanceDue} - ${toStr(allocAmt)}::numeric`,
          })
          .where(
            and(
              eq(purchaseOrdersTable.id, alloc.purchaseOrderId),
              eq(purchaseOrdersTable.organizationId, orgId),
              eq(purchaseOrdersTable.supplierId, payment.supplierId),
              sql`${purchaseOrdersTable.balanceDue} >= ${toStr(allocAmt)}::numeric`,
              inArray(
                purchaseOrdersTable.status,
                PAYABLE_PURCHASE_STATUSES as unknown as string[],
              ),
            ),
          )
          .returning({ id: purchaseOrdersTable.id });
        if (updated.length === 0) {
          // Revert payment to cancelled so the approver knows it failed
          await tx
            .update(supplierPaymentsTable)
            .set({ status: "cancelled", pendingAllocationsJson: null })
            .where(
              and(
                eq(supplierPaymentsTable.id, recordId),
                eq(supplierPaymentsTable.organizationId, orgId),
              ),
            );
          throw Object.assign(
            new Error(
              `Allocation for order ${alloc.purchaseOrderId} is now invalid: order status or balance has changed since submission. Payment cancelled.`,
            ),
            { status: 409 },
          );
        }
        await tx.insert(supplierPaymentAllocationsTable).values({
          organizationId: orgId,
          paymentId: payment.id,
          purchaseOrderId: alloc.purchaseOrderId,
          amount: toStr(allocAmt),
        });
      }

      // Update supplier outstanding payable
      const totalAmt = toNum(payment.amount);
      await tx
        .update(suppliersTable)
        .set({
          outstandingPayable: sql`${suppliersTable.outstandingPayable} - ${toStr(totalAmt)}::numeric`,
        })
        .where(
          and(
            eq(suppliersTable.id, payment.supplierId),
            eq(suppliersTable.organizationId, orgId),
          ),
        );

      await tx
        .update(supplierPaymentsTable)
        .set({ status: "approved", pendingAllocationsJson: null })
        .where(
          and(
            eq(supplierPaymentsTable.id, recordId),
            eq(supplierPaymentsTable.organizationId, orgId),
          ),
        );

      return { touchedItemIds: [] };
    }

    case "write_offs": {
      const [writeOff] = await tx
        .select()
        .from(stagedWriteOffsTable)
        .where(
          and(
            eq(stagedWriteOffsTable.id, recordId),
            eq(stagedWriteOffsTable.organizationId, orgId),
          ),
        )
        .for("update")
        .limit(1);
      if (!writeOff || writeOff.status !== "pending_approval") {
        return { touchedItemIds: [] };
      }

      const qty = toNum(writeOff.quantity);
      await upsertItemWarehouseStock(
        tx,
        orgId,
        writeOff.itemId,
        writeOff.warehouseId,
        -qty,
      );
      await tx.insert(stockMovementsTable).values({
        organizationId: orgId,
        itemId: writeOff.itemId,
        warehouseId: writeOff.warehouseId,
        movementType: writeOff.movementType,
        quantity: toStr(-qty),
        referenceType: "write_off",
        referenceId: recordId,
        notes: writeOff.notes ?? undefined,
      });

      await tx
        .update(stagedWriteOffsTable)
        .set({ status: "applied" })
        .where(
          and(
            eq(stagedWriteOffsTable.id, recordId),
            eq(stagedWriteOffsTable.organizationId, orgId),
          ),
        );

      return { touchedItemIds: [writeOff.itemId] };
    }

    default:
      return { touchedItemIds: [] };
  }
}

// ─── Revert callback (on rejection or send-back) ─────────────────────────────

export async function revertApprovalCallback(
  tx: Tx,
  orgId: number,
  module: string,
  recordId: number,
): Promise<void> {
  switch (module) {
    case "purchase_orders": {
      await tx
        .update(purchaseOrdersTable)
        .set({ status: "draft" })
        .where(
          and(
            eq(purchaseOrdersTable.id, recordId),
            eq(purchaseOrdersTable.organizationId, orgId),
            eq(purchaseOrdersTable.status, "pending_approval"),
          ),
        );
      break;
    }

    case "stock_transfers": {
      await tx
        .update(stockTransfersTable)
        .set({ status: "draft", pendingBatchPicksJson: null })
        .where(
          and(
            eq(stockTransfersTable.id, recordId),
            eq(stockTransfersTable.organizationId, orgId),
            eq(stockTransfersTable.status, "pending_approval"),
          ),
        );
      break;
    }

    case "goods_receipts": {
      await tx
        .update(goodsReceiptsTable)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(goodsReceiptsTable.id, recordId),
            eq(goodsReceiptsTable.organizationId, orgId),
            eq(goodsReceiptsTable.status, "pending_approval"),
          ),
        );
      break;
    }

    case "supplier_payments": {
      await tx
        .update(supplierPaymentsTable)
        .set({ status: "cancelled", pendingAllocationsJson: null })
        .where(
          and(
            eq(supplierPaymentsTable.id, recordId),
            eq(supplierPaymentsTable.organizationId, orgId),
            eq(supplierPaymentsTable.status, "pending_approval"),
          ),
        );
      break;
    }

    case "write_offs": {
      await tx
        .update(stagedWriteOffsTable)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(stagedWriteOffsTable.id, recordId),
            eq(stagedWriteOffsTable.organizationId, orgId),
            eq(stagedWriteOffsTable.status, "pending_approval"),
          ),
        );
      break;
    }

    default:
      break;
  }
}
