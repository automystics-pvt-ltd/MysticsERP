import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  fulfillmentsTable,
  fulfillmentLinesTable,
  itemsTable,
  itemWarehouseStockTable,
  organizationsTable,
  salesOrdersTable,
  salesOrderLinesTable,
  stockMovementsTable,
  warehousesTable,
} from "@workspace/db";
import { nextOrderNumber } from "./orderHelpers";
import { generateUniqueBarcode } from "./barcodeGen";
import { toNum, toStr } from "./numeric";
import { mapShopifyFulfillmentStatus, mapShopifyPaymentStatus, type ShopifyOrder } from "./shopify";
import { ensureShopifyWarehouse } from "./tenant";

export type ImportOutcome = "imported" | "duplicate";

const MAX_ORDER_NUMBER_RETRIES = 6;

/**
 * True when `err` is a Postgres unique-violation (23505) on the
 * per-org order-number index. `nextOrderNumber` uses a random 4-digit
 * suffix, so bulk historical imports (hundreds of orders sharing the
 * same YYMMDD) hit birthday-paradox collisions; we simply retry with a
 * freshly generated number. Collisions on the shopify-order-id index
 * are NOT retried — those mean "already imported" and are handled via
 * onConflictDoNothing returning "duplicate".
 */
function isOrderNumberCollision(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return (
    !!e &&
    e.code === "23505" &&
    e.constraint === "sales_orders_org_number_idx"
  );
}

/**
 * Insert a single Shopify order into our system. Idempotent on
 * (organization_id, shopify_order_id).
 *
 * Item resolution priority per line:
 *   1. `variant_id` → item with matching `shopifyVariantId` (most precise —
 *      avoids mismatches when two variants share a SKU in different orgs)
 *   2. `sku`        → item with matching `sku` (legacy / non-variant products)
 *   3. auto-create  → new item with `shopifyVariantId` set so future orders
 *      match via route 1 immediately
 *
 * Inventory flow (Req 3):
 *   On import  → stock moves physically: source warehouse −qty, Shopify
 *                Warehouse +qty. Two `shopify_reserve` movements are written.
 *   On ship    → existing ERP shipment route deducts from Shopify Warehouse
 *                automatically because the order's `warehouseId` points there.
 *
 * Wrapped in a single transaction so partial failures roll back cleanly.
 * Returns "duplicate" if the order is already present.
 */
export async function importShopifyOrder(
  organizationId: number,
  defaultWarehouseId: number,
  o: ShopifyOrder,
): Promise<ImportOutcome> {
  // Fetch org settings needed for stock behaviour.
  const orgRows = await db
    .select({ allowNegativeStock: organizationsTable.allowNegativeStock })
    .from(organizationsTable) // org-scope-allow: fetch own org by primary key
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);
  const allowNegativeStock = orgRows[0]?.allowNegativeStock ?? false;

  // Pre-load the org's location→warehouse map. Cheap (one row per
  // mapped warehouse) and lets us resolve per-line warehouses
  // without an extra query inside the loop.
  const mappedRows = await db
    .select({
      id: warehousesTable.id,
      shopifyLocationId: warehousesTable.shopifyLocationId,
    })
    .from(warehousesTable)
    .where(
      and(
        eq(warehousesTable.organizationId, organizationId),
        isNotNull(warehousesTable.shopifyLocationId),
      ),
    );
  const locationToWarehouse = new Map<string, number>();
  for (const r of mappedRows) {
    if (r.shopifyLocationId) locationToWarehouse.set(r.shopifyLocationId, r.id);
  }
  const orderLevelLocId =
    o.location_id != null ? String(o.location_id) : null;
  const resolveSourceWarehouse = (
    li: ShopifyOrder["line_items"][number],
  ): number => {
    const liLoc = li.origin_location?.id != null
      ? String(li.origin_location.id)
      : null;
    if (liLoc) {
      const w = locationToWarehouse.get(liLoc);
      if (w) return w;
    }
    if (orderLevelLocId) {
      const w = locationToWarehouse.get(orderLevelLocId);
      if (w) return w;
    }
    return defaultWarehouseId;
  };

  // Ensure the Shopify Warehouse exists for this org (idempotent,
  // creates lazily for existing orgs that pre-date the SHOPIFY code).
  const shopifyWarehouseId = await ensureShopifyWarehouse(organizationId);

  for (let attempt = 0; ; attempt++) {
    try {
      return await runImportTxn();
    } catch (err) {
      if (attempt < MAX_ORDER_NUMBER_RETRIES && isOrderNumberCollision(err)) {
        continue;
      }
      throw err;
    }
  }

  function runImportTxn(): Promise<ImportOutcome> {
    return db.transaction(async (tx) => {
    const existingOrder = await tx
      .select({ id: salesOrdersTable.id })
      .from(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.organizationId, organizationId),
          eq(salesOrdersTable.shopifyOrderId, String(o.id)),
        ),
      )
      .limit(1);
    if (existingOrder[0]) return "duplicate";

    // Resolve / create customer
    let customerId: number;
    const email = o.customer?.email ?? o.email;
    if (email) {
      const existingCust = await tx
        .select()
        .from(customersTable)
        .where(
          and(
            eq(customersTable.organizationId, organizationId),
            eq(customersTable.email, email),
          ),
        )
        .limit(1);
      if (existingCust[0]) {
        customerId = existingCust[0].id;
      } else {
        const fullName =
          [o.customer?.first_name, o.customer?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || email;
        const created = await tx
          .insert(customersTable)
          .values({
            organizationId,
            name: fullName,
            email,
            phone: o.customer?.phone ?? null,
          })
          .returning();
        customerId = created[0]!.id;
      }
    } else {
      const placeholderName = `Shopify Guest ${o.name}`;
      const created = await tx
        .insert(customersTable)
        .values({ organizationId, name: placeholderName })
        .returning();
      customerId = created[0]!.id;
    }

    // Resolve / create items per line, build line records.
    //
    // Resolution order:
    //   1. shopifyVariantId match   — exact variant lookup (most reliable)
    //   2. sku match                — fallback for non-variant / legacy items
    //   3. auto-create              — new item stamped with shopifyVariantId
    const lineRecords: Array<{
      itemId: number;
      sourceWarehouseId: number;
      description: string | null;
      quantity: string;
      unitPrice: string;
      taxRate: string;
      lineSubtotal: string;
      lineTax: string;
      lineTotal: string;
    }> = [];

    for (const li of o.line_items) {
      let item: typeof itemsTable.$inferSelect | undefined;

      // 1. Try shopifyVariantId lookup (for synced variant products)
      if (li.variant_id != null) {
        item = (
          await tx
            .select()
            .from(itemsTable)
            .where(
              and(
                eq(itemsTable.organizationId, organizationId),
                eq(itemsTable.shopifyVariantId, String(li.variant_id)),
              ),
            )
            .limit(1)
        )[0];
      }

      // 2. Try SKU lookup (non-variant products or items synced before
      //    shopifyVariantId was populated)
      if (!item) {
        const sku = li.sku && li.sku.trim();
        if (sku) {
          item = (
            await tx
              .select()
              .from(itemsTable)
              .where(
                and(
                  eq(itemsTable.organizationId, organizationId),
                  eq(itemsTable.sku, sku),
                ),
              )
              .limit(1)
          )[0];
        }
      }

      // 3. Auto-create — stamp shopifyVariantId so future imports hit route 1.
      //    Uses ON CONFLICT DO NOTHING + re-fetch so concurrent webhook / import
      //    job calls for the same new variant never produce duplicate ERP items.
      if (!item) {
        const sku = (li.sku && li.sku.trim()) || `SHOPIFY-LI-${li.id}`;
        // Build a descriptive name: "Product — Variant" (e.g. "wOMENS IEGGINGS — M")
        const variantSuffix = li.variant_title && li.variant_title.trim();
        const itemName = variantSuffix ? `${li.title} — ${variantSuffix}` : li.title;
        const autoBarcode = await generateUniqueBarcode(organizationId, tx);
        const created = await tx
          .insert(itemsTable)
          .values({
            organizationId,
            sku,
            name: itemName,
            unit: "pcs",
            barcode: autoBarcode,
            barcodeSource: "auto",
            salePrice: li.price,
            purchasePrice: "0",
            taxRate: "0",
            reorderLevel: "0",
            // Link variant IDs so the item appears in the correct picker slot
            // and future orders skip the fallback paths.
            ...(li.variant_id != null
              ? { shopifyVariantId: String(li.variant_id) }
              : {}),
          })
          .onConflictDoNothing()
          .returning();
        if (created[0]) {
          item = created[0];
        } else {
          // Concurrent import already created this variant — re-fetch it.
          const variantIdStr = li.variant_id != null ? String(li.variant_id) : null;
          const refetch = variantIdStr
            ? await tx
                .select()
                .from(itemsTable)
                .where(
                  and(
                    eq(itemsTable.organizationId, organizationId),
                    eq(itemsTable.shopifyVariantId, variantIdStr),
                  ),
                )
                .limit(1)
            : await tx
                .select()
                .from(itemsTable)
                .where(
                  and(
                    eq(itemsTable.organizationId, organizationId),
                    eq(itemsTable.sku, sku),
                  ),
                )
                .limit(1);
          item = refetch[0];
        }
      }

      const qty = li.quantity;
      const unitPrice = toNum(li.price);
      const lineSubtotal = unitPrice * qty;
      const taxAmount = li.tax_lines.reduce((s, tl) => s + toNum(tl.price), 0);
      // For tax-inclusive shops the price already contains the tax portion.
      // Use Shopify's own rate when available (exact), otherwise derive it.
      const taxesIncluded = o.taxes_included === true;
      const taxRate =
        taxesIncluded && li.tax_lines[0]
          ? li.tax_lines[0].rate * 100
          : lineSubtotal > 0
            ? (taxAmount / lineSubtotal) * 100
            : 0;
      // lineTotal: for tax-inclusive items the tax is already inside the price,
      // so the customer owes exactly lineSubtotal (not lineSubtotal + taxAmount).
      const lineTotal = taxesIncluded ? lineSubtotal : lineSubtotal + taxAmount;
      lineRecords.push({
        itemId: item.id,
        sourceWarehouseId: resolveSourceWarehouse(li),
        description: li.title,
        quantity: toStr(qty),
        unitPrice: toStr(unitPrice),
        taxRate: toStr(taxRate),
        lineSubtotal: toStr(lineSubtotal),
        lineTax: toStr(taxAmount),
        lineTotal: toStr(lineTotal),
      });
    }

    const taxesIncluded = o.taxes_included === true;
    const subtotal = lineRecords.reduce((s, l) => s + toNum(l.lineSubtotal), 0);
    const taxTotal = lineRecords.reduce((s, l) => s + toNum(l.lineTax), 0);
    // For tax-inclusive orders the subtotal already contains the tax; don't add it again.
    const total = taxesIncluded ? subtotal : subtotal + taxTotal;
    const orderNumber = nextOrderNumber("SO");
    // "paid" is a payment state, not a fulfillment state — use "confirmed" so the
    // order stays editable (record payment, ship, etc.) and PAYABLE_SALES_STATUSES
    // logic works correctly.
    const status =
      o.fulfillment_status === "fulfilled"
        ? "shipped"
        : "confirmed";

    // Use Shopify Warehouse as the order's warehouse so that ERP
    // shipments created later will deduct stock from there (where
    // we are physically parking the reserved units, see below).
    const headerWarehouseId = shopifyWarehouseId;

    const insertedOrder = await tx
      .insert(salesOrdersTable)
      .values({
        organizationId,
        orderNumber,
        customerId,
        warehouseId: headerWarehouseId,
        status,
        orderDate: o.created_at.slice(0, 10),
        subtotal: toStr(subtotal),
        taxTotal: toStr(taxTotal),
        total: toStr(total),
        notes: `Imported from Shopify order ${o.name}`,
        shopifyOrderId: String(o.id),
        externalReference: `shopify:${o.id}`,
        paymentStatus: mapShopifyPaymentStatus(o.financial_status),
        shopifyFulfillmentStatus: mapShopifyFulfillmentStatus(o.fulfillment_status),
        shopifyTaxLines: o.tax_lines && o.tax_lines.length > 0 ? o.tax_lines : null,
        taxesIncluded: o.taxes_included === true,
        deliveryMethod: o.shipping_lines?.[0]?.title ?? null,
      })
      .onConflictDoNothing({
        target: [salesOrdersTable.organizationId, salesOrdersTable.shopifyOrderId],
      })
      .returning({ id: salesOrdersTable.id });
    if (insertedOrder.length === 0) return "duplicate";
    const orderId = insertedOrder[0]!.id;

    if (lineRecords.length > 0) {
      // salesOrderLinesTable doesn't carry warehouse_id; strip it
      // from the persisted payload (used only for stock movements below).
      const insertedLines = await tx
        .insert(salesOrderLinesTable)
        .values(
          lineRecords.map(({ sourceWarehouseId: _wh, ...rest }) => ({
            salesOrderId: orderId,
            ...rest,
          })),
        )
        .returning({
          id: salesOrderLinesTable.id,
          itemId: salesOrderLinesTable.itemId,
          quantity: salesOrderLinesTable.quantity,
        });

      // Physical stock transfer: source warehouse → Shopify Warehouse.
      //
      // Deduct from the source warehouse and credit the Shopify Warehouse
      // so that inventory is correctly parked there until the ERP shipment
      // is recorded (which will deduct from Shopify Warehouse automatically
      // because the order's warehouseId points to it).
      for (const l of lineRecords) {
        const qty = toNum(l.quantity);
        if (qty <= 0) continue;

        // ── Source warehouse: deduct physical stock ──────────────────────
        const srcRows = await tx
          .select({
            id: itemWarehouseStockTable.id,
            quantity: itemWarehouseStockTable.quantity,
          })
          .from(itemWarehouseStockTable) // org-scope-allow: inside Shopify import txn, org already validated
          .where(
            and(
              eq(itemWarehouseStockTable.organizationId, organizationId),
              eq(itemWarehouseStockTable.itemId, l.itemId),
              eq(itemWarehouseStockTable.warehouseId, l.sourceWarehouseId),
            ),
          )
          .for("update")
          .limit(1);

        const currentSrcQty = toNum(srcRows[0]?.quantity ?? "0");
        const deductQty = allowNegativeStock
          ? qty
          : Math.min(qty, Math.max(0, currentSrcQty));

        if (srcRows[0]) {
          await tx
            .update(itemWarehouseStockTable)
            .set({ quantity: toStr(currentSrcQty - deductQty) }) // org-scope-allow: inside Shopify import txn, org already validated
            .where(
              and(
                eq(itemWarehouseStockTable.id, srcRows[0].id),
                eq(itemWarehouseStockTable.organizationId, organizationId),
              ),
            );
        } else {
          // Row doesn't exist yet — create it at 0 (going negative if allowed)
          await tx.insert(itemWarehouseStockTable).values({
            organizationId,
            itemId: l.itemId,
            warehouseId: l.sourceWarehouseId,
            quantity: toStr(-deductQty),
            ecReserved: "0",
          });
        }

        // ── Shopify Warehouse: credit physical stock ─────────────────────
        await tx
          .insert(itemWarehouseStockTable)
          .values({
            organizationId,
            itemId: l.itemId,
            warehouseId: shopifyWarehouseId,
            quantity: toStr(deductQty),
            ecReserved: "0",
          })
          .onConflictDoUpdate({
            target: [
              itemWarehouseStockTable.itemId,
              itemWarehouseStockTable.warehouseId,
            ],
            set: {
              quantity: sql`${itemWarehouseStockTable.quantity} + ${toStr(deductQty)}::numeric`,
            },
          });

        // ── Write two stock movements ─────────────────────────────────────
        await tx.insert(stockMovementsTable).values([
          {
            organizationId,
            itemId: l.itemId,
            warehouseId: l.sourceWarehouseId,
            movementType: "shopify_reserve",
            quantity: toStr(-deductQty),
            referenceType: "shopify_order",
            referenceId: orderId,
            notes: `Shopify order ${o.name} — reserved out of source warehouse`,
          },
          {
            organizationId,
            itemId: l.itemId,
            warehouseId: shopifyWarehouseId,
            movementType: "shopify_reserve",
            quantity: toStr(deductQty),
            referenceType: "shopify_order",
            referenceId: orderId,
            notes: `Shopify order ${o.name} — parked in Shopify Warehouse`,
          },
        ]);
      }

      // Auto-create a fulfillment in "picking" status so the order
      // immediately appears in the Fulfillment List for warehouse staff.
      // Skip when the Shopify order is already fully fulfilled — there is
      // nothing left to pick.
      if (status !== "shipped") {
        const [fulfillment] = await tx
          .insert(fulfillmentsTable)
          .values({
            organizationId,
            salesOrderId: orderId,
            fulfillmentNumber: nextOrderNumber("FULFIL"),
            status: "picking",
            warehouseId: headerWarehouseId,
          })
          .returning();

        await tx.insert(fulfillmentLinesTable).values(
          insertedLines.map((l) => ({
            organizationId,
            fulfillmentId: fulfillment!.id,
            salesOrderLineId: l.id,
            itemId: l.itemId,
            quantityRequired: l.quantity,
            quantityPicked: "0",
          })),
        );
      }
    }

    return "imported";
    });
  }
}
