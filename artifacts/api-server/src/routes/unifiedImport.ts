import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  itemsTable,
  itemWarehouseStockTable,
  stockMovementsTable,
  warehousesTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { toStr, toNum } from "../lib/numeric";
import {
  generateUniqueBarcode,
  isBarcodeUniqueViolation,
} from "../lib/barcodeGen";

const router: IRouter = Router();
router.use(tenantMiddleware);

type UnifiedResultRow = {
  index: number;
  sku: string;
  parentSku: string;
  rowType: "simple" | "variant";
  action: "create" | "update" | "skip" | "error";
  error?: string;
};

type SimpleParsed = {
  index: number;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  barcode: string | null;
  salePrice: number;
  purchasePrice: number;
  hsnCode: string | null;
  taxRate: number;
  reorderLevel: number;
  imageUrl: string | null;
  totalStock: number | null;
  warehouseName: string | null;
  maxDiscountPercent: number | null;
  maxDiscountAmount: number | null;
  brand: string | null;
  weight: number | null;
  weightUnit: string;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string;
};

type VariantParsed = {
  index: number;
  parentSku: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  salePrice: number;
  purchasePrice: number;
  totalStock: number | null;
  warehouseName: string | null;
  attr1: string;
  attr2: string;
  attr3: string;
};

function fStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function oStr(v: unknown): string | null {
  const s = fStr(v);
  return s === "" ? null : s;
}

function pNum(
  v: unknown,
  fallback = 0,
): { ok: true; value: number } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: fallback };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

const MAX_ROWS = 2000;
const MAX_RETRIES = 3;

router.post("/items/unified-bulk-import", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dryRun = !!body.dryRun;
    const mode: "create" | "upsert" =
      body.mode === "upsert" ? "upsert" : "create";
    const rawRows = Array.isArray(body.rows) ? body.rows : null;

    if (!rawRows) {
      res.status(400).json({ error: "rows must be an array" });
      return;
    }
    if (rawRows.length === 0) {
      res.status(400).json({ error: "rows is empty" });
      return;
    }
    if (rawRows.length > MAX_ROWS) {
      res
        .status(400)
        .json({ error: `Maximum ${MAX_ROWS} rows per import` });
      return;
    }

    const results: UnifiedResultRow[] = [];
    const simpleParsed: (SimpleParsed | null)[] = [];
    const variantParsed: (VariantParsed | null)[] = [];
    const simpleResultIdx: number[] = [];
    const variantResultIdx: number[] = [];
    const seenSkus = new Map<string, number>();

    for (let i = 0; i < rawRows.length; i++) {
      const idx = i + 1;
      const r = (rawRows[i] as Record<string, unknown>) ?? {};
      const sku = fStr(r.sku);
      const parentSku = fStr(r.parentSku);
      const isVariant = parentSku.length > 0;

      const fail = (error: string) => {
        results.push({
          index: idx,
          sku,
          parentSku,
          rowType: isVariant ? "variant" : "simple",
          action: "error",
          error,
        });
        if (isVariant) {
          variantParsed.push(null);
          variantResultIdx.push(results.length - 1);
        } else {
          simpleParsed.push(null);
          simpleResultIdx.push(results.length - 1);
        }
      };

      if (!sku) {
        fail("SKU is required");
        continue;
      }
      if (sku.length > 100) {
        fail("SKU must be ≤100 characters");
        continue;
      }
      const seenAt = seenSkus.get(sku);
      if (seenAt != null) {
        fail(`Duplicate SKU in upload (also on row ${seenAt})`);
        continue;
      }
      seenSkus.set(sku, idx);

      if (isVariant) {
        // ── Variant row ────────────────────────────────────────────
        const saleP = pNum(r.salePrice);
        if (!saleP.ok) {
          fail("Sale Price is not a valid number");
          continue;
        }
        const purchP = pNum(r.purchasePrice);
        if (!purchP.ok) {
          fail("MRP is not a valid number");
          continue;
        }
        if (saleP.value < 0 || purchP.value < 0) {
          fail("Prices cannot be negative");
          continue;
        }
        let totalStock: number | null = null;
        if (r.totalStock != null && r.totalStock !== "") {
          const ts = pNum(r.totalStock);
          if (!ts.ok) {
            fail("Stock is not a valid number");
            continue;
          }
          if (ts.value < 0) {
            fail("Stock cannot be negative");
            continue;
          }
          totalStock = ts.value;
        }
        const barcode = oStr(r.barcode);
        if (barcode !== null && barcode.length > 64) {
          fail("Barcode too long (max 64)");
          continue;
        }
        variantParsed.push({
          index: idx,
          parentSku,
          variantName: fStr(r.variantName),
          sku,
          barcode,
          salePrice: saleP.value,
          purchasePrice: purchP.value,
          totalStock,
          warehouseName: oStr(r.warehouseName),
          attr1: fStr(r.attr1),
          attr2: fStr(r.attr2),
          attr3: fStr(r.attr3),
        });
        variantResultIdx.push(results.length);
        results.push({
          index: idx,
          sku,
          parentSku,
          rowType: "variant",
          action: "create",
        });
      } else {
        // ── Simple row ─────────────────────────────────────────────
        const name = fStr(r.name);
        if (!name) {
          fail("Name is required");
          continue;
        }
        if (name.length > 200) {
          fail("Name must be ≤200 characters");
          continue;
        }
        const saleP = pNum(r.salePrice);
        if (!saleP.ok) {
          fail("Sale Price is not a number");
          continue;
        }
        const purchP = pNum(r.purchasePrice);
        if (!purchP.ok) {
          fail("MRP is not a number");
          continue;
        }
        const taxP = pNum(r.taxRate);
        if (!taxP.ok) {
          fail("Tax Rate is not a number");
          continue;
        }
        const reorderP = pNum(r.reorderLevel);
        if (!reorderP.ok) {
          fail("Min Stock Level is not a number");
          continue;
        }
        if (saleP.value < 0 || purchP.value < 0 || reorderP.value < 0) {
          fail("Prices and reorder level cannot be negative");
          continue;
        }
        if (taxP.value < 0 || taxP.value > 100) {
          fail("Tax Rate must be 0–100");
          continue;
        }
        const unit = fStr(r.unit) || "pcs";
        const description = oStr(r.description);
        const category = oStr(r.category);
        const hsnCode = oStr(r.hsnCode);
        const barcode = oStr(r.barcode);
        if (description !== null && description.length > 2000) {
          fail("Description too long (max 2000)");
          continue;
        }
        if (category !== null && category.length > 100) {
          fail("Category too long (max 100)");
          continue;
        }
        if (hsnCode !== null && hsnCode.length > 32) {
          fail("HSN Code too long (max 32)");
          continue;
        }
        if (unit.length > 32) {
          fail("Unit too long (max 32)");
          continue;
        }
        if (barcode !== null && barcode.length > 64) {
          fail("Barcode too long (max 64)");
          continue;
        }
        let totalStock: number | null = null;
        if (r.totalStock != null && r.totalStock !== "") {
          const ts = pNum(r.totalStock);
          if (!ts.ok) {
            fail("Total Stock is not a number");
            continue;
          }
          if (ts.value < 0) {
            fail("Total Stock cannot be negative");
            continue;
          }
          totalStock = ts.value;
        }
        const imageUrl = (() => {
          const raw = fStr(r.imageUrl);
          if (!raw) return null;
          try {
            new URL(raw);
          } catch {
            return null;
          }
          if (raw.length > 2048) return null;
          return raw;
        })();
        let maxDiscountPercent: number | null = null;
        if (r.maxDiscountPercent != null && r.maxDiscountPercent !== "") {
          const p = pNum(r.maxDiscountPercent);
          if (!p.ok) {
            fail("Max Discount % is not a number");
            continue;
          }
          if (p.value < 0 || p.value > 100) {
            fail("Max Discount % must be 0–100");
            continue;
          }
          maxDiscountPercent = p.value;
        }
        let maxDiscountAmount: number | null = null;
        if (r.maxDiscountAmount != null && r.maxDiscountAmount !== "") {
          const p = pNum(r.maxDiscountAmount);
          if (!p.ok) {
            fail("Max Discount ₹ is not a number");
            continue;
          }
          if (p.value < 0) {
            fail("Max Discount ₹ cannot be negative");
            continue;
          }
          maxDiscountAmount = p.value;
        }
        const brand = oStr(r.brand);
        if (brand !== null && brand.length > 100) {
          fail("Brand too long (max 100)");
          continue;
        }
        let weight: number | null = null;
        if (r.weight != null && r.weight !== "") {
          const wp = pNum(r.weight);
          if (!wp.ok) { fail("Weight is not a valid number"); continue; }
          if (wp.value < 0) { fail("Weight cannot be negative"); continue; }
          weight = wp.value;
        }
        const weightUnit = (() => {
          const s = fStr(r.weightUnit);
          return ["g", "kg", "lb", "oz"].includes(s) ? s : "g";
        })();
        let dimensionLength: number | null = null;
        if (r.dimensionLength != null && r.dimensionLength !== "") {
          const dp = pNum(r.dimensionLength);
          if (!dp.ok) { fail("Dimension L is not a valid number"); continue; }
          if (dp.value < 0) { fail("Dimension L cannot be negative"); continue; }
          dimensionLength = dp.value;
        }
        let dimensionWidth: number | null = null;
        if (r.dimensionWidth != null && r.dimensionWidth !== "") {
          const dp = pNum(r.dimensionWidth);
          if (!dp.ok) { fail("Dimension W is not a valid number"); continue; }
          if (dp.value < 0) { fail("Dimension W cannot be negative"); continue; }
          dimensionWidth = dp.value;
        }
        let dimensionHeight: number | null = null;
        if (r.dimensionHeight != null && r.dimensionHeight !== "") {
          const dp = pNum(r.dimensionHeight);
          if (!dp.ok) { fail("Dimension H is not a valid number"); continue; }
          if (dp.value < 0) { fail("Dimension H cannot be negative"); continue; }
          dimensionHeight = dp.value;
        }
        const dimensionUnit = (() => {
          const s = fStr(r.dimensionUnit);
          return ["cm", "in", "mm", "m"].includes(s) ? s : "cm";
        })();
        simpleParsed.push({
          index: idx,
          sku,
          name,
          description,
          category,
          unit,
          barcode,
          salePrice: saleP.value,
          purchasePrice: purchP.value,
          hsnCode,
          taxRate: taxP.value,
          reorderLevel: reorderP.value,
          imageUrl,
          totalStock,
          warehouseName: oStr(r.warehouseName),
          maxDiscountPercent,
          maxDiscountAmount,
          brand,
          weight,
          weightUnit,
          dimensionLength,
          dimensionWidth,
          dimensionHeight,
          dimensionUnit,
        });
        simpleResultIdx.push(results.length);
        results.push({
          index: idx,
          sku,
          parentSku: "",
          rowType: "simple",
          action: "create",
        });
      }
    }

    // ── Validate simple rows against existing SKUs ──────────────────
    const simpleSkus = simpleParsed
      .filter((p): p is SimpleParsed => p !== null)
      .map((p) => p.sku);
    type ExistingSimple = {
      id: number;
      hasVariants: boolean;
      isBundle: boolean;
      parentItemId: number | null;
      trackBatches: boolean;
    };
    const existingSimpleMap = new Map<string, ExistingSimple>();
    if (simpleSkus.length > 0) {
      const rows = await db
        .select({
          id: itemsTable.id,
          sku: itemsTable.sku,
          hasVariants: itemsTable.hasVariants,
          isBundle: itemsTable.isBundle,
          parentItemId: itemsTable.parentItemId,
          trackBatches: itemsTable.trackBatches,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            inArray(itemsTable.sku, simpleSkus),
            sql`${itemsTable.archivedAt} IS NULL`,
          ),
        );
      for (const e of rows)
        existingSimpleMap.set(e.sku, {
          id: e.id,
          hasVariants: e.hasVariants,
          isBundle: e.isBundle,
          parentItemId: e.parentItemId,
          trackBatches: e.trackBatches,
        });
    }
    for (let j = 0; j < simpleParsed.length; j++) {
      const p = simpleParsed[j];
      if (!p) continue;
      const ri = simpleResultIdx[j];
      const existing = existingSimpleMap.get(p.sku);
      if (!existing) {
        results[ri] = { ...results[ri], action: "create" };
        continue;
      }
      if (mode === "create") {
        results[ri] = {
          ...results[ri],
          action: "error",
          error:
            "SKU already exists. Choose Upsert mode to update existing items.",
        };
        simpleParsed[j] = null;
        continue;
      }
      if (
        existing.isBundle ||
        existing.parentItemId != null ||
        existing.trackBatches
      ) {
        results[ri] = {
          ...results[ri],
          action: "error",
          error: existing.isBundle
            ? "Existing item is a bundle — edit it individually."
            : existing.parentItemId != null
            ? "Existing item is a variant child — use a variant row (with Parent Item filled) to update it."
            : "Existing item is batch-tracked — edit it individually.",
        };
        simpleParsed[j] = null;
        continue;
      }
      results[ri] = { ...results[ri], action: "update" };
    }

    // ── Validate variant rows against parent items ──────────────────
    const uniqueParentSkus = [
      ...new Set(
        variantParsed
          .filter((p): p is VariantParsed => p !== null)
          .map((p) => p.parentSku),
      ),
    ];
    type ParentInfo = {
      id: number;
      name: string;
      sku: string;
      hasVariants: boolean;
      axes: string[];
      unit: string;
      category: string | null;
      hsnCode: string | null;
      taxRate: string | null;
    };
    const parentMap = new Map<string, ParentInfo>();
    if (uniqueParentSkus.length > 0) {
      const parents = await db
        .select({
          id: itemsTable.id,
          sku: itemsTable.sku,
          name: itemsTable.name,
          hasVariants: itemsTable.hasVariants,
          variantOptions: itemsTable.variantOptions,
          unit: itemsTable.unit,
          category: itemsTable.category,
          hsnCode: itemsTable.hsnCode,
          taxRate: itemsTable.taxRate,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            inArray(itemsTable.sku, uniqueParentSkus),
            sql`${itemsTable.archivedAt} IS NULL`,
          ),
        );
      for (const p of parents) {
        const opts = p.variantOptions as { axes?: string[] } | null;
        parentMap.set(p.sku, {
          id: p.id,
          name: p.name,
          sku: p.sku,
          hasVariants: p.hasVariants,
          axes: Array.isArray(opts?.axes) ? opts!.axes : [],
          unit: p.unit,
          category: p.category,
          hsnCode: p.hsnCode,
          taxRate: p.taxRate,
        });
      }
    }

    // ── Intra-file parents: simple rows in the same upload that are
    //    referenced as parentSku by variant rows but don't yet exist in
    //    the DB.  Add synthetic parentMap entries so variant validation
    //    passes, and derive variant axes from which attr fields are used.
    const simpleParsedBySkuIdx = new Map<string, number>();
    for (let j = 0; j < simpleParsed.length; j++) {
      const sp = simpleParsed[j];
      if (sp) simpleParsedBySkuIdx.set(sp.sku, j);
    }
    const intraFileParentSkus = new Set<string>();
    const intraFileParentAxes = new Map<string, string[]>();
    for (const vp of variantParsed) {
      if (!vp || parentMap.has(vp.parentSku)) continue;
      if (!simpleParsedBySkuIdx.has(vp.parentSku)) continue;
      intraFileParentSkus.add(vp.parentSku);
    }
    for (const pSku of intraFileParentSkus) {
      let hasAttr1 = false, hasAttr2 = false, hasAttr3 = false;
      for (const vp of variantParsed) {
        if (!vp || vp.parentSku !== pSku) continue;
        if (vp.attr1) hasAttr1 = true;
        if (vp.attr2) hasAttr2 = true;
        if (vp.attr3) hasAttr3 = true;
      }
      const axes: string[] = [];
      if (hasAttr1 || (!hasAttr2 && !hasAttr3)) axes.push("Attribute 1");
      if (hasAttr2) axes.push("Attribute 2");
      if (hasAttr3) axes.push("Attribute 3");
      intraFileParentAxes.set(pSku, axes);
      const sp = simpleParsed[simpleParsedBySkuIdx.get(pSku)!]!;
      parentMap.set(pSku, {
        id: -1, // sentinel — replaced with real DB id during commit
        name: sp.name,
        sku: sp.sku,
        hasVariants: true,
        axes,
        unit: sp.unit,
        category: sp.category,
        hsnCode: sp.hsnCode,
        taxRate: String(sp.taxRate),
      });
    }

    const variantCandidateSkus = variantParsed
      .filter((p): p is VariantParsed => p !== null)
      .map((p) => p.sku);
    // Map of sku → existing item id for variants already in the DB.
    const existingVariantMap = new Map<string, number>();
    if (variantCandidateSkus.length > 0) {
      const existing = await db
        .select({ sku: itemsTable.sku, id: itemsTable.id })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            inArray(itemsTable.sku, variantCandidateSkus),
            sql`${itemsTable.archivedAt} IS NULL`,
          ),
        );
      for (const e of existing) existingVariantMap.set(e.sku, e.id);
    }
    for (let j = 0; j < variantParsed.length; j++) {
      const p = variantParsed[j];
      if (!p) continue;
      const ri = variantResultIdx[j];
      const parent = parentMap.get(p.parentSku);
      if (!parent) {
        results[ri] = {
          ...results[ri],
          action: "error",
          error: `Parent item "${p.parentSku}" not found`,
        };
        variantParsed[j] = null;
        continue;
      }
      if (!parent.hasVariants) {
        results[ri] = {
          ...results[ri],
          action: "error",
          error: `"${p.parentSku}" is not a variant parent. Enable "Has Variants" on it first.`,
        };
        variantParsed[j] = null;
        continue;
      }
      if (parent.axes.length === 0) {
        results[ri] = {
          ...results[ri],
          action: "error",
          error: `"${p.parentSku}" has no variant axes. Add axes (e.g. Color, Size) first.`,
        };
        variantParsed[j] = null;
        continue;
      }
      if (existingVariantMap.has(p.sku)) {
        // In upsert mode: update the existing variant's price and stock.
        results[ri] = { ...results[ri], action: "update" };
        // Keep variantParsed[j] non-null so the commit loop can update it.
      }
    }

    const counts = {
      create: results.filter((r) => r.action === "create").length,
      update: results.filter((r) => r.action === "update").length,
      skip: results.filter((r) => r.action === "skip").length,
      error: results.filter((r) => r.action === "error").length,
    };

    if (dryRun) {
      res.json({ results, counts });
      return;
    }
    if (counts.create === 0 && counts.update === 0) {
      res.status(counts.error > 0 ? 400 : 200).json({ results, counts });
      return;
    }

    // ── Pre-flight barcode uniqueness for simple CREATE/UPDATE rows ──
    {
      const seenBarcodes = new Map<string, number>();
      const userBarcodes: string[] = [];
      for (let j = 0; j < simpleParsed.length; j++) {
        const p = simpleParsed[j];
        if (!p || !p.barcode) continue;
        const ri = simpleResultIdx[j];
        const seenAt = seenBarcodes.get(p.barcode);
        if (seenAt !== undefined) {
          results[ri] = {
            ...results[ri],
            action: "error",
            error: `Duplicate barcode in upload (also on row ${seenAt})`,
          };
          simpleParsed[j] = null;
          continue;
        }
        seenBarcodes.set(p.barcode, p.index);
        userBarcodes.push(p.barcode);
      }
      if (userBarcodes.length > 0) {
        const taken = await db
          .select({
            id: itemsTable.id,
            sku: itemsTable.sku,
            barcode: itemsTable.barcode,
          })
          .from(itemsTable)
          .where(
            and(
              eq(itemsTable.organizationId, t.organizationId),
              inArray(itemsTable.barcode, userBarcodes),
              sql`${itemsTable.archivedAt} IS NULL`,
            ),
          );
        const takenMap = new Map(taken.map((r): [string, typeof r] => [r.barcode!, r]));
        for (let j = 0; j < simpleParsed.length; j++) {
          const p = simpleParsed[j];
          if (!p || !p.barcode) continue;
          const ri = simpleResultIdx[j];
          const owner = takenMap.get(p.barcode);
          if (!owner) continue;
          if (results[ri].action === "update") {
            const e = existingSimpleMap.get(p.sku);
            if (e && e.id === owner.id) continue;
          }
          results[ri] = {
            ...results[ri],
            action: "error",
            error: `Barcode "${p.barcode}" is already used by ${owner.sku}`,
          };
          simpleParsed[j] = null;
        }
      }
      counts.create = results.filter((r) => r.action === "create").length;
      counts.update = results.filter((r) => r.action === "update").length;
      counts.error = results.filter((r) => r.action === "error").length;
    }

    // ── Fetch warehouses ─────────────────────────────────────────────
    let primaryWarehouseId: number | null = null;
    const warehouseNameMap = new Map<string, number>(); // lowercase name → id
    {
      const wh = await db
        .select({ id: warehousesTable.id, name: warehousesTable.name })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.organizationId, t.organizationId),
            eq(warehousesTable.isVirtual, false),
          ),
        )
        .orderBy(asc(warehousesTable.id));
      if (wh[0]) primaryWarehouseId = wh[0].id;
      for (const w of wh) warehouseNameMap.set(w.name.toLowerCase(), w.id);
    }
    const resolveWarehouseId = (name: string | null): number | null => {
      if (!name || !name.trim()) return primaryWarehouseId;
      return warehouseNameMap.get(name.toLowerCase().trim()) ?? primaryWarehouseId;
    };

    // ── Pre-fetch stock for upsert rows (per warehouse) ──────────────
    const preStockMap = new Map<string, number>(); // `${itemId}:${warehouseId}`
    {
      const ids: number[] = [];
      for (let j = 0; j < simpleParsed.length; j++) {
        const p = simpleParsed[j];
        if (!p || results[simpleResultIdx[j]].action !== "update" || p.totalStock === null) continue;
        const e = existingSimpleMap.get(p.sku);
        if (e) ids.push(e.id);
      }
      // Also include variant update rows that set totalStock.
      for (let j = 0; j < variantParsed.length; j++) {
        const p = variantParsed[j];
        if (!p || results[variantResultIdx[j]].action !== "update" || p.totalStock === null) continue;
        const vid = existingVariantMap.get(p.sku);
        if (vid !== undefined) ids.push(vid);
      }
      if (ids.length > 0) {
        const rows = await db
          .select({
            itemId: itemWarehouseStockTable.itemId,
            warehouseId: itemWarehouseStockTable.warehouseId,
            qty: itemWarehouseStockTable.quantity,
          })
          .from(itemWarehouseStockTable)
          .where(
            and(
              eq(itemWarehouseStockTable.organizationId, t.organizationId),
              inArray(itemWarehouseStockTable.itemId, ids),
            ),
          );
        for (const r of rows) {
          preStockMap.set(`${r.itemId}:${r.warehouseId}`, toNum(r.qty));
        }
      }
    }

    // ── Commit ──────────────────────────────────────────────────────
    let committed = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await db.transaction(async (tx) => {
          // Simple rows
          for (let j = 0; j < simpleParsed.length; j++) {
            const p = simpleParsed[j];
            if (!p) continue;
            const ri = simpleResultIdx[j];
            if (results[ri].action === "create") {
              let bc: string | null = p.barcode;
              let bcSrc: "manual" | "auto" = "manual";
              if (bc === null) {
                bc = await generateUniqueBarcode(t.organizationId, tx);
                bcSrc = "auto";
              }
              const isIntraParent = intraFileParentSkus.has(p.sku);
              const [created] = await tx
                .insert(itemsTable)
                .values({
                  organizationId: t.organizationId,
                  sku: p.sku,
                  name: p.name,
                  description: p.description,
                  category: p.category,
                  unit: p.unit,
                  barcode: bc,
                  barcodeSource: bcSrc,
                  salePrice: toStr(p.salePrice),
                  purchasePrice: toStr(p.purchasePrice),
                  hsnCode: p.hsnCode,
                  taxRate: toStr(p.taxRate),
                  reorderLevel: toStr(p.reorderLevel),
                  imageUrl: p.imageUrl,
                  maxDiscountPercent: p.maxDiscountPercent != null ? toStr(p.maxDiscountPercent) : null,
                  maxDiscountAmount: p.maxDiscountAmount != null ? toStr(p.maxDiscountAmount) : null,
                  brand: p.brand,
                  weight: p.weight != null ? toStr(p.weight) : null,
                  weightUnit: p.weightUnit,
                  dimensionLength: p.dimensionLength != null ? toStr(p.dimensionLength) : null,
                  dimensionWidth: p.dimensionWidth != null ? toStr(p.dimensionWidth) : null,
                  dimensionHeight: p.dimensionHeight != null ? toStr(p.dimensionHeight) : null,
                  dimensionUnit: p.dimensionUnit,
                  ...(isIntraParent && {
                    hasVariants: true,
                    variantOptions: { axes: intraFileParentAxes.get(p.sku) ?? [] },
                  }),
                })
                .returning({ id: itemsTable.id });
              if (isIntraParent) {
                // Propagate the real DB id to parentMap so the
                // variant loop below can use it as parentItemId.
                const pi = parentMap.get(p.sku);
                if (pi) pi.id = created.id;
              }
              const createWhId = resolveWarehouseId(p.warehouseName);
              if (
                p.totalStock !== null &&
                p.totalStock > 0 &&
                createWhId !== null
              ) {
                await tx.insert(itemWarehouseStockTable).values({
                  organizationId: t.organizationId,
                  itemId: created.id,
                  warehouseId: createWhId,
                  quantity: toStr(p.totalStock),
                });
                await tx.insert(stockMovementsTable).values({
                  organizationId: t.organizationId,
                  itemId: created.id,
                  warehouseId: createWhId,
                  movementType: "adjustment",
                  quantity: toStr(p.totalStock),
                  notes: "Unified bulk import",
                });
              }
            } else if (results[ri].action === "update") {
              const existing = existingSimpleMap.get(p.sku)!;
              const barcodeUpdate =
                p.barcode === null
                  ? {}
                  : { barcode: p.barcode, barcodeSource: "manual" as const };
              await tx
                .update(itemsTable)
                .set({
                  name: p.name,
                  description: p.description,
                  category: p.category,
                  unit: p.unit,
                  ...barcodeUpdate,
                  salePrice: toStr(p.salePrice),
                  purchasePrice: toStr(p.purchasePrice),
                  hsnCode: p.hsnCode,
                  taxRate: toStr(p.taxRate),
                  reorderLevel: toStr(p.reorderLevel),
                  imageUrl: p.imageUrl,
                  maxDiscountPercent:
                    p.maxDiscountPercent != null
                      ? toStr(p.maxDiscountPercent)
                      : null,
                  maxDiscountAmount:
                    p.maxDiscountAmount != null
                      ? toStr(p.maxDiscountAmount)
                      : null,
                  brand: p.brand,
                  weight: p.weight != null ? toStr(p.weight) : null,
                  weightUnit: p.weightUnit,
                  dimensionLength: p.dimensionLength != null ? toStr(p.dimensionLength) : null,
                  dimensionWidth: p.dimensionWidth != null ? toStr(p.dimensionWidth) : null,
                  dimensionHeight: p.dimensionHeight != null ? toStr(p.dimensionHeight) : null,
                  dimensionUnit: p.dimensionUnit,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(itemsTable.id, existing.id),
                    eq(itemsTable.organizationId, t.organizationId),
                  ),
                );
              const updateWhId = resolveWarehouseId(p.warehouseName);
              if (p.totalStock !== null && updateWhId !== null) {
                const currentQty = preStockMap.get(`${existing.id}:${updateWhId}`) ?? 0;
                const delta = p.totalStock - currentQty;
                if (delta !== 0) {
                  const stockRow = await tx
                    .select({
                      id: itemWarehouseStockTable.id,
                      quantity: itemWarehouseStockTable.quantity,
                    })
                    .from(itemWarehouseStockTable)
                    .where(
                      and(
                        eq(
                          itemWarehouseStockTable.organizationId,
                          t.organizationId,
                        ),
                        eq(itemWarehouseStockTable.itemId, existing.id),
                        eq(
                          itemWarehouseStockTable.warehouseId,
                          updateWhId,
                        ),
                      ),
                    )
                    .limit(1);
                  if (stockRow[0]) {
                    await tx
                      .update(itemWarehouseStockTable)
                      .set({
                        quantity: toStr(
                          toNum(stockRow[0].quantity) + delta,
                        ),
                      })
                      .where(
                        and(
                          eq(
                            itemWarehouseStockTable.organizationId,
                            t.organizationId,
                          ),
                          eq(itemWarehouseStockTable.id, stockRow[0].id),
                        ),
                      );
                  } else {
                    await tx.insert(itemWarehouseStockTable).values({
                      organizationId: t.organizationId,
                      itemId: existing.id,
                      warehouseId: updateWhId,
                      quantity: toStr(p.totalStock),
                    });
                  }
                  await tx.insert(stockMovementsTable).values({
                    organizationId: t.organizationId,
                    itemId: existing.id,
                    warehouseId: updateWhId,
                    movementType: "adjustment",
                    quantity: toStr(delta),
                    notes: "Unified bulk import",
                  });
                }
              }
            }
          }

          // Variant rows
          for (let j = 0; j < variantParsed.length; j++) {
            const p = variantParsed[j];
            if (!p) continue;
            const vri = variantResultIdx[j];
            const variantAction = results[vri].action;
            const parent = parentMap.get(p.parentSku)!;

            if (variantAction === "create") {
              if (parent.id === -1) {
                // Intra-file parent wasn't committed (e.g. barcode conflict).
                results[vri] = {
                  ...results[vri],
                  action: "skip",
                  error: `Parent "${p.parentSku}" could not be created`,
                };
                continue;
              }
              const { axes } = parent;
              const opts: Record<string, string> = {};
              if (axes[0] && p.attr1) opts[axes[0]] = p.attr1;
              if (axes[1] && p.attr2) opts[axes[1]] = p.attr2;
              if (axes[2] && p.attr3) opts[axes[2]] = p.attr3;
              const attrLabel = [p.attr1, p.attr2, p.attr3]
                .filter(Boolean)
                .join(" - ");
              const name =
                p.variantName ||
                `${parent.name}${attrLabel ? ` - ${attrLabel}` : ""}`;
              let bc: string | null = p.barcode;
              let bcSrc: "manual" | "auto" = "manual";
              if (bc === null) {
                bc = await generateUniqueBarcode(t.organizationId, tx);
                bcSrc = "auto";
              }
              const [created] = await tx
                .insert(itemsTable)
                .values({
                  organizationId: t.organizationId,
                  sku: p.sku,
                  name,
                  parentItemId: parent.id,
                  variantOptions: opts,
                  barcode: bc,
                  barcodeSource: bcSrc,
                  salePrice: toStr(p.salePrice),
                  purchasePrice: toStr(p.purchasePrice),
                  unit: parent.unit,
                  category: parent.category,
                  hsnCode: parent.hsnCode,
                  taxRate: parent.taxRate ?? "0",
                })
                .returning({ id: itemsTable.id });
              const variantWhId = resolveWarehouseId(p.warehouseName);
              if (
                p.totalStock !== null &&
                p.totalStock > 0 &&
                variantWhId !== null
              ) {
                await tx.insert(itemWarehouseStockTable).values({
                  organizationId: t.organizationId,
                  itemId: created.id,
                  warehouseId: variantWhId,
                  quantity: toStr(p.totalStock),
                });
                await tx.insert(stockMovementsTable).values({
                  organizationId: t.organizationId,
                  itemId: created.id,
                  warehouseId: variantWhId,
                  movementType: "adjustment",
                  quantity: toStr(p.totalStock),
                  notes: "Unified bulk import",
                });
              }
            } else if (variantAction === "update") {
              const existingId = existingVariantMap.get(p.sku)!;
              const barcodeFields =
                p.barcode !== null
                  ? { barcode: p.barcode, barcodeSource: "manual" as const }
                  : {};
              const attrLabel = [p.attr1, p.attr2, p.attr3]
                .filter(Boolean)
                .join(" - ");
              const nameFields = p.variantName
                ? { name: p.variantName }
                : attrLabel
                ? { name: `${parent.name}${` - ${attrLabel}`}` }
                : {};
              await tx
                .update(itemsTable)
                .set({
                  salePrice: toStr(p.salePrice),
                  purchasePrice: toStr(p.purchasePrice),
                  ...barcodeFields,
                  ...nameFields,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(itemsTable.id, existingId),
                    eq(itemsTable.organizationId, t.organizationId),
                  ),
                );
              // Stock adjustment delta
              const updateWhId = resolveWarehouseId(p.warehouseName);
              if (p.totalStock !== null && updateWhId !== null) {
                const currentQty =
                  preStockMap.get(`${existingId}:${updateWhId}`) ?? 0;
                const delta = p.totalStock - currentQty;
                if (delta !== 0) {
                  const stockRows = await tx
                    .select({ id: itemWarehouseStockTable.id })
                    .from(itemWarehouseStockTable)
                    .where(
                      and(
                        eq(
                          itemWarehouseStockTable.organizationId,
                          t.organizationId,
                        ),
                        eq(itemWarehouseStockTable.itemId, existingId),
                        eq(itemWarehouseStockTable.warehouseId, updateWhId),
                      ),
                    )
                    .limit(1);
                  if (stockRows.length > 0) {
                    await tx
                      .update(itemWarehouseStockTable)
                      .set({
                        quantity: sql`quantity + ${toStr(delta)}::numeric`,
                      })
                      .where(
                        and(
                          eq(
                            itemWarehouseStockTable.organizationId,
                            t.organizationId,
                          ),
                          eq(itemWarehouseStockTable.itemId, existingId),
                          eq(itemWarehouseStockTable.warehouseId, updateWhId),
                        ),
                      );
                  } else {
                    await tx.insert(itemWarehouseStockTable).values({
                      organizationId: t.organizationId,
                      itemId: existingId,
                      warehouseId: updateWhId,
                      quantity: toStr(p.totalStock),
                    });
                  }
                  await tx.insert(stockMovementsTable).values({
                    organizationId: t.organizationId,
                    itemId: existingId,
                    warehouseId: updateWhId,
                    movementType: "adjustment",
                    quantity: toStr(delta),
                    notes: "Unified bulk import",
                  });
                }
              }
            }
          }
        });
        committed = true;
        break;
      } catch (err) {
        if (isBarcodeUniqueViolation(err) && attempt < MAX_RETRIES - 1)
          continue;
        throw err;
      }
    }

    if (!committed) {
      res.status(409).json({
        error: `Could not allocate unique barcodes after ${MAX_RETRIES} attempts. Please retry.`,
      });
      return;
    }

    res.json({ results, counts });
  } catch (err) {
    next(err);
  }
});

export default router;
