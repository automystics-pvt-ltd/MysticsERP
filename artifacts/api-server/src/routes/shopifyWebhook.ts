import { Router, type IRouter, type Request } from "express";
import { and, eq, isNull, ne, notInArray } from "drizzle-orm";
import {
  db,
  customersTable,
  fulfillmentsTable,
  shipmentsTable,
  itemsTable,
  itemWarehouseStockTable,
  stockMovementsTable,
  organizationsTable,
  salesOrdersTable,
  salesOrderLinesTable,
  shopifyWebhookEventsTable,
  shopifySyncLogsTable,
  warehousesTable,
} from "@workspace/db";
import { getDefaultWarehouseId } from "../lib/tenant";
import {
  fetchShopifyProduct,
  mapShopifyFulfillmentStatus,
  mapShopifyPaymentStatus,
  verifyWebhookSignature,
  verifyWebhookSignatureWithKey,
  type ShopifyOrder,
  type ShopifyRefund,
} from "../lib/shopify";
import { generateUniqueBarcode } from "../lib/barcodeGen";
import { importShopifyOrder } from "../lib/shopifyOrderImport";
import { cancelOrderShipments, cancelShipmentCore } from "../lib/cancelShipment";
import { pushStockToShopify } from "../lib/shopifyOutbound";
import { deriveAndUpdateOrderStatus } from "./shipments";
import { toNum, toStr } from "../lib/numeric";

const router: IRouter = Router();

/**
 * Single Shopify webhook ingress. Topic is dispatched on the
 * `X-Shopify-Topic` header. Mounted before clerkMiddleware so
 * Shopify's unauthenticated POSTs reach us.
 *
 * HMAC verification uses the raw request body (captured by app.ts
 * via the express.json `verify` callback), keyed on SHOPIFY_API_SECRET.
 *
 * Each delivery has a `X-Shopify-Webhook-Id` we dedupe on per org so
 * Shopify retries don't double-apply.
 */
router.post("/webhooks/shopify", async (req, res, next) => {
  try {
    const signature = req.header("x-shopify-hmac-sha256") ?? "";
    const raw = (req as Request & { rawBody?: string }).rawBody ?? "";
    const topic = req.header("x-shopify-topic") ?? "";
    const shopDomain = (req.header("x-shopify-shop-domain") ?? "").toLowerCase();
    const webhookId = req.header("x-shopify-webhook-id") ?? "";

    if (!shopDomain) {
      res.status(400).json({ error: "Missing shop domain header" });
      return;
    }

    // Resolve organization by shop domain first so we can use per-org credentials.
    const orgRows = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.shopifyShopDomain, shopDomain))
      .limit(1); // org-scope-allow: webhook ingress — no org context yet, looked up by shop domain
    const org = orgRows[0];

    // Verify HMAC using per-org API secret if available, falling back to the
    // global env secret (for OAuth-connected installs that predate per-org creds).
    const hmacSecret = org?.shopifyApiSecret ?? null;
    const hmacOk = hmacSecret
      ? verifyWebhookSignatureWithKey(raw, signature, hmacSecret)
      : verifyWebhookSignature(raw, signature);

    if (!hmacOk) {
      req.log?.warn(
        { topic, shopDomain },
        "Shopify webhook signature verification failed",
      );
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    if (!org) {
      // Unknown shop — accept (so Shopify stops retrying) but no-op.
      req.log?.info({ topic, shopDomain }, "Webhook for unknown shop; ignoring");
      res.json({ ok: true, ignored: "unknown_shop" });
      return;
    }

    // Dedupe per org by Shopify's webhook id. Only a unique-constraint
    // violation (Postgres SQLSTATE 23505) means "already processed";
    // any other DB error must propagate so Shopify retries (otherwise
    // we'd silently drop events on transient DB issues).
    if (webhookId) {
      try {
        await db.insert(shopifyWebhookEventsTable).values({
          organizationId: org.id,
          shopifyEventId: webhookId,
          topic,
        });
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23505") {
          res.json({ ok: true, duplicate: true });
          return;
        }
        throw err;
      }
    }

    const body = req.body as Record<string, unknown>;

    switch (topic) {
      case "orders/create":
      case "orders/updated": {
        const o = body as unknown as ShopifyOrder;
        // Pass the org's default warehouse as a fallback; per-line
        // warehouse routing happens inside importShopifyOrder using the
        // line's origin_location and the warehouse↔Shopify-location map.
        const fallbackWarehouseId = await getDefaultWarehouseId(org.id);
        const outcome = await importShopifyOrder(org.id, fallbackWarehouseId, o);

        // For orders already in our system ("duplicate"), sync the payment
        // status and fulfillment status from Shopify without re-importing.
        if (outcome === "duplicate") {
          const existingRows = await db
            .select({ id: salesOrdersTable.id, status: salesOrdersTable.status })
            .from(salesOrdersTable)
            .where(
              and(
                eq(salesOrdersTable.organizationId, org.id),
                eq(salesOrdersTable.shopifyOrderId, String(o.id)),
              ),
            )
            .limit(1);
          const existing = existingRows[0];
          if (existing) {
            const newPaymentStatus = mapShopifyPaymentStatus(o.financial_status);

            if (
              o.financial_status === "refunded" &&
              existing.status !== "refunded" &&
              existing.status !== "cancelled"
            ) {
              // Full Shopify refund — cancel all active shipments, reverse
              // stock movements, and set the order status to "refunded".
              const { touchedItems } = await cancelOrderShipments(
                org.id,
                existing.id,
                newPaymentStatus,
                "refunded",
              );
              for (const itemId of touchedItems) {
                pushStockToShopify(org.id, itemId);
              }
            } else {
              // Normal sync — advance fulfillment status if not already past
              // it, and always update paymentStatus.
              const updates: Record<string, unknown> = {
                paymentStatus: newPaymentStatus,
                shopifyFulfillmentStatus: mapShopifyFulfillmentStatus(o.fulfillment_status),
              };
              const TERMINAL = new Set([
                "shipped", "delivered", "invoiced", "paid", "returned",
                "refunded", "cancelled",
              ]);
              if (!TERMINAL.has(existing.status)) {
                if (o.fulfillment_status === "fulfilled") {
                  updates["status"] = "shipped";
                } else if (
                  o.fulfillment_status === "partial" &&
                  existing.status !== "partially_shipped"
                ) {
                  updates["status"] = "partially_shipped";
                }
              }
              // Sync delivery method from Shopify shipping lines
              const syncedMethod = o.shipping_lines?.[0]?.title ?? null;
              if (syncedMethod) updates["deliveryMethod"] = syncedMethod;
              // Sync order-level tax breakdown when present
              if (o.tax_lines && o.tax_lines.length > 0) {
                updates["shopifyTaxLines"] = o.tax_lines;
              }
              // Always sync taxes_included so display stays correct if Shopify changes it
              if (o.taxes_included != null) {
                updates["taxesIncluded"] = o.taxes_included === true;
              }

              await db
                .update(salesOrdersTable)
                .set(updates as { paymentStatus?: string | null; status?: string; deliveryMethod?: string | null; shopifyFulfillmentStatus?: string | null; shopifyTaxLines?: unknown; taxesIncluded?: boolean })
                .where(
                  and(
                    eq(salesOrdersTable.organizationId, org.id),
                    eq(salesOrdersTable.id, existing.id),
                  ),
                );

              // Advance ERP fulfillment to "dispatched" when Shopify reports
              // the order as fully fulfilled.
              if (o.fulfillment_status === "fulfilled") {
                await db
                  .update(fulfillmentsTable)
                  .set({ status: "dispatched", dispatchedAt: new Date() })
                  .where(
                    and(
                      eq(fulfillmentsTable.organizationId, org.id),
                      eq(fulfillmentsTable.salesOrderId, existing.id),
                      ne(fulfillmentsTable.status, "dispatched"),
                    ),
                  );
              }
            }
          }
        }

        // Track most-recent processed Shopify order id so manual sync
        // doesn't re-fetch already-handled orders.
        const lastId = org.shopifyLastOrderId
          ? Number(org.shopifyLastOrderId)
          : 0;
        const newLast = Math.max(lastId, o.id);
        await db
          .update(organizationsTable)
          .set({
            shopifyLastWebhookAt: new Date(),
            shopifyLastOrderId: newLast > 0 ? String(newLast) : null,
          })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      case "orders/fulfilled": {
        // Shopify fires this when warehouse staff marks an order fulfilled.
        // Decrement physical stock and clear the ecommerce reservation that
        // was set when the order was first imported.
        const o = body as unknown as ShopifyOrder;
        const orderRows = await db
          .select({ id: salesOrdersTable.id, status: salesOrdersTable.status })
          .from(salesOrdersTable)
          .where(
            and(
              eq(salesOrdersTable.organizationId, org.id),
              eq(salesOrdersTable.shopifyOrderId, String(o.id)),
            ),
          )
          .limit(1);
        const order = orderRows[0];

        if (order) {
          // Resolve location→warehouse map for this org
          const mappedWhs = await db
            .select({ id: warehousesTable.id, shopifyLocationId: warehousesTable.shopifyLocationId })
            .from(warehousesTable)
            .where(and(eq(warehousesTable.organizationId, org.id)));
          const locToWh = new Map<string, number>();
          for (const w of mappedWhs) {
            if (w.shopifyLocationId) locToWh.set(w.shopifyLocationId, w.id);
          }
          const fallbackWarehouseId = await getDefaultWarehouseId(org.id);

          // Process each fulfillment's line items — decrement physical stock
          // and release the corresponding ecommerce reservation.
          const touchedItemIds = new Set<number>();
          const fulfillments = (o.fulfillments ?? []) as Array<{
            line_items?: Array<{ variant_id?: number | null; quantity: number; origin_location?: { id?: number } }>;
            location_id?: number | null;
          }>;

          for (const fulfillment of fulfillments) {
            const fulfillLocId = fulfillment.location_id != null ? String(fulfillment.location_id) : null;
            for (const li of (fulfillment.line_items ?? [])) {
              const qty = li.quantity;
              if (qty <= 0) continue;

              // Find the local item by variant_id
              if (!li.variant_id) continue;
              const itemRows = await db
                .select({ id: itemsTable.id })
                .from(itemsTable)
                .where(
                  and(
                    eq(itemsTable.organizationId, org.id),
                    eq(itemsTable.shopifyVariantId, String(li.variant_id)),
                  ),
                )
                .limit(1);
              const item = itemRows[0];
              if (!item) continue;

              const liLocId = li.origin_location?.id != null ? String(li.origin_location.id) : null;
              const warehouseId =
                (liLocId && locToWh.get(liLocId)) ||
                (fulfillLocId && locToWh.get(fulfillLocId)) ||
                fallbackWarehouseId;

              await db.transaction(async (tx) => {
                const stockRows = await tx
                  .select({ id: itemWarehouseStockTable.id, quantity: itemWarehouseStockTable.quantity, ecReserved: itemWarehouseStockTable.ecReserved })
                  .from(itemWarehouseStockTable) // org-scope-allow: orders/fulfilled webhook, org resolved from shop domain
                  .where(
                    and(
                      eq(itemWarehouseStockTable.organizationId, org.id),
                      eq(itemWarehouseStockTable.itemId, item.id),
                      eq(itemWarehouseStockTable.warehouseId, warehouseId),
                    ),
                  )
                  .for("update")
                  .limit(1);

                if (stockRows[0]) {
                  const currentQty = toNum(stockRows[0].quantity);
                  const currentReserved = toNum(stockRows[0].ecReserved);
                  const newQty = Math.max(0, currentQty - qty);
                  const newReserved = Math.max(0, currentReserved - qty);
                  await tx
                    .update(itemWarehouseStockTable)
                    .set({ quantity: toStr(newQty), ecReserved: toStr(newReserved) }) // org-scope-allow: orders/fulfilled webhook, org resolved from shop domain
                    .where(
                      and(
                        eq(itemWarehouseStockTable.id, stockRows[0].id),
                        eq(itemWarehouseStockTable.organizationId, org.id),
                      ),
                    );
                } else {
                  await tx.insert(itemWarehouseStockTable).values({
                    organizationId: org.id,
                    itemId: item.id,
                    warehouseId,
                    quantity: "0",
                    ecReserved: "0",
                  });
                }
                await tx.insert(stockMovementsTable).values({
                  organizationId: org.id,
                  itemId: item.id,
                  warehouseId,
                  movementType: "shopify_order",
                  quantity: toStr(-qty),
                  referenceType: "shopify_order",
                  referenceId: order.id,
                  notes: `Shopify fulfillment (${o.name})`,
                });
              });

              touchedItemIds.add(item.id);
            }
          }

          // Update order status
          const PAST_SHIPPED = new Set([
            "delivered", "invoiced", "paid", "returned", "refunded", "cancelled",
          ]);
          if (!PAST_SHIPPED.has(order.status)) {
            await db
              .update(salesOrdersTable)
              .set({
                status: "shipped",
                paymentStatus: mapShopifyPaymentStatus(o.financial_status),
              })
              .where(
                and(
                  eq(salesOrdersTable.organizationId, org.id),
                  eq(salesOrdersTable.id, order.id),
                ),
              );
          } else {
            await db
              .update(salesOrdersTable)
              .set({ paymentStatus: mapShopifyPaymentStatus(o.financial_status) })
              .where(
                and(
                  eq(salesOrdersTable.organizationId, org.id),
                  eq(salesOrdersTable.id, order.id),
                ),
              );
          }

          // Advance ERP fulfillment record to "dispatched" — idempotent when
          // the ERP already dispatched first (guard: ne status, "dispatched").
          await db
            .update(fulfillmentsTable)
            .set({ status: "dispatched", dispatchedAt: new Date() })
            .where(
              and(
                eq(fulfillmentsTable.organizationId, org.id),
                eq(fulfillmentsTable.salesOrderId, order.id),
                ne(fulfillmentsTable.status, "dispatched"),
              ),
            );

          // Sync delivery method from Shopify shipping lines
          const ordFulMethod = o.shipping_lines?.[0]?.title ?? null;
          if (ordFulMethod) {
            await db
              .update(salesOrdersTable)
              .set({ deliveryMethod: ordFulMethod })
              .where(
                and(
                  eq(salesOrdersTable.organizationId, org.id),
                  eq(salesOrdersTable.id, order.id),
                ),
              );
          }

          // Push updated stock back to Shopify for each touched item
          for (const itemId of touchedItemIds) {
            pushStockToShopify(org.id, itemId);
          }

          // Sync Shopify tracking → ERP: when the merchant fulfills an order
          // in Shopify, propagate the tracking number/carrier/url back to any
          // existing ERP shipment and fulfillment records so both sides agree.
          const shopifyFulfillments = (o.fulfillments ?? []) as Array<{
            id: number;
            status?: string | null;
            tracking_number?: string | null;
            tracking_numbers?: string[];
            tracking_company?: string | null;
            tracking_url?: string | null;
            tracking_urls?: string[];
          }>;
          const bestTracking = shopifyFulfillments
            .filter((f) => f.status !== "cancelled")
            .reduce<{ number: string | null; company: string | null; url: string | null }>(
              (acc, f) => ({
                number: acc.number ?? f.tracking_number ?? (f.tracking_numbers?.[0] ?? null),
                company: acc.company ?? f.tracking_company ?? null,
                url: acc.url ?? f.tracking_url ?? (f.tracking_urls?.[0] ?? null),
              }),
              { number: null, company: null, url: null },
            );

          if (bestTracking.number || bestTracking.company || bestTracking.url) {
            const trackingUpdate = {
              ...(bestTracking.number ? { awb: bestTracking.number } : {}),
              ...(bestTracking.company ? { courierName: bestTracking.company } : {}),
              ...(bestTracking.url ? { trackingUrl: bestTracking.url } : {}),
            };
            const fulfillmentTrackingUpdate = {
              ...(bestTracking.number ? { awbNumber: bestTracking.number } : {}),
              ...(bestTracking.company ? { courierName: bestTracking.company } : {}),
              ...(bestTracking.url ? { trackingUrl: bestTracking.url } : {}),
            };

            if (Object.keys(trackingUpdate).length > 0) {
              // Update all active (non-cancelled) ERP shipments for this SO
              await db
                .update(shipmentsTable)
                .set(trackingUpdate)
                .where(
                  and(
                    eq(shipmentsTable.organizationId, org.id),
                    eq(shipmentsTable.salesOrderId, order.id),
                    eq(shipmentsTable.status, "shipped"),
                  ),
                );
            }
            if (Object.keys(fulfillmentTrackingUpdate).length > 0) {
              // Update all dispatched ERP fulfillment records for this SO
              await db
                .update(fulfillmentsTable)
                .set(fulfillmentTrackingUpdate)
                .where(
                  and(
                    eq(fulfillmentsTable.organizationId, org.id),
                    eq(fulfillmentsTable.salesOrderId, order.id),
                    eq(fulfillmentsTable.status, "dispatched"),
                  ),
                );
            }
          }
        }

        await db
          .update(organizationsTable)
          .set({ shopifyLastWebhookAt: new Date() })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      case "orders/cancelled": {
        const o = body as unknown as ShopifyOrder;
        const rows = await db
          .select({ id: salesOrdersTable.id, status: salesOrdersTable.status })
          .from(salesOrdersTable)
          .where(
            and(
              eq(salesOrdersTable.organizationId, org.id),
              eq(salesOrdersTable.shopifyOrderId, String(o.id)),
            ),
          )
          .limit(1);
        const order = rows[0];
        if (order && order.status !== "cancelled") {
          const newPaymentStatus = mapShopifyPaymentStatus(o.financial_status);
          // Release any ecommerce reservation on the order's stock rows
          // so cancelling a Shopify order immediately frees up available qty.
          const cancelLineRows = await db
            .select({ itemId: salesOrderLinesTable.itemId, quantity: salesOrderLinesTable.quantity, warehouseId: salesOrdersTable.warehouseId })
            .from(salesOrderLinesTable)
            .innerJoin(salesOrdersTable, eq(salesOrdersTable.id, salesOrderLinesTable.salesOrderId))
            .where(
              and(
                eq(salesOrderLinesTable.salesOrderId, order.id),
                eq(salesOrdersTable.organizationId, org.id),
              ),
            );
          for (const line of cancelLineRows) {
            const qty = toNum(line.quantity);
            if (qty <= 0 || !line.warehouseId) continue;
            const stockRows = await db
              .select({ id: itemWarehouseStockTable.id, ecReserved: itemWarehouseStockTable.ecReserved })
              .from(itemWarehouseStockTable) // org-scope-allow: orders/cancelled webhook, org resolved from shop domain
              .where(
                and(
                  eq(itemWarehouseStockTable.organizationId, org.id),
                  eq(itemWarehouseStockTable.itemId, line.itemId),
                  eq(itemWarehouseStockTable.warehouseId, line.warehouseId),
                ),
              )
              .limit(1);
            if (stockRows[0]) {
              const newReserved = Math.max(0, toNum(stockRows[0].ecReserved) - qty);
              await db
                .update(itemWarehouseStockTable)
                .set({ ecReserved: toStr(newReserved) }) // org-scope-allow: orders/cancelled webhook, org resolved from shop domain
                .where(
                  and(
                    eq(itemWarehouseStockTable.id, stockRows[0].id),
                    eq(itemWarehouseStockTable.organizationId, org.id),
                  ),
                );
            }
          }
          // Cancel all active shipments (reverses stock) and set order to
          // cancelled. For draft/confirmed orders with no shipments this is
          // a no-op on the shipment side and just sets the status directly.
          const { touchedItems } = await cancelOrderShipments(
            org.id,
            order.id,
            newPaymentStatus,
          );
          for (const itemId of touchedItems) {
            pushStockToShopify(org.id, itemId);
          }
          // Push stock for all lines touched by reservation release
          for (const line of cancelLineRows) {
            pushStockToShopify(org.id, line.itemId);
          }
        }
        await db
          .update(organizationsTable)
          .set({ shopifyLastWebhookAt: new Date() })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      case "refunds/create": {
        // Shopify fires this for every refund — partial or full. We update
        // paymentStatus immediately so the UI reflects the refund quickly.
        //
        // We deliberately do NOT reverse stock here because:
        //  - Partial refunds may have restock_type="no_restock" for some items
        //  - We don't store Shopify line-item IDs, so per-line restocking is
        //    not yet possible
        //
        // Full-refund stock reversal (cancel all shipments, set order status
        // to "refunded") is handled by the `orders/updated` webhook which fires
        // immediately after and carries the authoritative financial_status.
        const r = body as unknown as ShopifyRefund;
        const refundOrderRows = await db
          .select({ id: salesOrdersTable.id })
          .from(salesOrdersTable)
          .where(
            and(
              eq(salesOrdersTable.organizationId, org.id),
              eq(salesOrdersTable.shopifyOrderId, String(r.order_id)),
            ),
          )
          .limit(1);
        const refundOrder = refundOrderRows[0];
        // paymentStatus is intentionally not set here: the authoritative
        // financial_status comes from the `orders/updated` webhook that
        // Shopify fires immediately after. Setting it unconditionally would
        // display "refunded" for partial refunds before orders/updated
        // corrects it to "partially_paid".
        await db
          .update(organizationsTable)
          .set({ shopifyLastWebhookAt: new Date() })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      case "inventory_levels/update": {
        // Shopify sends: { inventory_item_id, location_id, available, ... }
        // Route the change to the warehouse mapped to this Shopify
        // location. If no warehouse is mapped, log + skip — we don't
        // want to silently mash all locations into the default
        // warehouse, that would corrupt per-warehouse stock.
        const invItemId = String(body["inventory_item_id"] ?? "");
        const locationId = String(body["location_id"] ?? "");
        const available = Number(body["available"] ?? 0);
        if (!invItemId || !locationId) break;

        const whRows = await db
          .select({ id: warehousesTable.id })
          .from(warehousesTable)
          .where(
            and(
              eq(warehousesTable.organizationId, org.id),
              eq(warehousesTable.shopifyLocationId, locationId),
            ),
          )
          .limit(1);
        let warehouseId = whRows[0]?.id;
        if (!warehouseId) {
          // No warehouse is mapped to this Shopify location. Fall back to
          // the org's default warehouse so stock changes are not silently
          // dropped when the warehouse-location mapping hasn't been
          // configured yet (e.g. freshly connected orgs).
          warehouseId = await getDefaultWarehouseId(org.id);
          req.log?.info(
            { topic, shopDomain, locationId, fallbackWarehouseId: warehouseId },
            "inventory_levels/update for unmapped Shopify location; routing to default warehouse",
          );
        }

        const itemRows = await db
          .select()
          .from(itemsTable)
          .where(
            and(
              eq(itemsTable.organizationId, org.id),
              eq(itemsTable.shopifyInventoryItemId, invItemId),
            ),
          )
          .limit(1);
        const item = itemRows[0];
        if (!item) break;
        await db.transaction(async (tx) => {
          const stockRows = await tx
            .select()
            .from(itemWarehouseStockTable)
            .where(
              and(
                eq(itemWarehouseStockTable.organizationId, org.id),
                eq(itemWarehouseStockTable.itemId, item.id),
                eq(itemWarehouseStockTable.warehouseId, warehouseId),
              ),
            )
            .for("update")
            .limit(1);
          const current = stockRows[0] ? toNum(stockRows[0].quantity) : 0;
          const delta = available - current;
          if (stockRows[0]) {
            await tx
              .update(itemWarehouseStockTable)
              .set({ quantity: toStr(available) })
              .where(
                and(
                  eq(itemWarehouseStockTable.id, stockRows[0].id),
                  eq(itemWarehouseStockTable.organizationId, org.id),
                ),
              );
          } else {
            await tx.insert(itemWarehouseStockTable).values({
              organizationId: org.id,
              itemId: item.id,
              warehouseId,
              quantity: toStr(available),
            });
          }
          if (delta !== 0) {
            await tx.insert(stockMovementsTable).values({
              organizationId: org.id,
              itemId: item.id,
              warehouseId,
              movementType: "shopify_webhook",
              quantity: toStr(delta),
              referenceType: "shopify",
              notes: "Shopify inventory_levels/update",
            });
          }
          await tx
            .update(organizationsTable)
            .set({ shopifyLastWebhookAt: new Date() })
            .where(eq(organizationsTable.id, org.id));
        });
        break;
      }

      case "products/create":
      case "products/update": {
        // Fetch only the changed/created product (one API call vs all-products).
        const productId = String(body["id"] ?? "");
        if (!productId || !org.shopifyAccessToken || !org.shopifyShopDomain) {
          break;
        }
        try {
          const fresh = await fetchShopifyProduct(
            org.shopifyShopDomain,
            org.shopifyAccessToken,
            productId,
          );
          if (fresh && fresh.variants.length > 0) {
            // Map Shopify status → inventory active/inactive.
            const shopifyStatus = fresh.status ?? "active";
            const archivedAtValue = shopifyStatus === "active" ? null : new Date();
            const freshProductId = String(fresh.id);
            const isMultiVariant = fresh.variants.length > 1;

            // For multi-variant products, ensure a parent item exists.
            let parentItemId: number | null = null;
            if (isMultiVariant) {
              const parentRows = await db
                .select({ id: itemsTable.id })
                .from(itemsTable)
                .where(
                  and(
                    eq(itemsTable.organizationId, org.id),
                    eq(itemsTable.shopifyProductId, freshProductId),
                    eq(itemsTable.hasVariants, true),
                    isNull(itemsTable.parentItemId),
                  ),
                )
                .limit(1); // org-scope-allow: matched by shopifyProductId (globally unique Shopify id)

              if (parentRows[0]) {
                parentItemId = parentRows[0].id;
                // Keep parent name/category/status in sync.
                await db
                  .update(itemsTable)
                  .set({
                    name: fresh.title,
                    category: fresh.product_type,
                    archivedAt: archivedAtValue,
                    imageUrl: fresh.image?.src ?? null,
                  })
                  .where(
                    and(
                      eq(itemsTable.organizationId, org.id),
                      eq(itemsTable.id, parentRows[0].id),
                    ),
                  );
              } else if (topic === "products/create") {
                // New multi-variant product → create the parent item.
                const parentBarcode = await generateUniqueBarcode(org.id);
                const inserted = await db
                  .insert(itemsTable)
                  .values({
                    organizationId: org.id,
                    sku: `SHOPIFY-${freshProductId}`,
                    unit: "pcs",
                    barcode: parentBarcode,
                    barcodeSource: "auto",
                    purchasePrice: "0",
                    taxRate: "0",
                    reorderLevel: "0",
                    hasVariants: true,
                    name: fresh.title,
                    description: fresh.body_html,
                    category: fresh.product_type,
                    salePrice: "0",
                    archivedAt: archivedAtValue,
                    shopifyProductId: freshProductId,
                    imageUrl: fresh.image?.src ?? null,
                  })
                  .returning({ id: itemsTable.id });
                parentItemId = inserted[0]?.id ?? null;
              }
            }

            // Process every variant — not just the first one.
            for (const variant of fresh.variants) {
              const variantIdStr = String(variant.id);
              const sku =
                (variant.sku && variant.sku.trim()) ||
                `SHOPIFY-${freshProductId}-${variant.id}`;

              // Match by stable shopifyVariantId first so SKU renames in
              // Shopify still land on the right ERP row.
              let matchRows = await db
                .select({ id: itemsTable.id })
                .from(itemsTable)
                .where(
                  and(
                    eq(itemsTable.organizationId, org.id),
                    eq(itemsTable.shopifyVariantId, variantIdStr),
                  ),
                )
                .limit(1); // org-scope-allow: matched by shopifyVariantId (globally unique Shopify id)

              if (!matchRows[0]) {
                // Fall back to SKU match for items imported before
                // shopifyVariantId was recorded.
                matchRows = await db
                  .select({ id: itemsTable.id })
                  .from(itemsTable)
                  .where(
                    and(
                      eq(itemsTable.organizationId, org.id),
                      eq(itemsTable.sku, sku),
                    ),
                  )
                  .limit(1);
              }

              // For multi-variant products use "Parent — Option" as item name.
              const variantLabel = [variant.option1, variant.option2, variant.option3]
                .filter(Boolean)
                .join(" / ");
              // Strip any trailing "— {variantLabel}" that may have been
              // pushed back to the Shopify product title by a previous bad
              // sync (e.g. "Womens Leggings — L" should become just
              // "Womens Leggings" so we don't produce "…— L — L").
              const suffix = variantLabel ? ` — ${variantLabel}` : "";
              const baseTitle =
                suffix && fresh.title.endsWith(suffix)
                  ? fresh.title.slice(0, -suffix.length)
                  : fresh.title;
              const variantName = isMultiVariant && variantLabel
                ? `${baseTitle} — ${variantLabel}`
                : fresh.title;

              const commonFields = {
                name: variantName,
                description: fresh.body_html,
                category: fresh.product_type,
                salePrice: variant.price ?? "0",
                // Only overwrite barcode if Shopify has a non-empty value —
                // never wipe an ERP barcode when Shopify has none. Also track
                // the source so the UI knows this barcode is Shopify-managed.
                ...(variant.barcode && variant.barcode.trim()
                  ? { barcode: variant.barcode.trim(), barcodeSource: "shopify" }
                  : {}),
                archivedAt: archivedAtValue,
                shopifyProductId: freshProductId,
                shopifyVariantId: variantIdStr,
                shopifyInventoryItemId: variant.inventory_item_id
                  ? String(variant.inventory_item_id)
                  : null,
                imageUrl: fresh.image?.src ?? null,
              };

              const existingId = matchRows[0]?.id;
              if (existingId) {
                // Update the existing ERP item.
                await db
                  .update(itemsTable)
                  .set(commonFields)
                  .where(
                    and(
                      eq(itemsTable.organizationId, org.id),
                      eq(itemsTable.id, existingId),
                    ),
                  );
              } else if (topic === "products/create") {
                // products/create → always create a new item.
                // products/update → never auto-create: only existing ERP items
                // are updated; new variants must be imported deliberately.
                //
                // Barcode priority: Shopify variant barcode (EAN/UPC/GTIN) >
                // auto-generated. Never auto-generate when Shopify already has
                // a real barcode — that overwrites the merchant's catalog data.
                const shopifyVarBarcode =
                  variant.barcode && variant.barcode.trim()
                    ? variant.barcode.trim()
                    : null;
                const [newBarcode, newBarcodeSource] = shopifyVarBarcode
                  ? [shopifyVarBarcode, "shopify" as const]
                  : [await generateUniqueBarcode(org.id), "auto" as const];
                await db.insert(itemsTable).values({
                  organizationId: org.id,
                  sku,
                  unit: "pcs",
                  barcode: newBarcode,
                  barcodeSource: newBarcodeSource,
                  purchasePrice: "0",
                  taxRate: "0",
                  reorderLevel: "0",
                  hasVariants: false,
                  ...(parentItemId ? { parentItemId } : {}),
                  name: variantName,
                  description: fresh.body_html,
                  category: fresh.product_type,
                  salePrice: variant.price ?? "0",
                  archivedAt: archivedAtValue,
                  shopifyProductId: freshProductId,
                  shopifyVariantId: variantIdStr,
                  shopifyInventoryItemId: variant.inventory_item_id
                    ? String(variant.inventory_item_id)
                    : null,
                  imageUrl: fresh.image?.src ?? null,
                });
              }
            }
          }
        } catch (err) {
          req.log?.warn(
            { err: err instanceof Error ? err.message : String(err) },
            `${topic} refresh failed`,
          );
        }
        await db
          .update(organizationsTable)
          .set({ shopifyLastWebhookAt: new Date() })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      case "products/delete": {
        // Shopify sends { id: <numeric product id> } on hard delete.
        // Archive the matching local item and clear Shopify mapping IDs so
        // a future reinstall / reimport can re-link it cleanly.
        const deletedProductId = String(body["id"] ?? "");
        if (!deletedProductId) break;
        try {
          const matchRows = await db
            .select({ id: itemsTable.id })
            .from(itemsTable)
            .where(
              and(
                eq(itemsTable.organizationId, org.id),
                eq(itemsTable.shopifyProductId, deletedProductId),
              ),
            )
            .limit(1); // org-scope-allow: matched by shopifyProductId (globally unique Shopify id)
          const itemId = matchRows[0]?.id;
          if (itemId) {
            await db
              .update(itemsTable)
              .set({
                archivedAt: new Date(),
                shopifyProductId: null,
                shopifyVariantId: null,
                shopifyInventoryItemId: null,
              })
              .where(
                and(
                  eq(itemsTable.organizationId, org.id),
                  eq(itemsTable.id, itemId),
                ),
              );
            req.log?.info(
              { orgId: org.id, itemId, shopifyProductId: deletedProductId },
              "products/delete: archived local item",
            );
          }
        } catch (err) {
          req.log?.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "products/delete handler failed",
          );
        }
        await db
          .update(organizationsTable)
          .set({ shopifyLastWebhookAt: new Date() })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      case "customers/create":
      case "customers/update": {
        const sc = body as unknown as {
          id: number;
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
          phone?: string | null;
          note?: string | null;
          default_address?: { company?: string | null } | null;
        };
        const shopifyCustomerId = String(sc.id);
        const fullName = [sc.first_name, sc.last_name].filter(Boolean).join(" ").trim() || "Unknown";
        const company = sc.default_address?.company ?? null;

        let erpId: string | null = null;
        let syncStatus: "success" | "error" = "success";
        let errMsg: string | null = null;

        try {
          // Try to find existing customer by shopifyCustomerId
          const existingRows = await db
            .select({ id: customersTable.id })
            .from(customersTable)
            .where(
              and(
                eq(customersTable.organizationId, org.id),
                eq(customersTable.shopifyCustomerId, shopifyCustomerId),
              ),
            )
            .limit(1);
          const existing = existingRows[0];

          if (existing) {
            const updates: Record<string, unknown> = { name: fullName };
            if (sc.email !== undefined) updates["email"] = sc.email;
            if (sc.phone !== undefined) updates["phone"] = sc.phone;
            if (company !== undefined) updates["company"] = company;
            if (sc.note !== undefined) updates["notes"] = sc.note;
            await db
              .update(customersTable)
              .set(updates)
              .where(
                and(
                  eq(customersTable.id, existing.id),
                  eq(customersTable.organizationId, org.id),
                ),
              );
            erpId = String(existing.id);
          } else if (topic === "customers/create") {
            // Only auto-create on create events, not update (avoid ghost customers)
            const inserted = await db
              .insert(customersTable)
              .values({
                organizationId: org.id,
                name: fullName,
                email: sc.email ?? null,
                phone: sc.phone ?? null,
                company: company ?? null,
                notes: sc.note ?? null,
                shopifyCustomerId,
              })
              .returning({ id: customersTable.id });
            erpId = String(inserted[0]!.id);
          }
        } catch (err) {
          syncStatus = "error";
          errMsg = err instanceof Error ? err.message : String(err);
          req.log?.warn({ err: errMsg, shopifyCustomerId, orgId: org.id }, "Shopify customer webhook failed");
        }

        await db.insert(shopifySyncLogsTable).values({
          organizationId: org.id,
          direction: "inbound",
          entity: "customer",
          action: topic === "customers/create" ? "create" : "update",
          status: syncStatus,
          shopifyId: shopifyCustomerId,
          erpId,
          errorMessage: errMsg,
        });
        break;
      }

      case "app/uninstalled": {
        await db
          .update(organizationsTable)
          .set({
            shopifyShopDomain: null,
            shopifyAccessToken: null,
            shopifyScopes: null,
            shopifyLocationId: null,
            shopifyWebhookRegisteredAt: null,
            shopifyLastWebhookAt: null,
            shopifyLastSyncedAt: null,
            shopifyProductCount: null,
            shopifyLastOrderId: null,
          })
          .where(eq(organizationsTable.id, org.id));
        await db
          .update(itemsTable)
          .set({
            shopifyProductId: null,
            shopifyVariantId: null,
            shopifyInventoryItemId: null,
          })
          .where(eq(itemsTable.organizationId, org.id));
        // Drop warehouse mappings so a fresh install (possibly against a
        // different store) doesn't inherit stale Shopify location ids.
        await db
          .update(warehousesTable)
          .set({ shopifyLocationId: null, shopifyLocationName: null })
          .where(eq(warehousesTable.organizationId, org.id));
        break;
      }

      case "fulfillments/create":
      case "fulfillments/update": {
        // Shopify sends the fulfillment object with order_id + tracking.
        // Full sync: advance ERP fulfillment + order status, propagate
        // delivery status, sync carrier/AWB tracking, and store the
        // Shopify fulfillment ID on the matching ERP shipment.
        const f = body as {
          id?: number;
          order_id?: number;
          status?: string | null;
          /** Carrier delivery status e.g. "delivered", "in_transit". */
          shipment_status?: string | null;
          tracking_number?: string | null;
          tracking_numbers?: string[];
          tracking_company?: string | null;
          tracking_url?: string | null;
          tracking_urls?: string[];
        };
        if (!f.order_id) break;
        const shopifyFulfillmentOrderId = String(f.order_id);
        const inboundFulfillmentId = f.id != null ? String(f.id) : null;

        const orderRows2 = await db
          .select({ id: salesOrdersTable.id, status: salesOrdersTable.status })
          .from(salesOrdersTable)
          .where(
            and(
              eq(salesOrdersTable.organizationId, org.id),
              eq(salesOrdersTable.shopifyOrderId, shopifyFulfillmentOrderId),
            ),
          )
          .limit(1);
        const erpOrder = orderRows2[0];
        if (!erpOrder) break;

        // ── Store shopifyFulfillmentId on matching ERP shipment ───────────
        // Link the Shopify fulfillment ID to an ERP shipment so cancel /
        // tracking-update webhooks can find the right row. We look for the
        // most recent active shipment for this order that isn't already
        // linked to a different Shopify fulfillment — if outbound push ran
        // first it will already be stamped and we update in place.
        if (inboundFulfillmentId) {
          const [existingShipment] = await db
            .select({ id: shipmentsTable.id, shopifyFulfillmentId: shipmentsTable.shopifyFulfillmentId })
            .from(shipmentsTable)
            .where(
              and(
                eq(shipmentsTable.organizationId, org.id),
                eq(shipmentsTable.salesOrderId, erpOrder.id),
                eq(shipmentsTable.status, "shipped"),
              ),
            )
            .orderBy(shipmentsTable.id)
            .limit(1);

          if (existingShipment && !existingShipment.shopifyFulfillmentId) {
            await db
              .update(shipmentsTable)
              .set({ shopifyFulfillmentId: inboundFulfillmentId })
              .where(
                and(
                  eq(shipmentsTable.organizationId, org.id),
                  eq(shipmentsTable.id, existingShipment.id),
                ),
              );
            // Stamp the matching ERP fulfillment record too.
            await db
              .update(fulfillmentsTable)
              .set({ shopifyFulfillmentId: inboundFulfillmentId })
              .where(
                and(
                  eq(fulfillmentsTable.organizationId, org.id),
                  eq(fulfillmentsTable.salesOrderId, erpOrder.id),
                  eq(fulfillmentsTable.status, "dispatched"),
                ),
              );
          }
        }

        // ── ERP fulfillment status ────────────────────────────────────────
        // Advance the auto-created ERP fulfillment to "dispatched" when
        // Shopify creates or updates a successful fulfillment. The ne()
        // guard makes this idempotent for ERP-initiated dispatches.
        const shopifyFulIsActive =
          f.status !== "cancelled" &&
          f.status !== "failure" &&
          f.status !== "error";

        if (shopifyFulIsActive) {
          await db
            .update(fulfillmentsTable)
            .set({ status: "dispatched", dispatchedAt: new Date() })
            .where(
              and(
                eq(fulfillmentsTable.organizationId, org.id),
                eq(fulfillmentsTable.salesOrderId, erpOrder.id),
                ne(fulfillmentsTable.status, "dispatched"),
              ),
            );

          // Advance order to "shipped" (unless already at/past shipped)
          const PAST_SHIPPED = [
            "shipped", "delivered", "invoiced", "paid",
            "returned", "refunded", "cancelled",
          ];
          if (!PAST_SHIPPED.includes(erpOrder.status)) {
            await db
              .update(salesOrdersTable)
              .set({ status: "shipped" })
              .where(
                and(
                  eq(salesOrdersTable.organizationId, org.id),
                  eq(salesOrdersTable.id, erpOrder.id),
                  notInArray(salesOrdersTable.status, PAST_SHIPPED),
                ),
              );
          }
        }

        // ── Carrier delivery confirmation ─────────────────────────────────
        // When the carrier marks the shipment "delivered", advance the ERP
        // order from "shipped" → "delivered".
        if (f.shipment_status === "delivered") {
          const PAST_DELIVERED = [
            "delivered", "invoiced", "paid", "returned", "refunded", "cancelled",
          ];
          await db
            .update(salesOrdersTable)
            .set({ status: "delivered" })
            .where(
              and(
                eq(salesOrdersTable.organizationId, org.id),
                eq(salesOrdersTable.id, erpOrder.id),
                notInArray(salesOrdersTable.status, PAST_DELIVERED),
              ),
            );
        }

        // ── Tracking sync ─────────────────────────────────────────────────
        const trackingNumber = f.tracking_number ?? f.tracking_numbers?.[0] ?? null;
        const trackingCompany = f.tracking_company ?? null;
        const trackingUrl = f.tracking_url ?? f.tracking_urls?.[0] ?? null;

        if (trackingNumber || trackingCompany || trackingUrl) {
          const shipmentUpdate = {
            ...(trackingNumber ? { awb: trackingNumber } : {}),
            ...(trackingCompany ? { courierName: trackingCompany } : {}),
            ...(trackingUrl ? { trackingUrl } : {}),
          };
          const fulfillmentUpdate = {
            ...(trackingNumber ? { awbNumber: trackingNumber } : {}),
            ...(trackingCompany ? { courierName: trackingCompany } : {}),
            ...(trackingUrl ? { trackingUrl } : {}),
          };

          if (Object.keys(shipmentUpdate).length > 0) {
            await db
              .update(shipmentsTable)
              .set(shipmentUpdate)
              .where(
                and(
                  eq(shipmentsTable.organizationId, org.id),
                  eq(shipmentsTable.salesOrderId, erpOrder.id),
                  eq(shipmentsTable.status, "shipped"),
                ),
              );
          }
          if (Object.keys(fulfillmentUpdate).length > 0) {
            // Update both dispatched AND newly-advanced fulfillment records
            await db
              .update(fulfillmentsTable)
              .set(fulfillmentUpdate)
              .where(
                and(
                  eq(fulfillmentsTable.organizationId, org.id),
                  eq(fulfillmentsTable.salesOrderId, erpOrder.id),
                  eq(fulfillmentsTable.status, "dispatched"),
                ),
              );
          }
        }

        // ── Sync log ──────────────────────────────────────────────────────
        if (inboundFulfillmentId) {
          await db.insert(shopifySyncLogsTable).values({
            organizationId: org.id,
            direction: "inbound",
            entity: "fulfillment",
            action: topic === "fulfillments/create" ? "create" : "update",
            status: "success",
            shopifyId: inboundFulfillmentId,
            erpId: String(erpOrder.id),
          });
        }

        await db
          .update(organizationsTable)
          .set({ shopifyLastWebhookAt: new Date() })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      case "fulfillments/cancel": {
        // Shopify cancelled a fulfillment — cancel the matching ERP shipment,
        // reverse its stock movements, and re-derive the order status.
        const fc = body as { id?: number; order_id?: number };
        if (!fc.id || !fc.order_id) break;
        const cancelledShopifyId = String(fc.id);
        const cancelledOrderShopifyId = String(fc.order_id);

        // Find ERP order by Shopify order ID.
        const [fcOrder] = await db
          .select({ id: salesOrdersTable.id })
          .from(salesOrdersTable)
          .where(
            and(
              eq(salesOrdersTable.organizationId, org.id),
              eq(salesOrdersTable.shopifyOrderId, cancelledOrderShopifyId),
            ),
          )
          .limit(1);
        if (!fcOrder) break;

        // Find the ERP shipment linked to this Shopify fulfillment.
        const [fcShipment] = await db
          .select({ id: shipmentsTable.id })
          .from(shipmentsTable)
          .where(
            and(
              eq(shipmentsTable.organizationId, org.id),
              eq(shipmentsTable.salesOrderId, fcOrder.id),
              eq(shipmentsTable.shopifyFulfillmentId, cancelledShopifyId),
            ),
          )
          .limit(1);

        if (!fcShipment) {
          // No linked ERP shipment (may have been cancelled already or never linked).
          await db.insert(shopifySyncLogsTable).values({
            organizationId: org.id,
            direction: "inbound",
            entity: "fulfillment",
            action: "delete",
            status: "skipped",
            shopifyId: cancelledShopifyId,
            erpId: String(fcOrder.id),
            failureReason: "skipped_mapped",
            errorMessage: "No active ERP shipment linked to this Shopify fulfillment ID",
          });
          break;
        }

        // Cancel the ERP shipment and reverse stock movements.
        const cancelResult = await db.transaction(async (tx) => {
          const r = await cancelShipmentCore(tx, org.id, fcShipment.id);
          if (r.kind === "ok") {
            await deriveAndUpdateOrderStatus(tx, org.id, r.salesOrderId);
          }
          return r;
        });

        if (cancelResult.kind === "ok") {
          for (const itemId of cancelResult.touchedItems) {
            pushStockToShopify(org.id, itemId);
          }
          await db.insert(shopifySyncLogsTable).values({
            organizationId: org.id,
            direction: "inbound",
            entity: "fulfillment",
            action: "delete",
            status: "success",
            shopifyId: cancelledShopifyId,
            erpId: String(fcShipment.id),
          });
        } else {
          // already_cancelled — idempotent, treat as success
          await db.insert(shopifySyncLogsTable).values({
            organizationId: org.id,
            direction: "inbound",
            entity: "fulfillment",
            action: "delete",
            status: "skipped",
            shopifyId: cancelledShopifyId,
            erpId: String(fcShipment.id),
            failureReason: "skipped_mapped",
            errorMessage: "ERP shipment was already cancelled",
          });
        }

        await db
          .update(organizationsTable)
          .set({ shopifyLastWebhookAt: new Date() })
          .where(eq(organizationsTable.id, org.id));
        break;
      }

      default:
        req.log?.info({ topic, shopDomain }, "Unhandled Shopify webhook topic");
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
