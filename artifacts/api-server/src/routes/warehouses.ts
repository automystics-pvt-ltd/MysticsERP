import { Router, type IRouter } from "express";
import { and, eq, asc, ne, sum, count, gt, ilike, or, isNull } from "drizzle-orm";
import {
  db,
  warehousesTable,
  organizationsTable,
  itemsTable,
  itemWarehouseStockTable,
  stockTransfersTable,
  stockTransferLinesTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { serializeWarehouse } from "../lib/serializers";
import { fetchAllShopifyLocations, findMissingShopifyScopes } from "../lib/shopify";
import { pushStockToShopify } from "../lib/shopifyOutbound";

const router: IRouter = Router();
router.use(tenantMiddleware);

router.get("/warehouses", async (req, res, next) => {
  try {
    const t = req.tenant!;
    // Virtual warehouses (job-worker premises) are hidden from the
    // standard list since they shouldn't appear in inventory pickers
    // (e.g. sales orders, transfers, GRNs). Callers that need to
    // operate on them — the job-work UI, reports — opt in with
    // `?includeVirtual=true`.
    const includeVirtual = req.query.includeVirtual === "true";
    const conds = [eq(warehousesTable.organizationId, t.organizationId)];
    if (!includeVirtual) {
      conds.push(eq(warehousesTable.isVirtual, false));
    }
    const rows = await db
      .select()
      .from(warehousesTable)
      .where(and(...conds))
      .orderBy(asc(warehousesTable.name));
    res.json(rows.map(serializeWarehouse));
  } catch (err) {
    next(err);
  }
});

router.post("/warehouses", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const { name, code, addressLine1, city, state, country, isDefault } = req.body as {
      name?: string;
      code?: string;
      addressLine1?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
      isDefault?: boolean;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (!code?.trim()) {
      res.status(400).json({ error: "Code is required" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // If this warehouse is being set as default, clear the others first
      if (isDefault) {
        await tx
          .update(warehousesTable)
          .set({ isDefault: false })
          .where(eq(warehousesTable.organizationId, t.organizationId)); // org-scope-allow: scoped to tenant, clearing default flag across all rows
      }

      const [row] = await tx
        .insert(warehousesTable)
        .values({
          organizationId: t.organizationId,
          name: name.trim(),
          code: code.trim().toUpperCase(),
          addressLine1: addressLine1 ?? null,
          city: city ?? null,
          state: state ?? null,
          country: country ?? null,
          isDefault: isDefault ?? false,
          isSystem: false,
          isVirtual: false,
        })
        .returning();

      return row!;
    });

    res.status(201).json(serializeWarehouse(result));
  } catch (err: unknown) {
    const pg = err as { code?: string; constraint?: string };
    if (pg.code === "23505") {
      if (pg.constraint?.includes("name")) {
        res.status(409).json({ error: "A warehouse with that name already exists." });
      } else if (pg.constraint?.includes("code")) {
        res.status(409).json({ error: "A warehouse with that code already exists." });
      } else {
        res.status(409).json({ error: "Duplicate warehouse." });
      }
      return;
    }
    next(err);
  }
});

router.get("/warehouses/stock-summaries", async (req, res, next) => {
  try {
    const t = req.tenant!;

    const stockAgg = await db
      .select({
        warehouseId: itemWarehouseStockTable.warehouseId,
        totalItems: count(itemWarehouseStockTable.id),
        totalUnits: sum(itemWarehouseStockTable.quantity),
      })
      .from(itemWarehouseStockTable)
      // Only count stock belonging to active (non-archived) items.
      // Without this join, soft-deleted items' quantities remain in the
      // aggregate and inflate the warehouse totals shown on the dashboard.
      .innerJoin(
        itemsTable,
        and(
          eq(itemsTable.id, itemWarehouseStockTable.itemId),
          isNull(itemsTable.archivedAt),
        ),
      )
      .where(
        and(
          eq(itemWarehouseStockTable.organizationId, t.organizationId),
          gt(itemWarehouseStockTable.quantity, "0"),
        ),
      )
      .groupBy(itemWarehouseStockTable.warehouseId);

    const pendingInAgg = await db
      .select({
        warehouseId: stockTransfersTable.toWarehouseId,
        units: sum(stockTransferLinesTable.quantity),
      })
      .from(stockTransfersTable)
      .innerJoin(
        stockTransferLinesTable,
        eq(stockTransferLinesTable.stockTransferId, stockTransfersTable.id),
      )
      .where(
        and(
          eq(stockTransfersTable.organizationId, t.organizationId),
          eq(stockTransfersTable.status, "in_transit"),
        ),
      )
      .groupBy(stockTransfersTable.toWarehouseId);

    const pendingOutAgg = await db
      .select({
        warehouseId: stockTransfersTable.fromWarehouseId,
        units: sum(stockTransferLinesTable.quantity),
      })
      .from(stockTransfersTable)
      .innerJoin(
        stockTransferLinesTable,
        eq(stockTransferLinesTable.stockTransferId, stockTransfersTable.id),
      )
      .where(
        and(
          eq(stockTransfersTable.organizationId, t.organizationId),
          eq(stockTransfersTable.status, "in_transit"),
        ),
      )
      .groupBy(stockTransfersTable.fromWarehouseId);

    type SARow = { warehouseId: number; totalItems: number | string; totalUnits: string | null };
    type TARow = { warehouseId: number; units: string | null };
    type WHRow = { id: number };

    const stockMap = new Map<number, SARow>(
      (stockAgg as SARow[]).map((r) => [r.warehouseId, r]),
    );
    const inMap = new Map<number, TARow>(
      (pendingInAgg as TARow[]).map((r) => [r.warehouseId, r]),
    );
    const outMap = new Map<number, TARow>(
      (pendingOutAgg as TARow[]).map((r) => [r.warehouseId, r]),
    );

    const warehouses = await db
      .select({ id: warehousesTable.id })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.organizationId, t.organizationId),
          eq(warehousesTable.isVirtual, false),
        ),
      );

    const result = (warehouses as WHRow[]).map((w) => ({
      warehouseId: w.id,
      totalItems: Number(stockMap.get(w.id)?.totalItems ?? 0),
      totalUnits: Number(stockMap.get(w.id)?.totalUnits ?? 0),
      pendingInUnits: Number(inMap.get(w.id)?.units ?? 0),
      pendingOutUnits: Number(outMap.get(w.id)?.units ?? 0),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/warehouses/:id/stock", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const searchQ = ((req.query.search as string) ?? "").trim();
    const category = (req.query.category as string) ?? "";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const [wh] = await db
      .select({ id: warehousesTable.id })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, id),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!wh) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const conds = [
      eq(itemWarehouseStockTable.organizationId, t.organizationId),
      eq(itemWarehouseStockTable.warehouseId, id),
      gt(itemWarehouseStockTable.quantity, "0"),
      isNull(itemsTable.archivedAt),
    ];
    if (searchQ) {
      conds.push(
        or(
          ilike(itemsTable.name, `%${searchQ}%`),
          ilike(itemsTable.sku, `%${searchQ}%`),
        )!,
      );
    }
    if (category) {
      conds.push(eq(itemsTable.category, category));
    }

    const baseWhere = and(...conds);
    const catWhere = and(
      eq(itemWarehouseStockTable.organizationId, t.organizationId),
      eq(itemWarehouseStockTable.warehouseId, id),
      gt(itemWarehouseStockTable.quantity, "0"),
      isNull(itemsTable.archivedAt),
    );

    const [rows, countRows, catRows] = await Promise.all([
      db
        .select({
          itemId: itemWarehouseStockTable.itemId,
          itemName: itemsTable.name,
          itemSku: itemsTable.sku,
          category: itemsTable.category,
          availableQty: itemWarehouseStockTable.quantity,
          reorderLevel: itemsTable.reorderLevel,
          isBundle: itemsTable.isBundle,
          hasVariants: itemsTable.hasVariants,
        })
        .from(itemWarehouseStockTable)
        .innerJoin(itemsTable, eq(itemsTable.id, itemWarehouseStockTable.itemId))
        .where(baseWhere)
        .orderBy(asc(itemsTable.name))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ n: count() })
        .from(itemWarehouseStockTable)
        .innerJoin(itemsTable, eq(itemsTable.id, itemWarehouseStockTable.itemId))
        .where(baseWhere),
      db
        .select({ category: itemsTable.category })
        .from(itemWarehouseStockTable)
        .innerJoin(itemsTable, eq(itemsTable.id, itemWarehouseStockTable.itemId))
        .where(catWhere)
        .groupBy(itemsTable.category)
        .orderBy(asc(itemsTable.category)),
    ]);

    type CRow = { category: string | null };
    const categories = (catRows as CRow[])
      .map((r) => r.category)
      .filter((c): c is string => c !== null && c.trim() !== "");

    type NRow = { n: number };
    res.json({
      items: rows,
      categories,
      total: Number((countRows as NRow[])[0]?.n ?? 0),
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/warehouses/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const rows = await db
      .select()
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, id),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serializeWarehouse(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.patch("/warehouses/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, id),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const { name, code, addressLine1, city, state, country, isDefault, shopifyLocationId } =
      req.body as {
        name?: string;
        code?: string;
        addressLine1?: string | null;
        city?: string | null;
        state?: string | null;
        country?: string | null;
        isDefault?: boolean;
        shopifyLocationId?: string | null;
      };

    // System warehouses cannot have their code changed
    if (existing.isSystem && code !== undefined && code.trim().toUpperCase() !== existing.code) {
      res.status(400).json({ error: "The code of a system warehouse cannot be changed." });
      return;
    }

    const updates: Partial<typeof warehousesTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name.trim();
    if (code !== undefined) updates.code = code.trim().toUpperCase();
    if (addressLine1 !== undefined) updates.addressLine1 = addressLine1;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (country !== undefined) updates.country = country;
    if (isDefault !== undefined) updates.isDefault = isDefault;
    if (shopifyLocationId !== undefined)
      updates.shopifyLocationId = shopifyLocationId;

    const result = await db.transaction(async (tx) => {
      // If this warehouse is being set as default, clear others first
      if (updates.isDefault === true) {
        await tx
          .update(warehousesTable)
          .set({ isDefault: false })
          .where(
            and(
              eq(warehousesTable.organizationId, t.organizationId), // org-scope-allow: scoped to tenant, clearing default flag across all rows
              ne(warehousesTable.id, id),
            ),
          );
      }

      const [row] = await tx
        .update(warehousesTable)
        .set(updates)
        .where(
          and(
            eq(warehousesTable.id, id),
            eq(warehousesTable.organizationId, t.organizationId),
          ),
        )
        .returning();

      return row!;
    });

    res.json(serializeWarehouse(result));
  } catch (err: unknown) {
    const pg = err as { code?: string; constraint?: string };
    if (pg.code === "23505") {
      if (pg.constraint?.includes("name")) {
        res.status(409).json({ error: "A warehouse with that name already exists." });
      } else if (pg.constraint?.includes("code")) {
        res.status(409).json({ error: "A warehouse with that code already exists." });
      } else if (pg.constraint?.includes("shopify_location")) {
        res.status(409).json({ error: "This Shopify location is already mapped to another warehouse." });
      } else {
        res.status(409).json({ error: "Duplicate warehouse." });
      }
      return;
    }
    next(err);
  }
});

router.delete("/warehouses/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, id),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (existing.isSystem) {
      res.status(400).json({ error: "System warehouses (Main, Shopify, Store) cannot be deleted." });
      return;
    }
    if (existing.isDefault) {
      res.status(400).json({ error: "Cannot delete the default warehouse. Set another warehouse as default first." });
      return;
    }

    await db
      .delete(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, id),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      );

    res.status(204).send();
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23503") {
      res.status(409).json({
        error:
          "Cannot delete this warehouse because it is referenced by existing orders, transfers, or POS sessions. Remove those references first.",
      });
      return;
    }
    next(err);
  }
});

export default router;
