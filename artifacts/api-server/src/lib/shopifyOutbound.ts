import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  fulfillmentsTable,
  itemsTable,
  itemWarehouseStockTable,
  organizationsTable,
  salesOrdersTable,
  shipmentsTable,
  shopifySyncLogsTable,
  warehousesTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  addVariantToShopifyProduct,
  cancelShopifyFulfillment,
  createShopifyCustomer,
  createShopifyFulfillment,
  createShopifyFulfillmentEvent,
  createShopifyProduct,
  createShopifyProductWithVariants,
  createShopifyRefund,
  fetchFulfillmentOrders,
  holdFulfillmentOrder,
  openFulfillmentOrder,
  setInventoryLevel,
  updateShopifyCustomer,
  updateShopifyFulfillmentTracking,
  updateShopifyOrderNote,
  updateShopifyOrderPaymentStatus,
  updateShopifyProduct,
} from "./shopify";
import { computeBundleStockByWarehouse } from "./bundles";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type OrgCreds = { shopDomain: string; accessToken: string; orgLocationId: string | null };

async function fetchOrgCreds(orgId: number): Promise<OrgCreds | null> {
  const rows = await db
    .select({
      shopDomain: organizationsTable.shopifyShopDomain,
      accessToken: organizationsTable.shopifyAccessToken,
      orgLocationId: organizationsTable.shopifyLocationId,
    })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1); // org-scope-allow: internal outbound push — queried by primary key
  const org = rows[0];
  if (!org || !org.shopDomain || !org.accessToken) return null;
  return org as OrgCreds;
}

/** Categorise a raw error message into a structured failure reason. */
function classifyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("duplicate") || m.includes("already been taken") || m.includes("sku")) return "duplicate_sku";
  if (m.includes("429") || m.includes("rate limit") || m.includes("throttl")) return "rate_limit";
  if (m.includes("422") || m.includes("unprocessable") || m.includes("invalid")) return "validation";
  if (m.includes("404") || m.includes("not found")) return "missing_data";
  return "api_error";
}

/**
 * Fire-and-forget sync log write. Never throws — a logging failure must never
 * block or fail the actual sync operation.
 */
function writeSyncLog(
  orgId: number,
  entry: {
    direction?: string;
    entity: string;
    action: string;
    status: string;
    shopifyId?: string | null;
    erpId?: string | null;
    sku?: string | null;
    name?: string | null;
    parentItemId?: number | null;
    failureReason?: string | null;
    errorMessage?: string | null;
  },
): void {
  db.insert(shopifySyncLogsTable)
    .values({
      organizationId: orgId,
      direction: entry.direction ?? "outbound",
      entity: entry.entity,
      action: entry.action,
      status: entry.status,
      shopifyId: entry.shopifyId ?? null,
      erpId: entry.erpId ?? null,
      sku: entry.sku ?? null,
      name: entry.name ?? null,
      parentItemId: entry.parentItemId ?? null,
      failureReason: entry.failureReason ?? null,
      errorMessage: entry.errorMessage ?? null,
    })
    .catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Failed to write shopify sync log");
    });
}

// ─── Product-fields push (name, sku, barcode, price, status, category) ───────

/**
 * Per-(orgId,itemId) push state for product-field syncs. Independent of
 * the stock push state so the two don't coalesce each other.
 */
type ProductPushState = { inFlight: Promise<void>; pending: boolean };
const productPushStates = new Map<string, ProductPushState>();
const productKeyOf = (orgId: number, itemId: number): string => `product:${orgId}:${itemId}`;

/**
 * Fire-and-forget push of an item's product fields (name, sku, barcode,
 * price, status, category) to the linked Shopify product/variant.
 *
 * No-op if:
 *   - the org isn't connected to Shopify, OR
 *   - the item has no shopifyProductId / shopifyVariantId mapping.
 *
 * Uses the same coalescing pattern as pushStockToShopify so a burst of
 * rapid edits results in at most one in-flight + one follow-up call.
 */
export function pushProductFieldsToShopify(orgId: number, itemId: number): void {
  const key = productKeyOf(orgId, itemId);
  const existing = productPushStates.get(key);
  if (existing) {
    existing.pending = true;
    return;
  }
  startProductPush(key, orgId, itemId);
}

function startProductPush(key: string, orgId: number, itemId: number): void {
  const state: ProductPushState = { pending: false, inFlight: Promise.resolve() };
  state.inFlight = (async () => {
    try {
      await pushProductFieldsToShopifyAsync(orgId, itemId);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), orgId, itemId },
        "Shopify outbound product fields push failed",
      );
    } finally {
      const followUp = state.pending;
      productPushStates.delete(key);
      if (followUp) startProductPush(key, orgId, itemId);
    }
  })();
  productPushStates.set(key, state);
}

async function pushProductFieldsToShopifyAsync(orgId: number, itemId: number): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const itemRows = await db
    .select({
      name: itemsTable.name,
      sku: itemsTable.sku,
      barcode: itemsTable.barcode,
      salePrice: itemsTable.salePrice,
      category: itemsTable.category,
      archivedAt: itemsTable.archivedAt,
      shopifyProductId: itemsTable.shopifyProductId,
      shopifyVariantId: itemsTable.shopifyVariantId,
      parentItemId: itemsTable.parentItemId,
    })
    .from(itemsTable)
    .where(and(eq(itemsTable.id, itemId), eq(itemsTable.organizationId, orgId)))
    .limit(1);
  const item = itemRows[0];
  if (!item) return;
  if (!item.shopifyProductId || !item.shopifyVariantId) {
    writeSyncLog(orgId, {
      entity: "product",
      action: "update",
      status: "skipped",
      erpId: String(itemId),
      sku: item.sku,
      name: item.name,
      parentItemId: item.parentItemId,
      failureReason: "skipped_mapped",
    });
    return;
  }

  const status: "active" | "draft" = item.archivedAt ? "draft" : "active";

  // For variant children the Shopify **product** title is owned by the parent
  // item, not the child. Sending the child's ERP name (e.g. "Womens Leggings — L")
  // as `title` contaminates the product title and causes the webhook to
  // accumulate suffixes ("…— L — L — L"). Skip `title` for child variants;
  // the parent's pushProductFieldsToShopify call handles the product title.
  const shopifyTitle = item.parentItemId ? undefined : item.name;

  try {
    await updateShopifyProduct(org.shopDomain, org.accessToken, item.shopifyProductId, {
      variantId: item.shopifyVariantId,
      title: shopifyTitle,
      sku: item.sku,
      barcode: item.barcode,
      price: item.salePrice ?? "0",
      category: item.category,
      status,
    });
    writeSyncLog(orgId, {
      entity: "product",
      action: "update",
      status: "success",
      erpId: String(itemId),
      sku: item.sku,
      name: item.name,
      shopifyId: item.shopifyProductId,
      parentItemId: item.parentItemId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    writeSyncLog(orgId, {
      entity: "product",
      action: "update",
      status: "error",
      erpId: String(itemId),
      sku: item.sku,
      name: item.name,
      shopifyId: item.shopifyProductId,
      parentItemId: item.parentItemId,
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    throw err;
  }
}

// ─── New product create push ──────────────────────────────────────────────────

/**
 * Fire-and-forget: create a new Shopify product for a locally-created item.
 * Handles flat items, variant children, and variant parents with full logging.
 * Bundles are skipped (they have no physical stock).
 *
 * No-op when:
 *   - the org isn't connected to Shopify, OR
 *   - the item already has a shopifyProductId (already mapped).
 */
export function createProductInShopify(orgId: number, itemId: number): void {
  createProductInShopifyAsync(orgId, itemId).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, itemId },
      "Shopify outbound create product failed",
    );
  });
}

async function createProductInShopifyAsync(orgId: number, itemId: number): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const itemRows = await db
    .select({
      name: itemsTable.name,
      sku: itemsTable.sku,
      barcode: itemsTable.barcode,
      salePrice: itemsTable.salePrice,
      category: itemsTable.category,
      shopifyProductId: itemsTable.shopifyProductId,
      isBundle: itemsTable.isBundle,
      hasVariants: itemsTable.hasVariants,
      parentItemId: itemsTable.parentItemId,
      variantOptions: itemsTable.variantOptions,
    })
    .from(itemsTable)
    .where(and(eq(itemsTable.id, itemId), eq(itemsTable.organizationId, orgId)))
    .limit(1);
  const item = itemRows[0];
  if (!item) return;

  // Already mapped — skip silently (no log spam on re-connect flows)
  if (item.shopifyProductId) return;

  // Bundles have no physical stock → skip with log
  if (item.isBundle) {
    writeSyncLog(orgId, {
      entity: "product",
      action: "create",
      status: "skipped",
      erpId: String(itemId),
      sku: item.sku,
      name: item.name,
      failureReason: "skipped_bundle",
    });
    return;
  }

  // Variant child → add as variant to the parent Shopify product
  if (item.parentItemId) {
    await syncVariantChildToShopify(orgId, itemId, item, org);
    return;
  }

  // Variant parent → create multi-variant Shopify product from all children
  if (item.hasVariants) {
    await syncVariantParentToShopify(orgId, itemId, item, org);
    return;
  }

  // Flat item → create a single-variant Shopify product
  try {
    const ids = await createShopifyProduct(org.shopDomain, org.accessToken, {
      title: item.name,
      sku: item.sku,
      price: item.salePrice ?? "0",
      barcode: item.barcode,
      category: item.category,
    });

    await db
      .update(itemsTable)
      .set({
        shopifyProductId: ids.productId,
        shopifyVariantId: ids.variantId,
        shopifyInventoryItemId: ids.inventoryItemId || null,
      })
      .where(and(eq(itemsTable.id, itemId), eq(itemsTable.organizationId, orgId)));

    writeSyncLog(orgId, {
      entity: "product",
      action: "create",
      status: "success",
      erpId: String(itemId),
      sku: item.sku,
      name: item.name,
      shopifyId: ids.productId,
    });

    // Push current stock to the new product so it isn't stuck at 0.
    pushStockToShopify(orgId, itemId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    writeSyncLog(orgId, {
      entity: "product",
      action: "create",
      status: "error",
      erpId: String(itemId),
      sku: item.sku,
      name: item.name,
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    throw err;
  }
}

/**
 * Sync a variant child item to Shopify.
 *
 * If the parent already has a shopifyProductId: add this child as a new
 * Shopify variant on the existing product.
 *
 * If the parent has no shopifyProductId yet: create the full multi-variant
 * Shopify product using all currently-known children (including this one).
 */
async function syncVariantChildToShopify(
  orgId: number,
  itemId: number,
  item: {
    name: string;
    sku: string;
    barcode: string | null;
    salePrice: string | null;
    category: string | null;
    parentItemId: number | null;
  },
  org: OrgCreds,
): Promise<void> {
  const parentId = item.parentItemId!;

  // Fetch parent item
  const parentRows = await db
    .select({
      name: itemsTable.name,
      sku: itemsTable.sku,
      category: itemsTable.category,
      shopifyProductId: itemsTable.shopifyProductId,
      variantOptions: itemsTable.variantOptions,
    })
    .from(itemsTable)
    .where(and(eq(itemsTable.id, parentId), eq(itemsTable.organizationId, orgId)))
    .limit(1);
  const parent = parentRows[0];

  if (!parent) {
    writeSyncLog(orgId, {
      entity: "product",
      action: "create",
      status: "error",
      erpId: String(itemId),
      sku: item.sku,
      name: item.name,
      parentItemId: parentId,
      errorMessage: "Parent item not found",
      failureReason: "missing_data",
    });
    return;
  }

  if (parent.shopifyProductId) {
    // Parent already on Shopify → add this child as a new variant
    try {
      const result = await addVariantToShopifyProduct(
        org.shopDomain,
        org.accessToken,
        parent.shopifyProductId,
        {
          sku: item.sku,
          price: item.salePrice ?? "0",
          barcode: item.barcode,
          option1: item.name, // use variant item name as the option value
        },
      );

      await db
        .update(itemsTable)
        .set({
          shopifyProductId: parent.shopifyProductId,
          shopifyVariantId: result.variantId,
          shopifyInventoryItemId: result.inventoryItemId || null,
        })
        .where(and(eq(itemsTable.id, itemId), eq(itemsTable.organizationId, orgId)));

      writeSyncLog(orgId, {
        entity: "product",
        action: "create",
        status: "success",
        erpId: String(itemId),
        sku: item.sku,
        name: item.name,
        shopifyId: result.variantId,
        parentItemId: parentId,
      });

      pushStockToShopify(orgId, itemId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      writeSyncLog(orgId, {
        entity: "product",
        action: "create",
        status: "error",
        erpId: String(itemId),
        sku: item.sku,
        name: item.name,
        parentItemId: parentId,
        errorMessage,
        failureReason: classifyError(errorMessage),
      });
      throw err;
    }
  } else {
    // Parent not yet on Shopify → create the full product with all children
    await syncVariantParentToShopify(orgId, parentId, parent, org);
  }
}

/**
 * Create a Shopify product from an ERP hasVariants parent and all its current
 * children. Writes shopifyProductId back to the parent and
 * shopifyProductId + shopifyVariantId + shopifyInventoryItemId to each child.
 * Pushes stock for every child after the Shopify product is created.
 */
async function syncVariantParentToShopify(
  orgId: number,
  parentItemId: number,
  parent: {
    name: string;
    sku: string;
    category: string | null;
    shopifyProductId?: string | null;
    variantOptions?: unknown;
  },
  org: OrgCreds,
): Promise<void> {
  // Already mapped — nothing to do
  if (parent.shopifyProductId) return;

  // Fetch all variant children
  const children = await db
    .select({
      id: itemsTable.id,
      name: itemsTable.name,
      sku: itemsTable.sku,
      barcode: itemsTable.barcode,
      salePrice: itemsTable.salePrice,
      shopifyProductId: itemsTable.shopifyProductId,
    })
    .from(itemsTable)
    .where(
      and(
        eq(itemsTable.parentItemId, parentItemId),
        eq(itemsTable.organizationId, orgId),
      ),
    );

  if (children.length === 0) {
    // No children yet — skip silently; will be triggered when first child is created
    writeSyncLog(orgId, {
      entity: "product",
      action: "create",
      status: "skipped",
      erpId: String(parentItemId),
      name: parent.name,
      sku: parent.sku,
      failureReason: "skipped_parent",
    });
    return;
  }

  // Build option axes from variantOptions or fall back to "Variant"
  const optionAxes: string[] = (() => {
    const vo = parent.variantOptions as { axes?: string[] } | null;
    if (vo?.axes && vo.axes.length > 0) return vo.axes.slice(0, 3);
    return ["Variant"];
  })();

  const variantDefs = children.map((c) => ({
    sku: c.sku,
    price: c.salePrice ?? "0",
    barcode: c.barcode,
    option1: c.name, // variant item name as option1 value
  }));

  try {
    const result = await createShopifyProductWithVariants(org.shopDomain, org.accessToken, {
      title: parent.name,
      category: parent.category,
      options: optionAxes,
      variants: variantDefs,
    });

    // Write shopifyProductId to parent
    await db
      .update(itemsTable)
      .set({ shopifyProductId: result.productId })
      .where(and(eq(itemsTable.id, parentItemId), eq(itemsTable.organizationId, orgId)));

    writeSyncLog(orgId, {
      entity: "product",
      action: "create",
      status: "success",
      erpId: String(parentItemId),
      name: parent.name,
      sku: parent.sku,
      shopifyId: result.productId,
    });

    // Write variant IDs to each child and push stock
    for (const child of children) {
      const matched = result.variants.find((v) => v.sku === child.sku);
      if (!matched) {
        writeSyncLog(orgId, {
          entity: "product",
          action: "create",
          status: "error",
          erpId: String(child.id),
          sku: child.sku,
          name: child.name,
          parentItemId: parentItemId,
          errorMessage: `Shopify response missing variant for SKU ${child.sku}`,
          failureReason: "api_error",
        });
        continue;
      }

      await db
        .update(itemsTable)
        .set({
          shopifyProductId: result.productId,
          shopifyVariantId: matched.variantId,
          shopifyInventoryItemId: matched.inventoryItemId || null,
        })
        .where(and(eq(itemsTable.id, child.id), eq(itemsTable.organizationId, orgId)));

      writeSyncLog(orgId, {
        entity: "product",
        action: "create",
        status: "success",
        erpId: String(child.id),
        sku: child.sku,
        name: child.name,
        shopifyId: matched.variantId,
        parentItemId: parentItemId,
      });

      pushStockToShopify(orgId, child.id);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Log failure for parent and all children
    writeSyncLog(orgId, {
      entity: "product",
      action: "create",
      status: "error",
      erpId: String(parentItemId),
      name: parent.name,
      sku: parent.sku,
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    for (const child of children) {
      writeSyncLog(orgId, {
        entity: "product",
        action: "create",
        status: "error",
        erpId: String(child.id),
        sku: child.sku,
        name: child.name,
        parentItemId: parentItemId,
        errorMessage,
        failureReason: classifyError(errorMessage),
      });
    }
    throw err;
  }
}

// ─── Fulfillment push ─────────────────────────────────────────────────────────

/**
 * Fire-and-forget: create a Shopify fulfillment for the linked order when a
 * shipment is recorded in inventory. No-op if the order has no shopifyOrderId
 * or the org isn't connected to Shopify. Idempotent — skips if the shipment
 * already has a shopifyFulfillmentId. Errors are logged + swallowed so they
 * never block the inventory operation.
 */
export function pushFulfillmentToShopify(
  orgId: number,
  salesOrderId: number,
  shipmentId: number,
): void {
  pushFulfillmentToShopifyAsync(orgId, salesOrderId, shipmentId).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, salesOrderId, shipmentId },
      "Shopify outbound fulfillment push failed",
    );
  });
}

async function pushFulfillmentToShopifyAsync(
  orgId: number,
  salesOrderId: number,
  shipmentId: number,
): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  // Fetch shipment (need shopifyFulfillmentId for idempotency check)
  const [shipmentRow] = await db
    .select({ shopifyFulfillmentId: shipmentsTable.shopifyFulfillmentId })
    .from(shipmentsTable)
    .where(
      and(
        eq(shipmentsTable.id, shipmentId),
        eq(shipmentsTable.organizationId, orgId),
      ),
    )
    .limit(1);

  const orderRows = await db
    .select({
      shopifyOrderId: salesOrdersTable.shopifyOrderId,
      warehouseId: salesOrdersTable.warehouseId,
      status: salesOrdersTable.status,
    })
    .from(salesOrdersTable)
    .where(
      and(
        eq(salesOrdersTable.id, salesOrderId),
        eq(salesOrdersTable.organizationId, orgId),
      ),
    )
    .limit(1);
  const order = orderRows[0];
  if (!order?.shopifyOrderId) return;
  // Push when at least some lines have shipped (partial or full).
  if (!["partially_shipped", "shipped"].includes(order.status)) return;

  // Fetch tracking info from the most recently dispatched ERP fulfillment
  // so Shopify always receives the AWB/carrier the warehouse staff entered.
  const [trackingRow] = await db
    .select({
      id: fulfillmentsTable.id,
      awbNumber: fulfillmentsTable.awbNumber,
      courierName: fulfillmentsTable.courierName,
      trackingUrl: fulfillmentsTable.trackingUrl,
    })
    .from(fulfillmentsTable)
    .where(
      and(
        eq(fulfillmentsTable.organizationId, orgId),
        eq(fulfillmentsTable.salesOrderId, salesOrderId),
        eq(fulfillmentsTable.status, "dispatched"),
      ),
    )
    .orderBy(desc(fulfillmentsTable.dispatchedAt))
    .limit(1);

  // Idempotency: if this shipment was already linked to a Shopify fulfillment
  // (either pushed by us previously or stamped by an inbound webhook), update
  // tracking info rather than creating a duplicate fulfillment.
  if (shipmentRow?.shopifyFulfillmentId) {
    const hasTracking = trackingRow && (
      trackingRow.awbNumber || trackingRow.courierName || trackingRow.trackingUrl
    );
    if (hasTracking) {
      try {
        await updateShopifyFulfillmentTracking(
          org.shopDomain,
          org.accessToken,
          order.shopifyOrderId,
          shipmentRow.shopifyFulfillmentId,
          {
            number: trackingRow!.awbNumber,
            company: trackingRow!.courierName,
            url: trackingRow!.trackingUrl,
          },
        );
        await db.insert(shopifySyncLogsTable).values({
          organizationId: orgId,
          direction: "outbound",
          entity: "fulfillment",
          action: "update",
          status: "success",
          shopifyId: shipmentRow.shopifyFulfillmentId,
          erpId: String(shipmentId),
        });
        logger.info(
          { orgId, shipmentId, shopifyFulfillmentId: shipmentRow.shopifyFulfillmentId },
          "Shopify fulfillment tracking updated",
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await db.insert(shopifySyncLogsTable).values({
          organizationId: orgId,
          direction: "outbound",
          entity: "fulfillment",
          action: "update",
          status: "error",
          shopifyId: shipmentRow.shopifyFulfillmentId,
          erpId: String(shipmentId),
          errorMessage,
          failureReason: classifyError(errorMessage),
        });
      }
    } else {
      logger.info({ orgId, shipmentId }, "Shopify fulfillment push skipped — already pushed, no tracking to update");
    }
    return;
  }

  const whRows = await db
    .select({ shopifyLocationId: warehousesTable.shopifyLocationId })
    .from(warehousesTable)
    .where(
      and(
        eq(warehousesTable.id, order.warehouseId),
        eq(warehousesTable.organizationId, orgId),
      ),
    )
    .limit(1);
  const locationId = whRows[0]?.shopifyLocationId ?? org.orgLocationId;

  const result = await createShopifyFulfillment(
    org.shopDomain,
    org.accessToken,
    order.shopifyOrderId,
    locationId,
    trackingRow
      ? {
          number: trackingRow.awbNumber,
          company: trackingRow.courierName,
          url: trackingRow.trackingUrl,
        }
      : undefined,
  );

  const logBase = {
    organizationId: orgId,
    direction: "outbound" as const,
    entity: "fulfillment",
    shopifyId: order.shopifyOrderId,
    erpId: String(shipmentId),
  };

  if (!result.ok) {
    const isSkip = result.reason === "already_fulfilled";
    logger.info(
      { orgId, shipmentId, reason: result.reason, message: result.message },
      isSkip
        ? "Shopify fulfillment push skipped — order already fulfilled on Shopify"
        : "Shopify fulfillment push API error",
    );
    await db.insert(shopifySyncLogsTable).values({
      ...logBase,
      action: "create",
      status: isSkip ? "skipped" : "error",
      failureReason: isSkip ? "skipped_mapped" : "api_error",
      errorMessage: result.message ?? result.reason,
    });
    return;
  }

  const { shopifyFulfillmentId } = result;

  // Store the Shopify fulfillment ID on the shipment (for idempotency + cancel).
  await db
    .update(shipmentsTable)
    .set({ shopifyFulfillmentId })
    .where(
      and(
        eq(shipmentsTable.id, shipmentId),
        eq(shipmentsTable.organizationId, orgId),
      ),
    );

  // Also stamp the most recently dispatched ERP fulfillment record.
  if (trackingRow) {
    await db
      .update(fulfillmentsTable)
      .set({ shopifyFulfillmentId })
      .where(
        and(
          eq(fulfillmentsTable.id, trackingRow.id),
          eq(fulfillmentsTable.organizationId, orgId),
        ),
      );
  }

  await db.insert(shopifySyncLogsTable).values({
    ...logBase,
    action: "create",
    status: "success",
    shopifyId: shopifyFulfillmentId,
  });

  logger.info(
    { orgId, shipmentId, shopifyFulfillmentId },
    "Shopify fulfillment created and ID stored",
  );
}

/**
 * Fire-and-forget: cancel the Shopify fulfillment linked to an ERP shipment.
 * No-op if the shipment has no shopifyFulfillmentId or the org isn't connected.
 * Called when an ERP shipment is cancelled to keep Shopify in sync.
 */
export function cancelFulfillmentOnShopify(orgId: number, shipmentId: number): void {
  cancelFulfillmentOnShopifyAsync(orgId, shipmentId).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, shipmentId },
      "Shopify outbound fulfillment cancel failed",
    );
  });
}

async function cancelFulfillmentOnShopifyAsync(orgId: number, shipmentId: number): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const [shipmentRow] = await db
    .select({
      shopifyFulfillmentId: shipmentsTable.shopifyFulfillmentId,
      salesOrderId: shipmentsTable.salesOrderId,
    })
    .from(shipmentsTable)
    .where(
      and(
        eq(shipmentsTable.id, shipmentId),
        eq(shipmentsTable.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!shipmentRow?.shopifyFulfillmentId) return;

  const [orderRow] = await db
    .select({ shopifyOrderId: salesOrdersTable.shopifyOrderId })
    .from(salesOrdersTable)
    .where(
      and(
        eq(salesOrdersTable.id, shipmentRow.salesOrderId),
        eq(salesOrdersTable.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!orderRow?.shopifyOrderId) return;

  await cancelShopifyFulfillment(
    org.shopDomain,
    org.accessToken,
    orderRow.shopifyOrderId,
    shipmentRow.shopifyFulfillmentId,
  );

  await db.insert(shopifySyncLogsTable).values({
    organizationId: orgId,
    direction: "outbound",
    entity: "fulfillment",
    action: "delete",
    status: "success",
    shopifyId: shipmentRow.shopifyFulfillmentId,
    erpId: String(shipmentId),
  });

  logger.info(
    { orgId, shipmentId, shopifyFulfillmentId: shipmentRow.shopifyFulfillmentId },
    "Shopify fulfillment cancelled",
  );
}

// ─── Stock push ───────────────────────────────────────────────────────────────

/**
 * Per-(orgId,itemId) push state. Ensures at most one HTTP call to Shopify is
 * in flight per item at a time, and that any pushes requested while one is
 * running collapse into a single "follow-up" push that re-reads current state.
 */
type PushState = { inFlight: Promise<void>; pending: boolean };
const pushStates = new Map<string, PushState>();
const keyOf = (orgId: number, itemId: number): string => `${orgId}:${itemId}`;

/**
 * Fire-and-forget push of an item's stock back to Shopify, per-warehouse.
 * No-op if the org isn't connected or the item has no inventory_item_id.
 */
export function pushStockToShopify(orgId: number, itemId: number): void {
  const key = keyOf(orgId, itemId);
  const existing = pushStates.get(key);
  if (existing) {
    existing.pending = true;
    return;
  }
  startPush(key, orgId, itemId);
}

function startPush(key: string, orgId: number, itemId: number): void {
  const state: PushState = { pending: false, inFlight: Promise.resolve() };
  state.inFlight = (async () => {
    try {
      await pushStockToShopifyAsync(orgId, itemId);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), orgId, itemId },
        "Shopify outbound stock push failed",
      );
    } finally {
      const followUp = state.pending;
      pushStates.delete(key);
      if (followUp) startPush(key, orgId, itemId);
    }
  })();
  pushStates.set(key, state);
}

async function pushStockToShopifyAsync(orgId: number, itemId: number): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const itemRows = await db
    .select({
      sku: itemsTable.sku,
      name: itemsTable.name,
      inventoryItemId: itemsTable.shopifyInventoryItemId,
      isBundle: itemsTable.isBundle,
      parentItemId: itemsTable.parentItemId,
    })
    .from(itemsTable)
    .where(and(eq(itemsTable.id, itemId), eq(itemsTable.organizationId, orgId)))
    .limit(1);
  const item = itemRows[0];
  if (!item || !item.inventoryItemId) return;

  // For bundles, push derived per-warehouse stock (computed from current
  // components). For physical items, push the row's quantity. We left-join
  // warehouses so warehouses with no stock row push 0.
  let rows: Array<{ shopifyLocationId: string; warehouseId: number; quantity: number }>;

  if (item.isBundle) {
    const derived = await computeBundleStockByWarehouse(orgId, itemId);
    const derivedById = new Map(derived.map((d) => [d.warehouseId, d.quantity]));
    const whRows = await db
      .select({
        warehouseId: warehousesTable.id,
        shopifyLocationId: warehousesTable.shopifyLocationId,
      })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.organizationId, orgId),
          isNotNull(warehousesTable.shopifyLocationId),
        ),
      );
    rows = whRows.flatMap((w) =>
      w.shopifyLocationId
        ? [{ warehouseId: w.warehouseId, shopifyLocationId: w.shopifyLocationId, quantity: derivedById.get(w.warehouseId) ?? 0 }]
        : [],
    );
  } else {
    const stockRows = await db
      .select({
        warehouseId: warehousesTable.id,
        shopifyLocationId: warehousesTable.shopifyLocationId,
        quantity: itemWarehouseStockTable.quantity,
        ecReserved: itemWarehouseStockTable.ecReserved,
      })
      .from(warehousesTable)
      .leftJoin(
        itemWarehouseStockTable,
        and(
          eq(itemWarehouseStockTable.warehouseId, warehousesTable.id),
          eq(itemWarehouseStockTable.itemId, itemId),
        ),
      )
      .where(
        and(
          eq(warehousesTable.organizationId, orgId),
          isNotNull(warehousesTable.shopifyLocationId),
        ),
      );
    rows = stockRows.flatMap((r) =>
      r.shopifyLocationId
        ? [
            {
              warehouseId: r.warehouseId,
              shopifyLocationId: r.shopifyLocationId,
              quantity: Math.max(0, Number(r.quantity ?? "0") - Number(r.ecReserved ?? "0")),
            },
          ]
        : [],
    );
  }

  // Fallback: if no warehouse has a Shopify location mapping yet, use the
  // org-level primary location with total stock across all non-virtual warehouses.
  if (rows.length === 0 && org.orgLocationId) {
    const totalRows = await db
      .select({
        total: sql<string>`COALESCE(SUM(${itemWarehouseStockTable.quantity}::numeric - COALESCE(${itemWarehouseStockTable.ecReserved}::numeric, 0)), 0)`,
      })
      .from(itemWarehouseStockTable)
      .innerJoin(warehousesTable, eq(warehousesTable.id, itemWarehouseStockTable.warehouseId))
      .where(
        and(
          eq(itemWarehouseStockTable.itemId, itemId),
          eq(itemWarehouseStockTable.organizationId, orgId),
          eq(warehousesTable.isVirtual, false),
        ),
      );
    const total = Math.max(0, Math.round(Number(totalRows[0]?.total ?? "0")));
    rows = [{ shopifyLocationId: org.orgLocationId, warehouseId: 0, quantity: total }];
  }

  let anyError = false;
  for (const r of rows) {
    const qty = Math.round(r.quantity);
    try {
      await setInventoryLevel(
        org.shopDomain,
        org.accessToken,
        item.inventoryItemId,
        r.shopifyLocationId,
        qty,
      );
      writeSyncLog(orgId, {
        entity: "inventory",
        action: "sync",
        status: "success",
        erpId: String(itemId),
        sku: item.sku,
        name: item.name,
        parentItemId: item.parentItemId,
        shopifyId: item.inventoryItemId,
      });
    } catch (err) {
      anyError = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: errorMessage, orgId, itemId, locationId: r.shopifyLocationId },
        "Shopify per-location push failed",
      );
      writeSyncLog(orgId, {
        entity: "inventory",
        action: "sync",
        status: "error",
        erpId: String(itemId),
        sku: item.sku,
        name: item.name,
        parentItemId: item.parentItemId,
        shopifyId: item.inventoryItemId,
        errorMessage,
        failureReason: classifyError(errorMessage),
      });
    }
  }

  if (anyError) throw new Error("One or more stock location pushes failed");
}

// ─── Customer push ────────────────────────────────────────────────────────────

/**
 * Fire-and-forget push of an ERP customer to Shopify.
 * Creates a new Shopify customer if none is linked, otherwise updates.
 * No-op if the org isn't connected to Shopify.
 */
export function pushCustomerToShopify(orgId: number, customerId: number): void {
  pushCustomerToShopifyAsync(orgId, customerId).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, customerId },
      "pushCustomerToShopify failed",
    );
  });
}

async function pushCustomerToShopifyAsync(orgId: number, customerId: number): Promise<void> {
  const orgRows = await db
    .select({
      shopDomain: organizationsTable.shopifyShopDomain,
      accessToken: organizationsTable.shopifyAccessToken,
    })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1); // org-scope-allow: internal outbound push — queried by primary key

  const org = orgRows[0];
  if (!org?.shopDomain || !org.accessToken) return;

  const customerRows = await db
    .select()
    .from(customersTable)
    .where(
      and(
        eq(customersTable.id, customerId),
        eq(customersTable.organizationId, orgId),
      ),
    )
    .limit(1);
  const customer = customerRows[0];
  if (!customer) return;

  const nameParts = (customer.name ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ") || "";

  const fields = {
    firstName,
    lastName,
    email: customer.email ?? undefined,
    phone: customer.phone ?? undefined,
    company: customer.company ?? undefined,
    note: customer.notes ?? undefined,
  };

  let action: string;
  let shopifyId: string;
  let status: "success" | "error" = "success";
  let errorMessage: string | undefined;

  try {
    if (customer.shopifyCustomerId) {
      await updateShopifyCustomer(org.shopDomain, org.accessToken, customer.shopifyCustomerId, fields);
      action = "update";
      shopifyId = customer.shopifyCustomerId;
    } else {
      const newId = await createShopifyCustomer(org.shopDomain, org.accessToken, fields);
      await db
        .update(customersTable)
        .set({ shopifyCustomerId: newId })
        .where(
          and(
            eq(customersTable.id, customerId),
            eq(customersTable.organizationId, orgId),
          ),
        );
      action = "create";
      shopifyId = newId;
    }
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    action = customer.shopifyCustomerId ? "update" : "create";
    shopifyId = customer.shopifyCustomerId ?? "";
    logger.warn(
      { err: errorMessage, orgId, customerId },
      "Shopify customer push failed",
    );
  }

  await db.insert(shopifySyncLogsTable).values({
    organizationId: orgId,
    direction: "outbound",
    entity: "customer",
    action,
    status,
    shopifyId: shopifyId || null,
    erpId: String(customerId),
    errorMessage: errorMessage ?? null,
  });
}

// ─── Payment status sync (ERP → Shopify) ─────────────────────────────────────

/**
 * Fire-and-forget: push the ERP payment status for a sales order to Shopify
 * via order note_attributes (erp_payment_status + erp_synced_at). No-op when
 * the org isn't connected to Shopify or the order has no shopifyOrderId.
 */
export function syncPaymentStatusToShopify(orgId: number, salesOrderId: number): void {
  syncPaymentStatusToShopifyAsync(orgId, salesOrderId).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, salesOrderId },
      "Shopify outbound payment status sync failed",
    );
  });
}

async function syncPaymentStatusToShopifyAsync(orgId: number, salesOrderId: number): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const [order] = await db
    .select({
      shopifyOrderId: salesOrdersTable.shopifyOrderId,
      paymentStatus: salesOrdersTable.paymentStatus,
    })
    .from(salesOrdersTable)
    .where(
      and(
        eq(salesOrdersTable.id, salesOrderId),
        eq(salesOrdersTable.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!order?.shopifyOrderId || !order.paymentStatus) return;

  try {
    await updateShopifyOrderPaymentStatus(
      org.shopDomain,
      org.accessToken,
      order.shopifyOrderId,
      order.paymentStatus,
    );

    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "success",
      shopifyId: order.shopifyOrderId,
      erpId: String(salesOrderId),
      name: "payment_status",
    });

    logger.info(
      { orgId, salesOrderId, paymentStatus: order.paymentStatus },
      "Shopify order payment status synced",
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "error",
      shopifyId: order.shopifyOrderId,
      erpId: String(salesOrderId),
      name: "payment_status",
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    throw err;
  }
}

// ─── Order notes sync (ERP → Shopify) ────────────────────────────────────────

/**
 * Fire-and-forget: push the ERP sales order `notes` field to Shopify when the
 * operator edits it. No-op when the org isn't connected to Shopify or the
 * order has no shopifyOrderId.
 */
export function pushOrderNotesToShopify(orgId: number, salesOrderId: number): void {
  pushOrderNotesToShopifyAsync(orgId, salesOrderId).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, salesOrderId },
      "Shopify outbound order notes sync failed",
    );
  });
}

async function pushOrderNotesToShopifyAsync(orgId: number, salesOrderId: number): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const [order] = await db
    .select({
      shopifyOrderId: salesOrdersTable.shopifyOrderId,
      notes: salesOrdersTable.notes,
    })
    .from(salesOrdersTable)
    .where(
      and(
        eq(salesOrdersTable.id, salesOrderId),
        eq(salesOrdersTable.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!order?.shopifyOrderId) return;

  try {
    await updateShopifyOrderNote(
      org.shopDomain,
      org.accessToken,
      order.shopifyOrderId,
      order.notes,
    );

    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "success",
      shopifyId: order.shopifyOrderId,
      erpId: String(salesOrderId),
      name: "notes",
    });

    logger.info({ orgId, salesOrderId }, "Shopify order notes synced");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "error",
      shopifyId: order.shopifyOrderId,
      erpId: String(salesOrderId),
      name: "notes",
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    throw err;
  }
}

// ─── Delivery push ────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: push an ERP "delivered" status to Shopify by creating a
 * "delivered" fulfillment event on the most recent Shopify-linked shipment.
 * No-op when the org isn't connected or the order has no shopifyFulfillmentId.
 */
export function pushDeliveryToShopify(orgId: number, salesOrderId: number): void {
  pushDeliveryToShopifyAsync(orgId, salesOrderId).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, salesOrderId },
      "Shopify outbound delivery push failed",
    );
  });
}

async function pushDeliveryToShopifyAsync(orgId: number, salesOrderId: number): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  // Find the most recently created non-cancelled shipment that has a
  // Shopify fulfillment id.
  const [shipmentRow] = await db
    .select({ shopifyFulfillmentId: shipmentsTable.shopifyFulfillmentId })
    .from(shipmentsTable)
    .where(
      and(
        eq(shipmentsTable.organizationId, orgId),
        eq(shipmentsTable.salesOrderId, salesOrderId),
        sql`${shipmentsTable.status} != 'cancelled'`,
        sql`${shipmentsTable.shopifyFulfillmentId} IS NOT NULL`,
      ),
    )
    .orderBy(desc(shipmentsTable.createdAt))
    .limit(1);

  if (!shipmentRow?.shopifyFulfillmentId) return;

  try {
    await createShopifyFulfillmentEvent(
      org.shopDomain,
      org.accessToken,
      shipmentRow.shopifyFulfillmentId,
      "delivered",
    );

    const [orderRow] = await db
      .select({ shopifyOrderId: salesOrdersTable.shopifyOrderId })
      .from(salesOrdersTable)
      .where(and(eq(salesOrdersTable.id, salesOrderId), eq(salesOrdersTable.organizationId, orgId)))
      .limit(1);

    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "success",
      shopifyId: orderRow?.shopifyOrderId ?? null,
      erpId: String(salesOrderId),
      name: "delivered",
    });

    logger.info({ orgId, salesOrderId }, "Shopify delivery event pushed");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const [orderRow] = await db
      .select({ shopifyOrderId: salesOrdersTable.shopifyOrderId })
      .from(salesOrdersTable)
      .where(and(eq(salesOrdersTable.id, salesOrderId), eq(salesOrdersTable.organizationId, orgId)))
      .limit(1);
    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "error",
      shopifyId: orderRow?.shopifyOrderId ?? null,
      erpId: String(salesOrderId),
      name: "delivered",
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    throw err;
  }
}

// ─── Fulfillment status push ──────────────────────────────────────────────────

/**
 * Fire-and-forget: push a fulfillment status change (in_progress / on_hold /
 * unfulfilled) to Shopify via the Fulfillment Orders API. The `fulfilled`
 * state is always managed by the normal shipment flow, not this helper.
 */
export function pushFulfillmentStatusToShopify(
  orgId: number,
  salesOrderId: number,
  newStatus: string,
): void {
  pushFulfillmentStatusToShopifyAsync(orgId, salesOrderId, newStatus).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, salesOrderId, newStatus },
      "Shopify outbound fulfillment status push failed",
    );
  });
}

async function pushFulfillmentStatusToShopifyAsync(
  orgId: number,
  salesOrderId: number,
  newStatus: string,
): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const [order] = await db
    .select({ shopifyOrderId: salesOrdersTable.shopifyOrderId })
    .from(salesOrdersTable)
    .where(
      and(
        eq(salesOrdersTable.id, salesOrderId),
        eq(salesOrdersTable.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!order?.shopifyOrderId) return;

  const fulfillmentOrders = await fetchFulfillmentOrders(
    org.shopDomain,
    org.accessToken,
    order.shopifyOrderId,
  );

  if (fulfillmentOrders.length === 0) return;

  try {
    if (newStatus === "on_hold") {
      // Place a hold on every fulfillment order that isn't already on_hold or fulfilled.
      const holdable = fulfillmentOrders.filter(
        (fo) => !["on_hold", "success", "cancelled", "incomplete"].includes(fo.status),
      );
      for (const fo of holdable) {
        await holdFulfillmentOrder(org.shopDomain, org.accessToken, fo.id);
      }
    } else {
      // "in_progress" or "unfulfilled" — release any existing holds / scheduled states.
      const releasable = fulfillmentOrders.filter(
        (fo) => ["on_hold", "scheduled", "open"].includes(fo.status),
      );
      for (const fo of releasable) {
        await openFulfillmentOrder(org.shopDomain, org.accessToken, fo.id);
      }
    }

    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "success",
      shopifyId: order.shopifyOrderId,
      erpId: String(salesOrderId),
      name: `fulfillment_status:${newStatus}`,
    });

    logger.info({ orgId, salesOrderId, newStatus }, "Shopify fulfillment status synced");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(shopifySyncLogsTable).values({
      organizationId: orgId,
      direction: "outbound",
      entity: "order",
      action: "update",
      status: "error",
      shopifyId: order.shopifyOrderId,
      erpId: String(salesOrderId),
      name: `fulfillment_status:${newStatus}`,
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    throw err;
  }
}

// ─── Refund push ──────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: push an ERP-side refund to Shopify as a manual transaction.
 * No-op when:
 *   - the org isn't connected to Shopify, OR
 *   - the order has no shopifyOrderId (not a Shopify order).
 *
 * Uses a transaction-only refund (no line items) because the ERP does not
 * store Shopify line-item IDs. This is enough to update Shopify's
 * financial_status to partially_refunded / refunded.
 */
export function pushRefundToShopify(
  orgId: number,
  salesOrderId: number,
  refundId: number,
  amountRupees: number,
  reason: string | null,
): void {
  pushRefundToShopifyAsync(orgId, salesOrderId, refundId, amountRupees, reason).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), orgId, salesOrderId, refundId },
      "Shopify outbound refund push failed",
    );
  });
}

async function pushRefundToShopifyAsync(
  orgId: number,
  salesOrderId: number,
  refundId: number,
  amountRupees: number,
  reason: string | null,
): Promise<void> {
  const org = await fetchOrgCreds(orgId);
  if (!org) return;

  const [orderRow] = await db
    .select({ shopifyOrderId: salesOrdersTable.shopifyOrderId })
    .from(salesOrdersTable)
    .where(and(eq(salesOrdersTable.id, salesOrderId), eq(salesOrdersTable.organizationId, orgId)))
    .limit(1);
  if (!orderRow?.shopifyOrderId) return;

  try {
    await createShopifyRefund(org.shopDomain, org.accessToken, orderRow.shopifyOrderId, {
      amountRupees,
      note: reason ?? "",
    });
    writeSyncLog(orgId, {
      entity: "refund",
      action: "create",
      status: "success",
      shopifyId: orderRow.shopifyOrderId,
      erpId: String(refundId),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    writeSyncLog(orgId, {
      entity: "refund",
      action: "create",
      status: "error",
      shopifyId: orderRow.shopifyOrderId,
      erpId: String(refundId),
      errorMessage,
      failureReason: classifyError(errorMessage),
    });
    throw err;
  }
}

// ─── Retry failed product syncs ───────────────────────────────────────────────

/**
 * Re-trigger createProductInShopify for every ERP item in this org that has a
 * failed or skipped (non-bundle) product sync log entry and is still unmapped
 * (no shopifyProductId). Called by POST /shopify/sync-logs/retry-failed.
 *
 * Returns the count of items queued.
 */
export async function retryFailedProductSyncs(orgId: number): Promise<number> {
  // Find item IDs with failed/skipped-non-bundle product sync logs
  const failedLogs = await db
    .select({ erpId: shopifySyncLogsTable.erpId })
    .from(shopifySyncLogsTable)
    .where(
      and(
        eq(shopifySyncLogsTable.organizationId, orgId),
        eq(shopifySyncLogsTable.entity, "product"),
        sql`${shopifySyncLogsTable.status} IN ('error', 'skipped')`,
        sql`${shopifySyncLogsTable.failureReason} NOT IN ('skipped_bundle', 'skipped_mapped', 'skipped_no_connection')`,
      ),
    ); // org-scope-allow: retry query scoped to orgId in WHERE

  const itemIds = [
    ...new Set(
      failedLogs
        .map((r) => (r.erpId ? Number(r.erpId) : null))
        .filter((id): id is number => id !== null && !isNaN(id)),
    ),
  ];
  if (itemIds.length === 0) return 0;

  // Only retry items that are still unmapped
  const unmapped = await db
    .select({ id: itemsTable.id })
    .from(itemsTable)
    .where(
      and(
        eq(itemsTable.organizationId, orgId),
        inArray(itemsTable.id, itemIds),
        sql`${itemsTable.shopifyProductId} IS NULL`,
      ),
    );

  for (const { id } of unmapped) {
    createProductInShopify(orgId, id);
  }
  return unmapped.length;
}
