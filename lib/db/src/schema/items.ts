import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const itemsTable = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    unit: text("unit").notNull().default("pcs"),
    // Optional scannable barcode separate from SKU. Camera scanner and
    // bulk import both look this up first, then fall back to SKU.
    barcode: text("barcode"),
    // How the barcode value was assigned: "auto" when the server
    // generated it via the per-org auto-generator, "manual" when the
    // user typed/scanned/imported their own value. Used purely to show
    // an Auto/Manual badge in the UI; lookup logic doesn't care.
    barcodeSource: text("barcode_source"),
    salePrice: numeric("sale_price", { precision: 14, scale: 2 }).notNull().default("0"),
    purchasePrice: numeric("purchase_price", { precision: 14, scale: 2 }).notNull().default("0"),
    // Weighted average cost updated on every goods receipt.
    // NULL means no goods receipt has been processed for this item yet.
    // Prefer this over purchasePrice for write-off valuations when set.
    avgCost: numeric("avg_cost", { precision: 14, scale: 4 }),
    hsnCode: text("hsn_code"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 2 }).notNull().default("0"),
    reorderLevel: numeric("reorder_level", { precision: 14, scale: 2 }).notNull().default("0"),
    imageUrl: text("image_url"),
    parentItemId: integer("parent_item_id").references(
      (): AnyPgColumn => itemsTable.id,
      { onDelete: "cascade" },
    ),
    hasVariants: boolean("has_variants").notNull().default(false),
    isBundle: boolean("is_bundle").notNull().default(false),
    // Flags a SKU as a packaging "bag/carry-bag" so the POS can offer
    // a dedicated quick-pick. Bags are otherwise regular inventory
    // items: they have stock, get sold via the normal cart, and deduct
    // through the same shipment/stock_movements path.
    isBag: boolean("is_bag").notNull().default(false),
    // When true, POS / shipments may sell this item even if on-hand
    // stock would go negative (lets the user record a backorder).
    // When false (default), every stock-out path rejects the sale.
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    trackBatches: boolean("track_batches").notNull().default(false),
    // Optional per-item discount ceiling enforced at POS. When set, the
    // cashier cannot apply a line-level discount exceeding this percentage.
    // NULL means no cap (any discount is allowed).
    maxDiscountPercent: numeric("max_discount_percent", { precision: 5, scale: 2 }),
    maxDiscountAmount: numeric("max_discount_amount", { precision: 12, scale: 2 }),
    // Optional brand / manufacturer label. Stored as a plain string (same
    // pattern as category) so orgs can define their own brand list organically.
    brand: text("brand"),
    // Physical weight of the item. Raw numeric value; the unit is stored in
    // weightUnit (default 'g'). NULL means weight is not specified.
    weight: numeric("weight", { precision: 10, scale: 3 }),
    weightUnit: text("weight_unit").default("g"),
    // Outer dimensions (L × W × H). All three share the same unit column.
    // NULL means the dimension is not specified.
    dimensionLength: numeric("dimension_length", { precision: 10, scale: 3 }),
    dimensionWidth: numeric("dimension_width", { precision: 10, scale: 3 }),
    dimensionHeight: numeric("dimension_height", { precision: 10, scale: 3 }),
    dimensionUnit: text("dimension_unit").default("cm"),
    variantOptions: jsonb("variant_options"),
    shopifyProductId: text("shopify_product_id"),
    shopifyVariantId: text("shopify_variant_id"),
    shopifyInventoryItemId: text("shopify_inventory_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Soft delete. NULL means active. When set, the item is hidden
    // from lists, search, and pickers, but historical orders /
    // transfers / shipments that already reference it continue to
    // resolve correctly via GET /items/:id.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    orgName: index("items_org_name_idx").on(t.organizationId, t.name),
    // Partial unique index: only enforce SKU uniqueness across
    // ACTIVE items. This lets a user archive "WIDGET-001" and
    // later create a fresh "WIDGET-001" without a constraint
    // violation.
    orgSku: uniqueIndex("items_org_sku_idx")
      .on(t.organizationId, t.sku)
      .where(sql`${t.archivedAt} IS NULL`),
    // Variant-table lookups: "give me all children of this parent
    // within the org". Without this, the variant matrix on a parent
    // item detail page does a full org scan.
    orgParent: index("items_org_parent_idx").on(
      t.organizationId,
      t.parentItemId,
    ),
    // Idempotent Shopify resync: match-by-variant-id is the primary
    // upsert key. Unique (partial, non-null) so concurrent order imports
    // for the same new variant collapse into one row via ON CONFLICT.
    orgShopifyVariant: uniqueIndex("items_org_shopify_variant_idx")
      .on(t.organizationId, t.shopifyVariantId)
      .where(sql`${t.shopifyVariantId} IS NOT NULL`),
    // Camera-scanner / lookup-by-barcode path needs an org-scoped index
    // so a scan resolves in O(log n) regardless of catalog size.
    orgBarcode: index("items_org_barcode_idx").on(
      t.organizationId,
      t.barcode,
    ),
    // Enforce per-org barcode uniqueness across ACTIVE items only —
    // archived rows can still hold legacy values, and rows without a
    // barcode are excluded from the constraint. Mirrors the partial
    // SKU index above.
    orgBarcodeUnique: uniqueIndex("items_org_barcode_unique_idx")
      .on(t.organizationId, t.barcode)
      .where(sql`${t.barcode} IS NOT NULL AND ${t.archivedAt} IS NULL`),
  }),
);

export type Item = typeof itemsTable.$inferSelect;
