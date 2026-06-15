import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql, asc } from "drizzle-orm";
import {
  db,
  itemsTable,
  itemWarehouseStockTable,
  warehousesTable,
  salesChannelWarehouseDefaultsTable,
  posSessionsTable,
} from "@workspace/db";
import { tenantMiddleware, getDefaultWarehouseId } from "../lib/tenant";
import { toNum } from "../lib/numeric";
import { pushStockToShopify } from "../lib/shopifyOutbound";
import {
  executePosCheckout,
  PosValidationError,
  POS_PAYMENT_MODES,
  POS_SALE_CHANNELS,
  type PosCheckoutInput,
  type PosSaleChannel,
} from "../lib/posCheckout";

const router: IRouter = Router();
router.use(tenantMiddleware);

router.get("/pos/items/lookup", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const bagsOnly =
      req.query.bags === "1" ||
      req.query.bags === "true" ||
      req.query.bagsOnly === "1";
    if (!q && !bagsOnly) {
      res.status(400).json({ error: "Query parameter q is required" });
      return;
    }
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 20, 1),
      50,
    );
    const saleChannel =
      typeof req.query.saleChannel === "string" && req.query.saleChannel.trim()
        ? req.query.saleChannel.trim()
        : null;

    // Resolve warehouse(s): explicit > channel defaults (may be multiple) > org default.
    let warehouseIds: number[];
    let primaryWarehouseId: number;
    if (Number(req.query.warehouseId) > 0) {
      primaryWarehouseId = Number(req.query.warehouseId);
      // Validate ownership — never let the cashier silently get a
      // zeroed-out result from a warehouseId that belongs to another
      // org or doesn't exist.
      const owned = await db
        .select({ id: warehousesTable.id })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.id, primaryWarehouseId),
            eq(warehousesTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      if (!owned[0]) {
        res.status(404).json({ error: "Warehouse not found" });
        return;
      }
      warehouseIds = [primaryWarehouseId];
    } else if (saleChannel) {
      // Resolve ALL warehouses configured for this channel (supports multiple POS warehouses).
      const channelDefaults = await db
        .select({ warehouseId: salesChannelWarehouseDefaultsTable.warehouseId })
        .from(salesChannelWarehouseDefaultsTable)
        .where(
          and(
            eq(salesChannelWarehouseDefaultsTable.organizationId, t.organizationId),
            eq(salesChannelWarehouseDefaultsTable.salesChannel, saleChannel),
          ),
        );
      if (channelDefaults.length > 0) {
        warehouseIds = channelDefaults.map((d) => d.warehouseId);
        primaryWarehouseId = warehouseIds[0];
      } else {
        primaryWarehouseId = await getDefaultWarehouseId(t.organizationId);
        warehouseIds = [primaryWarehouseId];
      }
    } else {
      primaryWarehouseId = await getDefaultWarehouseId(t.organizationId);
      warehouseIds = [primaryWarehouseId];
    }

    // Match priority: exact barcode > exact SKU > prefix on
    // sku/name. The exact-match branch lets a barcode scan resolve
    // in one query without opening the search dropdown. When
    // `bagsOnly` is set, we skip the exact-match branch and return
    // every bag item the org has — the dialog shows them all.
    let rows: Array<{
      id: number; sku: string; name: string; barcode: string | null;
      salePrice: string; taxRate: string; isBundle: boolean; isBag: boolean;
      trackBatches: boolean; unit: string; imageUrl: string | null;
      maxDiscountPercent: string | null;
    }> = [];
    if (bagsOnly) {
      rows = await db
        .select({
          id: itemsTable.id,
          sku: itemsTable.sku,
          name: itemsTable.name,
          barcode: itemsTable.barcode,
          salePrice: itemsTable.salePrice,
          taxRate: itemsTable.taxRate,
          isBundle: itemsTable.isBundle,
          isBag: itemsTable.isBag,
          trackBatches: itemsTable.trackBatches,
          unit: itemsTable.unit,
          imageUrl: itemsTable.imageUrl,
          maxDiscountPercent: itemsTable.maxDiscountPercent,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            sql`${itemsTable.archivedAt} IS NULL`,
            eq(itemsTable.hasVariants, false),
            eq(itemsTable.isBag, true),
          ),
        )
        .orderBy(asc(itemsTable.name))
        .limit(limit);
    } else {
    const exactRows = await db
      .select({
        id: itemsTable.id,
        sku: itemsTable.sku,
        name: itemsTable.name,
        barcode: itemsTable.barcode,
        salePrice: itemsTable.salePrice,
        taxRate: itemsTable.taxRate,
        isBundle: itemsTable.isBundle,
        isBag: itemsTable.isBag,
        trackBatches: itemsTable.trackBatches,
        unit: itemsTable.unit,
        imageUrl: itemsTable.imageUrl,
        maxDiscountPercent: itemsTable.maxDiscountPercent,
      })
      .from(itemsTable)
      .where(
        and(
          eq(itemsTable.organizationId, t.organizationId),
          sql`${itemsTable.archivedAt} IS NULL`,
          eq(itemsTable.hasVariants, false),
          or(eq(itemsTable.barcode, q), eq(itemsTable.sku, q)),
        ),
      )
      .limit(limit);

    rows = exactRows;
    if (rows.length === 0) {
      const like = `${q}%`;
      rows = await db
        .select({
          id: itemsTable.id,
          sku: itemsTable.sku,
          name: itemsTable.name,
          barcode: itemsTable.barcode,
          salePrice: itemsTable.salePrice,
          taxRate: itemsTable.taxRate,
          isBundle: itemsTable.isBundle,
          isBag: itemsTable.isBag,
          trackBatches: itemsTable.trackBatches,
          unit: itemsTable.unit,
          imageUrl: itemsTable.imageUrl,
          maxDiscountPercent: itemsTable.maxDiscountPercent,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            sql`${itemsTable.archivedAt} IS NULL`,
            eq(itemsTable.hasVariants, false),
            or(
              ilike(itemsTable.sku, like),
              ilike(itemsTable.name, `%${q}%`),
            ),
          ),
        )
        .orderBy(asc(itemsTable.name))
        .limit(limit);
    }
    }

    // Tack on on-hand summed across all POS warehouses so the cashier
    // sees combined stock at a glance.
    const ids = rows.map((r) => r.id);
    const stockMap = new Map<number, number>();
    if (ids.length > 0) {
      const stockRows = await db
        .select({
          itemId: itemWarehouseStockTable.itemId,
          quantity: sql<string>`sum(${itemWarehouseStockTable.quantity})`,
        })
        .from(itemWarehouseStockTable)
        .where(
          and(
            eq(itemWarehouseStockTable.organizationId, t.organizationId),
            sql`${itemWarehouseStockTable.warehouseId} IN (${sql.join(
              warehouseIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
            sql`${itemWarehouseStockTable.itemId} IN (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})`,
          ),
        )
        .groupBy(itemWarehouseStockTable.itemId);
      for (const s of stockRows) stockMap.set(s.itemId, toNum(s.quantity));
    }

    // Only return items that have available stock in at least one POS warehouse.
    // Items with NO record or quantity=0 are filtered out so the search only
    // surfaces items the cashier can actually sell right now.
    // Bags are shown regardless of stock (they're non-inventoried items).
    const visibleRows = bagsOnly
      ? rows
      : rows.filter((r) => (stockMap.get(r.id) ?? 0) > 0);

    res.json({
      warehouseId: primaryWarehouseId,
      items: visibleRows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        barcode: r.barcode,
        salePrice: r.salePrice,
        taxRate: r.taxRate,
        unit: r.unit,
        imageUrl: r.imageUrl,
        isBundle: r.isBundle,
        isBag: r.isBag,
        trackBatches: r.trackBatches,
        onHand: stockMap.get(r.id) ?? 0,
        maxDiscountPercent: r.maxDiscountPercent != null ? toNum(r.maxDiscountPercent) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/pos/checkout", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const b = req.body ?? {};
    const customerName =
      typeof b.customerName === "string" ? b.customerName.trim() : "";
    const customerPhone =
      typeof b.customerPhone === "string" ? b.customerPhone.trim() : "";
    const rawOrderDisc =
      b.orderDiscountAmount !== undefined && b.orderDiscountAmount !== null
        ? Number(b.orderDiscountAmount)
        : 0;
    const orderDiscountAmount =
      Number.isFinite(rawOrderDisc) && rawOrderDisc >= 0 ? rawOrderDisc : 0;
    const input: PosCheckoutInput = {
      lines: Array.isArray(b.lines) ? b.lines : [],
      customerId: b.customerId ? Number(b.customerId) : null,
      warehouseId: b.warehouseId ? Number(b.warehouseId) : null,
      payments: Array.isArray(b.payments)
        ? b.payments.map((p: { mode: string; amount: unknown; referenceNumber?: string | null }) => ({
            mode: p.mode,
            amount: Number(p.amount),
            referenceNumber: p.referenceNumber ?? null,
          }))
        : undefined,
      payment: b.payment
        ? {
            mode: b.payment.mode,
            amount: Number(b.payment.amount),
            referenceNumber: b.payment.referenceNumber ?? null,
            bankAccountLabel: b.payment.bankAccountLabel ?? null,
            notes: b.payment.notes ?? null,
          }
        : undefined,
      notes: b.notes ?? null,
      customerName: customerName ? customerName.slice(0, 200) : null,
      customerPhone: customerPhone ? customerPhone.slice(0, 50) : null,
      saleChannel:
        typeof b.saleChannel === "string" &&
        (POS_SALE_CHANNELS as readonly string[]).includes(b.saleChannel)
          ? (b.saleChannel as PosSaleChannel)
          : null,
      orderDiscountAmount,
      sessionId: b.sessionId ? Number(b.sessionId) : null,
    };

    // Validate session ownership + open state before checkout
    if (input.sessionId != null) {
      const [sess] = await db
        .select({ id: posSessionsTable.id, status: posSessionsTable.status, warehouseId: posSessionsTable.warehouseId })
        .from(posSessionsTable)
        .where(
          and(
            eq(posSessionsTable.id, input.sessionId),
            eq(posSessionsTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      if (!sess) {
        res.status(400).json({ error: "Session not found or does not belong to this organization" });
        return;
      }
      if (sess.status !== "open") {
        res.status(409).json({ error: "The linked session is not open — cannot add sales to it" });
        return;
      }
      if (input.warehouseId != null && sess.warehouseId !== input.warehouseId) {
        res.status(400).json({ error: "Session warehouse does not match the sale warehouse" });
        return;
      }
    }

    try {
      const out = await executePosCheckout(t.organizationId, input);
      // Fire-and-forget: push updated stock to Shopify for every item sold.
      // pushStockToShopify coalesces concurrent calls per (org, item) so rapid
      // back-to-back POS sales never cause stale overwrites on Shopify.
      const soldItemIds = Array.from(new Set(input.lines.map((l) => Number(l.itemId))));
      for (const itemId of soldItemIds) {
        pushStockToShopify(t.organizationId, itemId);
      }
      res.status(201).json(out);
    } catch (err) {
      if (err instanceof PosValidationError) {
        res.status(err.httpStatus).json({ error: err.httpMessage });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

export const POS_PAYMENT_MODES_EXPORT = POS_PAYMENT_MODES;
export default router;
