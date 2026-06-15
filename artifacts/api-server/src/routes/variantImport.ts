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
import { toStr } from "../lib/numeric";
import { generateUniqueBarcode } from "../lib/barcodeGen";

const router: IRouter = Router();
router.use(tenantMiddleware);

type ParsedRow = {
  index: number;
  parentSku: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  purchasePrice: number;
  salePrice: number;
  totalStock: number | null;
  attr1: string;
  attr2: string;
  attr3: string;
};

type ResultRow = {
  index: number;
  sku: string;
  parentSku: string;
  action: "create" | "skip" | "error";
  error?: string;
};

router.post("/items/variant-bulk-import", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dryRun = !!body.dryRun;
    const rawRows = Array.isArray(body.rows) ? body.rows : null;
    if (!rawRows) {
      res.status(400).json({ error: "rows must be an array" });
      return;
    }
    if (rawRows.length === 0) {
      res.status(400).json({ error: "rows is empty" });
      return;
    }
    if (rawRows.length > 500) {
      res.status(400).json({ error: "Maximum 500 rows per import" });
      return;
    }

    const parsed: (ParsedRow | null)[] = [];
    const results: ResultRow[] = [];
    const seenSkus = new Map<string, number>();

    for (let i = 0; i < rawRows.length; i++) {
      const idx = i + 1;
      const r = (rawRows[i] as Record<string, unknown>) ?? {};
      const parentSku = fStr(r.parentSku);
      const sku = fStr(r.sku);

      const fail = (error: string) => {
        parsed.push(null);
        results.push({ index: idx, sku, parentSku, action: "error", error });
      };

      if (!parentSku) { fail("parentItem (Parent SKU) is required"); continue; }
      if (!sku) { fail("sku is required"); continue; }
      if (sku.length > 100) { fail("sku must be ≤100 chars"); continue; }

      const seenAt = seenSkus.get(sku);
      if (seenAt != null) {
        fail(`Duplicate sku in upload (also on row ${seenAt})`);
        continue;
      }
      seenSkus.set(sku, idx);

      const sale = pNum(r.salePrice);
      if (!sale.ok) { fail("Sale Price is not a valid number"); continue; }
      const purchase = pNum(r.purchasePrice);
      if (!purchase.ok) { fail("MRP is not a valid number"); continue; }
      if ((sale.value ?? 0) < 0 || (purchase.value ?? 0) < 0) {
        fail("Prices cannot be negative");
        continue;
      }

      let totalStock: number | null = null;
      if (r.totalStock != null && r.totalStock !== "") {
        const ts = pNum(r.totalStock);
        if (!ts.ok) { fail("Stock is not a valid number"); continue; }
        if ((ts.value ?? 0) < 0) { fail("Stock cannot be negative"); continue; }
        totalStock = ts.value ?? 0;
      }

      const barcode = oStr(r.barcode);
      if (barcode !== null && barcode.length > 64) {
        fail("Barcode is too long (max 64 chars)");
        continue;
      }

      parsed.push({
        index: idx,
        parentSku,
        variantName: fStr(r.variantName),
        sku,
        barcode,
        salePrice: sale.value ?? 0,
        purchasePrice: purchase.value ?? 0,
        totalStock,
        attr1: fStr(r.attr1),
        attr2: fStr(r.attr2),
        attr3: fStr(r.attr3),
      });
      results.push({ index: idx, sku, parentSku, action: "create" });
    }

    // Fetch parent items by SKU in one query
    const uniqueParentSkus = [
      ...new Set(
        parsed.filter((p): p is ParsedRow => p !== null).map((p) => p.parentSku),
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

    // Check for existing variant SKUs (mark duplicates as skip)
    const candidateSkus = parsed
      .filter((p): p is ParsedRow => p !== null)
      .map((p) => p.sku);
    const existingSet = new Set<string>();
    if (candidateSkus.length > 0) {
      const existing = await db
        .select({ sku: itemsTable.sku })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            inArray(itemsTable.sku, candidateSkus),
            sql`${itemsTable.archivedAt} IS NULL`,
          ),
        );
      for (const e of existing) existingSet.add(e.sku);
    }

    // Validate each row against parent metadata
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (!p) continue;
      const parent = parentMap.get(p.parentSku);
      if (!parent) {
        results[i] = {
          ...results[i],
          action: "error",
          error: `Parent item "${p.parentSku}" not found`,
        };
        parsed[i] = null;
        continue;
      }
      if (!parent.hasVariants) {
        results[i] = {
          ...results[i],
          action: "error",
          error: `"${p.parentSku}" is not a variant parent. Open it in Items and enable "Has Variants" first.`,
        };
        parsed[i] = null;
        continue;
      }
      if (parent.axes.length === 0) {
        results[i] = {
          ...results[i],
          action: "error",
          error: `"${p.parentSku}" has no variant axes defined. Edit it and add axes (e.g. Color, Size) first.`,
        };
        parsed[i] = null;
        continue;
      }
      if (existingSet.has(p.sku)) {
        results[i] = {
          ...results[i],
          action: "skip",
          error: "SKU already exists — skipped",
        };
        parsed[i] = null;
      }
    }

    const counts = {
      create: results.filter((r) => r.action === "create").length,
      skip: results.filter((r) => r.action === "skip").length,
      error: results.filter((r) => r.action === "error").length,
    };

    if (dryRun || counts.error > 0) {
      res.status(counts.error > 0 ? 400 : 200).json({ results, counts });
      return;
    }

    // Fetch primary non-virtual warehouse
    let primaryWarehouseId: number | null = null;
    {
      const wh = await db
        .select({ id: warehousesTable.id })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.organizationId, t.organizationId),
            eq(warehousesTable.isVirtual, false),
          ),
        )
        .orderBy(asc(warehousesTable.id))
        .limit(1);
      primaryWarehouseId = wh[0]?.id ?? null;
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        if (!p) continue;
        const parent = parentMap.get(p.parentSku)!;
        const { axes } = parent;

        const opts: Record<string, string> = {};
        if (axes[0] && p.attr1) opts[axes[0]] = p.attr1;
        if (axes[1] && p.attr2) opts[axes[1]] = p.attr2;
        if (axes[2] && p.attr3) opts[axes[2]] = p.attr3;

        const attrLabel = [p.attr1, p.attr2, p.attr3].filter(Boolean).join(" - ");
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

        if (p.totalStock !== null && p.totalStock > 0 && primaryWarehouseId !== null) {
          await tx.insert(itemWarehouseStockTable).values({
            organizationId: t.organizationId,
            itemId: created.id,
            warehouseId: primaryWarehouseId,
            quantity: toStr(p.totalStock),
          });
          await tx.insert(stockMovementsTable).values({
            organizationId: t.organizationId,
            itemId: created.id,
            warehouseId: primaryWarehouseId,
            movementType: "adjustment",
            quantity: toStr(p.totalStock),
            notes: "Variant bulk import",
          });
        }
      }
    });

    res.json({ results, counts });
  } catch (err) {
    next(err);
  }
});

function fStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function oStr(v: unknown): string | null {
  const s = fStr(v);
  return s === "" ? null : s;
}

function pNum(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

export default router;
