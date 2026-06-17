import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  db,
  stockMovementsTable,
  itemsTable,
  warehousesTable,
  goodsReceiptsTable,
  shipmentsTable,
  itemWarehouseStockTable,
  stagedWriteOffsTable,
  approvalWorkflowsTable,
} from "@workspace/db";
import { tenantMiddleware, assertOwnership } from "../lib/tenant";
import { submitForApproval } from "../lib/approvalEngine";
import { toNum, toStr } from "../lib/numeric";
import { serializeStockMovement } from "../lib/serializers";

const router: IRouter = Router();
router.use(tenantMiddleware);

router.get("/stock-movements", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const conds = [eq(stockMovementsTable.organizationId, t.organizationId)];
    if (req.query.itemId) {
      conds.push(eq(stockMovementsTable.itemId, Number(req.query.itemId)));
    }
    if (req.query.warehouseId) {
      conds.push(eq(stockMovementsTable.warehouseId, Number(req.query.warehouseId)));
    }
    if (req.query.referenceType) {
      conds.push(eq(stockMovementsTable.referenceType, String(req.query.referenceType)));
    }
    if (req.query.referenceId) {
      conds.push(eq(stockMovementsTable.referenceId, Number(req.query.referenceId)));
    }
    if (req.query.purchaseOrderId) {
      const poId = Number(req.query.purchaseOrderId);
      const receiptIds = await db
        .select({ id: goodsReceiptsTable.id })
        .from(goodsReceiptsTable)
        .where(
          and(
            eq(goodsReceiptsTable.organizationId, t.organizationId),
            eq(goodsReceiptsTable.purchaseOrderId, poId),
          ),
        );
      const ids = receiptIds.map((r) => r.id);
      const goodsReceiptCond =
        ids.length > 0
          ? and(
              eq(stockMovementsTable.referenceType, "goods_receipt"),
              inArray(stockMovementsTable.referenceId, ids),
            )
          : undefined;
      const purchaseOrderCond = and(
        eq(stockMovementsTable.referenceType, "purchase_order"),
        eq(stockMovementsTable.referenceId, poId),
      );
      conds.push(
        goodsReceiptCond
          ? or(purchaseOrderCond, goodsReceiptCond)!
          : purchaseOrderCond!,
      );
    }
    if (req.query.salesOrderId) {
      const soId = Number(req.query.salesOrderId);
      const shipmentIds = await db
        .select({ id: shipmentsTable.id })
        .from(shipmentsTable)
        .where(
          and(
            eq(shipmentsTable.organizationId, t.organizationId),
            eq(shipmentsTable.salesOrderId, soId),
          ),
        );
      const ids = shipmentIds.map((r) => r.id);
      const shipmentCond =
        ids.length > 0
          ? and(
              eq(stockMovementsTable.referenceType, "shipment"),
              inArray(stockMovementsTable.referenceId, ids),
            )
          : undefined;
      const salesOrderCond = and(
        eq(stockMovementsTable.referenceType, "sales_order"),
        eq(stockMovementsTable.referenceId, soId),
      );
      conds.push(
        shipmentCond
          ? or(salesOrderCond, shipmentCond)!
          : salesOrderCond!,
      );
    }

    // Optional: text search on item name / SKU.
    if (req.query.search) {
      const term = `%${String(req.query.search)}%`;
      conds.push(or(ilike(itemsTable.name, term), ilike(itemsTable.sku, term))!);
    }

    // Optional: date range filter on movement createdAt.
    if (req.query.fromDate) {
      conds.push(gte(stockMovementsTable.createdAt, new Date(String(req.query.fromDate))));
    }
    if (req.query.toDate) {
      const toDate = new Date(String(req.query.toDate));
      toDate.setDate(toDate.getDate() + 1); // make toDate inclusive
      conds.push(lte(stockMovementsTable.createdAt, toDate));
    }

    // Optional: server-side movement-type filter (comma-separated list).
    // Used by the Write-offs page to avoid fetching the full movements ledger.
    if (req.query.movementTypes) {
      const types = String(req.query.movementTypes)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (types.length > 0) {
        conds.push(inArray(stockMovementsTable.movementType, types));
      }
    }

    // Optional server-side pagination.
    // When `page` or `pageSize` is present, respond with { movements, total, page, pageSize }.
    // When absent (detail-page callers), respond with an array for backward compatibility.
    const rawPage = req.query.page;
    const rawPageSize = req.query.pageSize;
    const paginate = rawPage !== undefined || rawPageSize !== undefined;
    const page = Math.max(1, Number(rawPage) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(rawPageSize) || 50));

    const selectShape = {
      movement: stockMovementsTable,
      itemName: itemsTable.name,
      itemSku: itemsTable.sku,
      itemBarcode: itemsTable.barcode,
      itemCategory: itemsTable.category,
      itemUnitCost: sql<string>`COALESCE(${itemsTable.avgCost}, ${itemsTable.purchasePrice})`,
      warehouseName: warehousesTable.name,
    };
    const whereClause = and(...conds);

    const serialize = (r: {
      movement: typeof stockMovementsTable.$inferSelect;
      itemName: string;
      itemSku: string | null;
      itemBarcode: string | null;
      itemCategory: string | null;
      itemUnitCost: string;
      warehouseName: string;
    }) =>
      serializeStockMovement(
        r.movement,
        r.itemName,
        r.warehouseName,
        r.itemSku,
        r.itemBarcode,
        r.itemCategory,
        r.itemUnitCost,
      );

    if (paginate) {
      const [countRow] = await db
        .select({ total: sql<string>`COUNT(*)` })
        .from(stockMovementsTable)
        .innerJoin(itemsTable, eq(itemsTable.id, stockMovementsTable.itemId))
        .innerJoin(
          warehousesTable,
          eq(warehousesTable.id, stockMovementsTable.warehouseId),
        )
        .where(whereClause);

      const rows = await db
        .select(selectShape)
        .from(stockMovementsTable)
        .innerJoin(itemsTable, eq(itemsTable.id, stockMovementsTable.itemId))
        .innerJoin(
          warehousesTable,
          eq(warehousesTable.id, stockMovementsTable.warehouseId),
        )
        .where(whereClause)
        .orderBy(desc(stockMovementsTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      res.json({
        movements: rows.map(serialize),
        total: Number(countRow?.total ?? 0),
        page,
        pageSize,
      });
      return;
    }

    // Non-paginated path (backward compat for sales/purchase order detail pages).
    // Limit raised from 500 → 2000 to reduce chance of truncation.
    const rows = await db
      .select(selectShape)
      .from(stockMovementsTable)
      .innerJoin(itemsTable, eq(itemsTable.id, stockMovementsTable.itemId))
      .innerJoin(
        warehousesTable,
        eq(warehousesTable.id, stockMovementsTable.warehouseId),
      )
      .where(whereClause)
      .orderBy(desc(stockMovementsTable.createdAt))
      .limit(2000);
    res.json(rows.map(serialize));
  } catch (err) {
    next(err);
  }
});

const WRITE_OFF_MOVEMENT_TYPES = [
  "damage",
  "expired",
  "lost",
  "theft",
  "adjustment",
] as const;
type WriteOffMovementType = (typeof WRITE_OFF_MOVEMENT_TYPES)[number];
function isWriteOffMovementType(s: string): s is WriteOffMovementType {
  return (WRITE_OFF_MOVEMENT_TYPES as readonly string[]).includes(s);
}

router.post("/stock-movements", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgId = t.organizationId;
    const b = req.body ?? {};

    const itemId = Number(b.itemId);
    const warehouseId = Number(b.warehouseId);
    const movementType = String(b.movementType ?? "");
    const quantity = Number(b.quantity);
    const notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null;

    if (!Number.isFinite(itemId) || itemId <= 0) {
      res.status(400).json({ error: "itemId is required" });
      return;
    }
    if (!Number.isFinite(warehouseId) || warehouseId <= 0) {
      res.status(400).json({ error: "warehouseId is required" });
      return;
    }
    if (!isWriteOffMovementType(movementType)) {
      res.status(400).json({
        error: `Invalid movementType. Allowed: ${WRITE_OFF_MOVEMENT_TYPES.join(", ")}`,
      });
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      res.status(400).json({ error: "quantity must be greater than zero" });
      return;
    }

    const ownership = await assertOwnership({
      organizationId: orgId,
      itemIds: [itemId],
      warehouseIds: [warehouseId],
    });
    if (!ownership.ok) {
      res.status(400).json({ error: `Invalid ${ownership.missing}` });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Check for approval workflow
      const [wfRow] = await tx
        .select({ id: approvalWorkflowsTable.id })
        .from(approvalWorkflowsTable)
        .where(
          and(
            eq(approvalWorkflowsTable.organizationId, orgId),
            eq(approvalWorkflowsTable.module, "write_offs"),
            eq(approvalWorkflowsTable.isEnabled, true),
          ),
        )
        .limit(1);

      if (wfRow) {
        // Stage the write-off for approval
        const staged = await tx
          .insert(stagedWriteOffsTable)
          .values({
            organizationId: orgId,
            itemId,
            warehouseId,
            movementType,
            quantity: toStr(quantity),
            notes,
            status: "pending_approval",
            submittedById: t.userId,
          })
          .returning({ id: stagedWriteOffsTable.id });
        const stageId = staged[0]!.id;
        const approvalReq = await submitForApproval(
          tx,
          orgId,
          "write_offs",
          stageId,
          `write-off-${stageId}`,
          t.userId,
        );
        if (approvalReq) {
          return { kind: "pending_approval" as const, stageId };
        }
        // Workflow exists but has no rules configured yet — revert staging
        // and fall through to the immediate apply path below.
        await tx
          .delete(stagedWriteOffsTable)
          .where(
            and(
              eq(stagedWriteOffsTable.id, stageId),
              eq(stagedWriteOffsTable.organizationId, orgId),
            ),
          );
      }

      // No workflow — check on-hand first, then apply
      const [stockRow] = await tx
        .select({ quantity: itemWarehouseStockTable.quantity })
        .from(itemWarehouseStockTable)
        .where(
          and(
            eq(itemWarehouseStockTable.organizationId, orgId),
            eq(itemWarehouseStockTable.itemId, itemId),
            eq(itemWarehouseStockTable.warehouseId, warehouseId),
          ),
        )
        .for("update")
        .limit(1);
      const onHand = stockRow ? toNum(stockRow.quantity) : 0;
      if (quantity - onHand > 1e-6) {
        return {
          kind: "insufficient_stock" as const,
          onHand,
          needed: quantity,
        };
      }

      const updated = await tx
        .update(itemWarehouseStockTable)
        .set({
          quantity: sql`${itemWarehouseStockTable.quantity} - ${toStr(quantity)}::numeric`,
        })
        .where(
          and(
            eq(itemWarehouseStockTable.organizationId, orgId),
            eq(itemWarehouseStockTable.itemId, itemId),
            eq(itemWarehouseStockTable.warehouseId, warehouseId),
          ),
        )
        .returning({ id: itemWarehouseStockTable.id });

      if (updated.length === 0) {
        // Defensive: row vanished between SELECT FOR UPDATE and UPDATE.
        await tx.insert(itemWarehouseStockTable).values({
          organizationId: orgId,
          itemId,
          warehouseId,
          quantity: toStr(0),
        });
      }

      const mvt = await tx
        .insert(stockMovementsTable)
        .values({
          organizationId: orgId,
          itemId,
          warehouseId,
          movementType,
          quantity: toStr(-quantity),
          notes,
        })
        .returning({ id: stockMovementsTable.id });

      return { kind: "ok" as const, movementId: mvt[0]!.id };
    });

    if (result.kind === "pending_approval") {
      res.status(202).json({ ok: true, status: "pending_approval", stageId: result.stageId });
      return;
    }
    if (result.kind === "insufficient_stock") {
      res.status(400).json({
        error: `Insufficient stock: need ${result.needed}, on hand ${result.onHand}`,
      });
      return;
    }

    res.status(201).json({ ok: true, movementId: result.movementId });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /stock-movements/pending-write-offs
 * Returns staged write-offs waiting for approval for this org.
 */
router.get("/stock-movements/pending-write-offs", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgId = t.organizationId;

    const rows = await db
      .select({
        id: stagedWriteOffsTable.id,
        itemId: stagedWriteOffsTable.itemId,
        warehouseId: stagedWriteOffsTable.warehouseId,
        movementType: stagedWriteOffsTable.movementType,
        quantity: stagedWriteOffsTable.quantity,
        notes: stagedWriteOffsTable.notes,
        status: stagedWriteOffsTable.status,
        createdAt: stagedWriteOffsTable.createdAt,
        submittedById: stagedWriteOffsTable.submittedById,
        itemName: itemsTable.name,
        itemSku: itemsTable.sku,
        warehouseName: warehousesTable.name,
      })
      .from(stagedWriteOffsTable)
      .innerJoin(itemsTable, eq(itemsTable.id, stagedWriteOffsTable.itemId))
      .innerJoin(warehousesTable, eq(warehousesTable.id, stagedWriteOffsTable.warehouseId))
      .where(
        and(
          eq(stagedWriteOffsTable.organizationId, orgId),
          eq(stagedWriteOffsTable.status, "pending_approval"),
        ),
      )
      .orderBy(desc(stagedWriteOffsTable.createdAt));

    res.json({ pendingWriteOffs: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
