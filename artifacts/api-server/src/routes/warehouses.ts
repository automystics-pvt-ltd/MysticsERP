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
    const b = req.body ?? {};
    if (!b.name || !b.code) {
      res.status(400).json({ error: "name and code are required" });
      return;
    }
    const inserted = await db.transaction(async (tx) => {
      if (b.isDefault) {
        await tx
          .update(warehousesTable)
          .set({ isDefault: false })
          .where(eq(warehousesTable.organizationId, t.organizationId));
      }
      return tx
        .insert(warehousesTable)
        .values({
          organizationId: t.organizationId,
          name: b.name,
          code: b.code,
          addressLine1: b.addressLine1 ?? null,
          city: b.city ?? null,
          state: b.state ?? null,
          country: b.country ?? null,
          isDefault: !!b.isDefault,
        })
        .returning();
    });
    res.status(201).json(serializeWarehouse(inserted[0]!));
  } catch (err) {
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
    const b = req.body ?? {};

    // Check whether this is a system warehouse — they have restricted edits.
    const existingRows = await db
      .select({ isSystem: warehousesTable.isSystem, code: warehousesTable.code })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, id),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    const SYSTEM_CODES_PATCH = new Set(["MAIN", "SHOPIFY", "STORE", "POS"]);
    const isSystemWarehouse =
      (existingRows[0]?.isSystem ?? false) ||
      SYSTEM_CODES_PATCH.has((existingRows[0]?.code ?? "").toUpperCase());

    const updates: Record<string, unknown> = {};
    if (isSystemWarehouse) {
      // System warehouses: only name and address fields may be changed.
      for (const k of ["name", "addressLine1", "city", "state", "country"]) {
        if (k in b) updates[k] = b[k];
      }
    } else {
      for (const k of ["name", "code", "addressLine1", "city", "state", "country", "isDefault"]) {
        if (k in b) updates[k] = b[k];
      }
    }

    // Shopify location mapping. Accept either both fields or just id.
    // Setting id=null also clears the cached name. When mapping to a new
    // location, validate the id is one Shopify actually returns for this
    // shop, and ensure another warehouse in the same org isn't already
    // bound to it (DB unique index would catch it, but a clean 400 is
    // friendlier than a 500).
    let mappingChanged = false;
    if ("shopifyLocationId" in b) {
      mappingChanged = true;
      const newId = b.shopifyLocationId;
      if (newId === null || newId === "") {
        updates.shopifyLocationId = null;
        updates.shopifyLocationName = null;
      } else if (typeof newId === "string") {
        const orgRows = await db
          .select({
            shopDomain: organizationsTable.shopifyShopDomain,
            accessToken: organizationsTable.shopifyAccessToken,
            scopes: organizationsTable.shopifyScopes,
          })
          .from(organizationsTable)
          .where(eq(organizationsTable.id, t.organizationId))
          .limit(1);
        const org = orgRows[0];
        if (!org?.shopDomain || !org?.accessToken) {
          res.status(400).json({ error: "Shopify is not connected" });
          return;
        }
        const missingScopes = findMissingShopifyScopes(org.scopes);
        if (missingScopes.length > 0) {
          res.status(409).json({
            error: "shopify_reinstall_required",
            message:
              "Your Shopify connection is missing required permissions. Please reconnect to grant updated access.",
            missingScopes,
          });
          return;
        }
        const locations = await fetchAllShopifyLocations(
          org.shopDomain,
          org.accessToken,
        );
        const match = locations.find((l) => l.id === newId);
        if (!match) {
          res.status(400).json({ error: "Unknown Shopify location id" });
          return;
        }
        const conflict = await db
          .select({ id: warehousesTable.id })
          .from(warehousesTable)
          .where(
            and(
              eq(warehousesTable.organizationId, t.organizationId),
              eq(warehousesTable.shopifyLocationId, newId),
              ne(warehousesTable.id, id),
            ),
          )
          .limit(1);
        if (conflict[0]) {
          res.status(400).json({
            error: "Another warehouse is already mapped to that Shopify location",
          });
          return;
        }
        updates.shopifyLocationId = newId;
        updates.shopifyLocationName = match.name;
      } else {
        res.status(400).json({ error: "shopifyLocationId must be a string or null" });
        return;
      }
    }

    if (b.isDefault === true) {
      await db
        .update(warehousesTable)
        .set({ isDefault: false })
        .where(eq(warehousesTable.organizationId, t.organizationId));
    }
    let updated;
    try {
      updated = await db
        .update(warehousesTable)
        .set(updates)
        .where(
          and(
            eq(warehousesTable.id, id),
            eq(warehousesTable.organizationId, t.organizationId),
          ),
        )
        .returning();
    } catch (err: unknown) {
      // Postgres unique_violation (23505) on warehouses_org_shopify_location_idx:
      // a concurrent request claimed this Shopify location first. Translate
      // to a deterministic 400 instead of leaking a 500.
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code === "23505") {
        res.status(400).json({
          error: "Another warehouse is already mapped to that Shopify location",
        });
        return;
      }
      throw err;
    }
    if (!updated[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // When the mapping changes we should re-push every item's stock so
    // Shopify's view of this warehouse's location matches ours. Best-effort:
    // fan out fire-and-forget pushes; the per-(orgId,itemId) collapsing
    // logic in shopifyOutbound debounces them naturally.
    if (mappingChanged) {
      try {
        const items = await db
          .select({ id: itemsTable.id })
          .from(itemsTable)
          .where(eq(itemsTable.organizationId, t.organizationId));
        for (const it of items) pushStockToShopify(t.organizationId, it.id);
      } catch {
        // non-fatal
      }
    }

    res.json(serializeWarehouse(updated[0]));
  } catch (err) {
    next(err);
  }
});

router.delete("/warehouses/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);

    // Fetch first to check system-warehouse protection.
    const rows = await db
      .select({ isSystem: warehousesTable.isSystem, code: warehousesTable.code, isDefault: warehousesTable.isDefault })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, id),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      res.status(204).send();
      return;
    }
    const SYSTEM_CODES = new Set(["MAIN", "SHOPIFY", "STORE", "POS"]);
    if (rows[0].isSystem || SYSTEM_CODES.has(rows[0].code.toUpperCase())) {
      res.status(400).json({
        error: "System warehouses (Main, Shopify, Store) cannot be deleted. You can rename them or edit their address.",
      });
      return;
    }

    try {
      await db
        .delete(warehousesTable)
        .where(
          and(
            eq(warehousesTable.id, id),
            eq(warehousesTable.organizationId, t.organizationId),
          ),
        );
    } catch (deleteErr) {
      const pgCode =
        (deleteErr as { code?: string })?.code ??
        (deleteErr as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23503") {
        res.status(400).json({
          error:
            "This warehouse cannot be deleted because it has stock movements, transfers, or orders linked to it. Clear those references first.",
        });
        return;
      }
      throw deleteErr;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
