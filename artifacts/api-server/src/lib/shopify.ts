import crypto from "node:crypto";

const SHOPIFY_API_VERSION = "2024-04";
const SHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/i;

const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_orders",
  "write_orders",
  "read_customers",
  "read_locations",
];

export function parseShopifyScopes(stored: string | null | undefined): Set<string> {
  if (!stored) return new Set();
  return new Set(
    stored
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function findMissingShopifyScopes(
  stored: string | null | undefined,
  required: readonly string[] = REQUIRED_SCOPES,
): string[] {
  const have = parseShopifyScopes(stored);
  return required.filter((s) => !have.has(s));
}

const WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/fulfilled",
  "orders/cancelled",
  "refunds/create",
  "fulfillments/create",
  "fulfillments/update",
  "fulfillments/cancel",
  "fulfillment_orders/placed_on_hold",
  "fulfillment_orders/hold_released",
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
  "customers/create",
  "customers/update",
  "app/uninstalled",
];

export function getShopifyAppUrl(): string {
  const explicit = process.env["SHOPIFY_APP_URL"];
  if (explicit) return explicit.replace(/\/$/, "");
  const replitDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (replitDomain) return `https://${replitDomain}`;
  throw new Error(
    "SHOPIFY_APP_URL is not set and no Replit domain is available",
  );
}

export function getShopifyApiKey(): string {
  const v = process.env["SHOPIFY_API_KEY"];
  if (!v) throw new Error("SHOPIFY_API_KEY is not set");
  return v;
}

export function getShopifyApiSecret(): string {
  const v =
    process.env["SHOPIFY_API_SECRET"] ??
    process.env["SHOPIFY_APP_SHARED_SECRET"];
  if (!v)
    throw new Error(
      "SHOPIFY_API_SECRET (or SHOPIFY_APP_SHARED_SECRET) is not set",
    );
  return v;
}

export function normalizeShopifyDomain(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  return SHOPIFY_DOMAIN_RE.test(cleaned) ? cleaned : null;
}

export function buildInstallUrl(
  shopDomain: string,
  state: string,
  apiKeyOverride?: string,
  appUrlOverride?: string,
): string {
  const clientId = apiKeyOverride ?? getShopifyApiKey();
  const appUrl = appUrlOverride ?? getShopifyAppUrl();
  const params = new URLSearchParams({
    client_id: clientId,
    scope: REQUIRED_SCOPES.join(","),
    redirect_uri: `${appUrl}/api/shopify/oauth/callback`,
    state,
    "grant_options[]": "",
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Verify the HMAC parameter Shopify attaches to OAuth callback URLs.
 * Per docs, sort all query params except `hmac` (and `signature`),
 * concatenate as `key=value&key=value`, then HMAC-SHA256 with the
 * app secret and compare to the `hmac` value.
 */
export function verifyOauthHmac(
  query: Record<string, string>,
  apiSecretOverride?: string,
): boolean {
  const { hmac, signature: _ignored, ...rest } = query;
  if (!hmac) return false;
  let secret: string;
  try {
    secret = apiSecretOverride ?? getShopifyApiSecret();
  } catch {
    return false;
  }
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  return safeEqualHex(digest, hmac);
}

/**
 * Verify the HMAC header Shopify attaches to webhook deliveries.
 * Header is base64 of HMAC-SHA256 over the raw request body.
 * Uses the global SHOPIFY_API_SECRET env var.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headerSignature: string | undefined,
): boolean {
  if (!headerSignature) return false;
  let secret: string;
  try {
    secret = getShopifyApiSecret();
  } catch {
    return false;
  }
  return verifyWebhookSignatureWithKey(rawBody, headerSignature, secret);
}

/**
 * Verify a webhook HMAC using an explicit secret key.
 * Use this for per-org verification when org.shopifyApiSecret is set.
 */
export function verifyWebhookSignatureWithKey(
  rawBody: string | Buffer,
  headerSignature: string | undefined,
  secret: string,
): boolean {
  if (!headerSignature || !secret) return false;
  const bodyBuf =
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(bodyBuf)
    .digest("base64");
  return safeEqualB64(digest, headerSignature);
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function safeEqualB64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export interface TokenExchangeResult {
  access_token: string;
  scope: string;
}

export async function exchangeCodeForToken(
  shopDomain: string,
  code: string,
  apiKeyOverride?: string,
  apiSecretOverride?: string,
): Promise<TokenExchangeResult> {
  const clientId = apiKeyOverride ?? getShopifyApiKey();
  const clientSecret = apiSecretOverride ?? getShopifyApiSecret();
  const res = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Shopify token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as TokenExchangeResult;
}

async function shopifyGet<T>(
  shopDomain: string,
  accessToken: string,
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}${qs}`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Shopify GET ${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

async function shopifyPost<T>(
  shopDomain: string,
  accessToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Shopify POST ${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

async function shopifyPut<T>(
  shopDomain: string,
  accessToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Shopify PUT ${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

interface LocationsResponse {
  locations: Array<{ id: number; name: string; primary?: boolean }>;
}

export async function getPrimaryLocationId(
  shopDomain: string,
  accessToken: string,
): Promise<string | null> {
  const data = await shopifyGet<LocationsResponse>(
    shopDomain,
    accessToken,
    "/locations.json",
  );
  if (!data.locations || data.locations.length === 0) return null;
  const primary = data.locations.find((l) => l.primary) ?? data.locations[0]!;
  return String(primary.id);
}

export interface ShopifyLocation {
  id: string;
  name: string;
  primary: boolean;
}

/**
 * Fetch all locations for a Shopify shop. Shopify caps /locations.json at
 * 250 per page; very few merchants hit that limit, but we paginate via
 * `page_info` link headers if needed for completeness.
 */
export async function fetchAllShopifyLocations(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyLocation[]> {
  const out: ShopifyLocation[] = [];
  let path: string | null = "/locations.json?limit=250";
  while (path) {
    const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Shopify GET /locations.json failed: ${res.status} ${await res.text()}`,
      );
    }
    const data = (await res.json()) as LocationsResponse;
    for (const l of data.locations ?? []) {
      out.push({ id: String(l.id), name: l.name, primary: !!l.primary });
    }
    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    if (nextMatch) {
      const u = new URL(nextMatch[1]!);
      path = `${u.pathname.replace(/^\/admin\/api\/[^/]+/, "")}${u.search}`;
    } else {
      path = null;
    }
  }
  return out;
}

export async function registerWebhooks(
  shopDomain: string,
  accessToken: string,
  appUrlOverride?: string,
): Promise<void> {
  const callbackBase = `${appUrlOverride ?? getShopifyAppUrl()}/api/webhooks/shopify`;
  // Delete any pre-existing subscriptions for this app first to avoid
  // duplicates (best-effort; we ignore errors).
  try {
    const existing = await shopifyGet<{
      webhooks: Array<{ id: number; topic: string }>;
    }>(shopDomain, accessToken, "/webhooks.json");
    for (const w of existing.webhooks ?? []) {
      try {
        await fetch(
          `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/webhooks/${w.id}.json`,
          {
            method: "DELETE",
            headers: { "X-Shopify-Access-Token": accessToken },
          },
        );
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  for (const topic of WEBHOOK_TOPICS) {
    await shopifyPost(shopDomain, accessToken, "/webhooks.json", {
      webhook: {
        topic,
        address: callbackBase,
        format: "json",
      },
    });
  }
}

export interface ShopifyVariantFull {
  id: number;
  product_id: number;
  sku: string | null;
  price: string;
  inventory_quantity: number | null;
  inventory_item_id: number | null;
  title: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  barcode?: string | null;
}

export interface ShopifyProductOption {
  name: string;
  values?: string[];
}

export interface ShopifyProductFull {
  id: number;
  title: string;
  body_html: string | null;
  product_type: string | null;
  status?: string | null;
  variants: ShopifyVariantFull[];
  options: ShopifyProductOption[];
  image: { src: string } | null;
}

export async function fetchShopifyProducts(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyProductFull[]> {
  const data = await shopifyGet<{ products: ShopifyProductFull[] }>(
    shopDomain,
    accessToken,
    "/products.json",
    { limit: "250" },
  );
  return data.products ?? [];
}

/**
 * Fetch a single Shopify product by its numeric id.
 * More efficient than fetchShopifyProducts for webhook handlers that
 * only need one product.
 */
export async function fetchShopifyProduct(
  shopDomain: string,
  accessToken: string,
  productId: string,
): Promise<ShopifyProductFull | null> {
  try {
    const data = await shopifyGet<{ product: ShopifyProductFull }>(
      shopDomain,
      accessToken,
      `/products/${productId}.json`,
    );
    return data.product ?? null;
  } catch {
    return null;
  }
}

export interface UpdateShopifyProductFields {
  title?: string;
  category?: string | null;
  status?: "active" | "draft";
  variantId: string;
  price?: string;
  sku?: string;
  barcode?: string | null;
}

/**
 * Push inventory-side product/variant fields back to Shopify.
 * Only the fields explicitly present in `fields` are sent so callers
 * can do partial updates without clobbering unrelated Shopify data.
 */
export interface CreateShopifyProductResult {
  productId: string;
  variantId: string;
  inventoryItemId: string;
}

/**
 * Create a new Shopify product from a local inventory item.
 * Sets inventory_management to "shopify" so Shopify tracks stock.
 * Returns the stable IDs we persist back to the item row.
 */
export async function createShopifyProduct(
  shopDomain: string,
  accessToken: string,
  fields: {
    title: string;
    sku: string;
    price: string;
    barcode?: string | null;
    category?: string | null;
  },
): Promise<CreateShopifyProductResult> {
  const variant: Record<string, unknown> = {
    price: fields.price,
    sku: fields.sku,
    inventory_management: "shopify",
  };
  if (fields.barcode) variant["barcode"] = fields.barcode;

  const product: Record<string, unknown> = {
    title: fields.title,
    status: "active",
    variants: [variant],
  };
  if (fields.category) product["product_type"] = fields.category;

  const data = await shopifyPost<{ product: ShopifyProductFull }>(
    shopDomain,
    accessToken,
    "/products.json",
    { product },
  );
  const created = data.product;
  const v = created.variants[0];
  if (!v) throw new Error("Shopify returned product with no variants");
  return {
    productId: String(created.id),
    variantId: String(v.id),
    inventoryItemId: String(v.inventory_item_id ?? ""),
  };
}

export async function updateShopifyProduct(
  shopDomain: string,
  accessToken: string,
  productId: string,
  fields: UpdateShopifyProductFields,
): Promise<void> {
  // Variant-level fields (price, sku, barcode) MUST go to the variant endpoint.
  // Sending variants:[{id}] in a PUT /products/{id}.json call replaces the
  // *entire* variant list — all other variants get deleted by Shopify.
  const variantPatch: Record<string, unknown> = {};
  if (fields.price !== undefined) variantPatch["price"] = fields.price;
  if (fields.sku !== undefined) variantPatch["sku"] = fields.sku;
  if (fields.barcode !== undefined) variantPatch["barcode"] = fields.barcode ?? "";

  const hasVariantChanges = Object.keys(variantPatch).length > 0;
  const hasProductChanges =
    fields.title !== undefined ||
    fields.category !== undefined ||
    fields.status !== undefined;

  const calls: Promise<unknown>[] = [];

  if (hasVariantChanges) {
    // Safe: only touches this one variant, leaves all others intact.
    calls.push(
      shopifyPut(
        shopDomain,
        accessToken,
        `/products/${productId}/variants/${fields.variantId}.json`,
        { variant: variantPatch },
      ),
    );
  }

  if (hasProductChanges) {
    // Product-level fields only — no `variants` key so Shopify won't touch them.
    const productPatch: Record<string, unknown> = { id: Number(productId) };
    if (fields.title !== undefined) productPatch["title"] = fields.title;
    if (fields.category !== undefined) productPatch["product_type"] = fields.category ?? "";
    if (fields.status !== undefined) productPatch["status"] = fields.status;

    calls.push(
      shopifyPut(shopDomain, accessToken, `/products/${productId}.json`, {
        product: productPatch,
      }),
    );
  }

  await Promise.all(calls);
}

export interface CreateShopifyVariantResult {
  variantId: string;
  inventoryItemId: string;
}

/**
 * Create a Shopify product that already carries multiple variants.
 * Used when syncing a hasVariants=true ERP parent item to Shopify for the
 * first time. Returns the new productId plus per-SKU variant + inventory IDs.
 */
export async function createShopifyProductWithVariants(
  shopDomain: string,
  accessToken: string,
  fields: {
    title: string;
    category?: string | null;
    options: string[];
    variants: Array<{
      sku: string;
      price: string;
      barcode?: string | null;
      option1?: string | null;
      option2?: string | null;
      option3?: string | null;
    }>;
  },
): Promise<{
  productId: string;
  variants: Array<{ sku: string; variantId: string; inventoryItemId: string }>;
}> {
  const shopifyVariants = fields.variants.map((v) => {
    const variant: Record<string, unknown> = {
      sku: v.sku,
      price: v.price,
      inventory_management: "shopify",
    };
    if (v.barcode) variant["barcode"] = v.barcode;
    if (v.option1 != null) variant["option1"] = v.option1;
    if (v.option2 != null) variant["option2"] = v.option2;
    if (v.option3 != null) variant["option3"] = v.option3;
    return variant;
  });

  const product: Record<string, unknown> = {
    title: fields.title,
    status: "active",
    options: fields.options.map((name) => ({ name })),
    variants: shopifyVariants,
  };
  if (fields.category) product["product_type"] = fields.category;

  const data = await shopifyPost<{ product: ShopifyProductFull }>(
    shopDomain,
    accessToken,
    "/products.json",
    { product },
  );
  const created = data.product;

  const resultVariants = fields.variants.map((v) => {
    const matched = created.variants.find((sv) => sv.sku === v.sku);
    if (!matched) throw new Error(`Shopify returned no variant for SKU ${v.sku}`);
    return {
      sku: v.sku,
      variantId: String(matched.id),
      inventoryItemId: String(matched.inventory_item_id ?? ""),
    };
  });

  return { productId: String(created.id), variants: resultVariants };
}

/**
 * Add a single new variant to an existing Shopify product.
 * Used when a new ERP variant child is created under a parent that is already
 * mapped to a Shopify product.
 */
export async function addVariantToShopifyProduct(
  shopDomain: string,
  accessToken: string,
  productId: string,
  variant: {
    sku: string;
    price: string;
    barcode?: string | null;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
  },
): Promise<CreateShopifyVariantResult> {
  const body: Record<string, unknown> = {
    sku: variant.sku,
    price: variant.price,
    inventory_management: "shopify",
  };
  if (variant.barcode) body["barcode"] = variant.barcode;
  if (variant.option1 != null) body["option1"] = variant.option1;
  if (variant.option2 != null) body["option2"] = variant.option2;
  if (variant.option3 != null) body["option3"] = variant.option3;

  const data = await shopifyPost<{ variant: ShopifyVariantFull }>(
    shopDomain,
    accessToken,
    `/products/${productId}/variants.json`,
    { variant: body },
  );
  const v = data.variant;
  return {
    variantId: String(v.id),
    inventoryItemId: String(v.inventory_item_id ?? ""),
  };
}

/** A single Shopify tax-line component (CGST, SGST, IGST, etc.). */
export interface ShopifyTaxLine {
  title: string;
  rate: number;
  price: string;
  channel_liable?: boolean;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  currency: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  /** Order-level tax breakdown from Shopify (CGST, SGST, IGST, etc.). */
  tax_lines?: ShopifyTaxLine[];
  /** Whether any tax is included in the item prices. */
  taxes_included?: boolean;
  customer: {
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  location_id?: number | null;
  line_items: Array<{
    id: number;
    variant_id?: number | null;
    variant_title?: string | null;
    sku: string | null;
    title: string;
    quantity: number;
    price: string;
    origin_location?: { id: number } | null;
    tax_lines: Array<{ title?: string; rate: number; price: string }>;
  }>;
  fulfillments?: Array<{
    id: number;
    status?: string | null;
    /** Carrier delivery status: "confirmed", "in_transit", "out_for_delivery", "delivered", "failure" */
    shipment_status?: string | null;
    location_id?: number | null;
    tracking_number?: string | null;
    tracking_numbers?: string[];
    tracking_company?: string | null;
    tracking_url?: string | null;
    tracking_urls?: string[];
    line_items?: Array<{
      variant_id?: number | null;
      quantity: number;
      origin_location?: { id: number } | null;
    }>;
  }>;
  /** Shopify shipping lines (rate/carrier titles). */
  shipping_lines?: Array<{ title: string; price: string }>;
}

export interface ShopifyRefund {
  id: number;
  order_id: number;
  created_at: string;
  refund_line_items: Array<{
    id: number;
    quantity: number;
    line_item_id: number;
    restock_type: string | null;
  }>;
}

export async function fetchShopifyOrders(
  shopDomain: string,
  accessToken: string,
  sinceId?: string | null,
): Promise<ShopifyOrder[]> {
  const params: Record<string, string> = { status: "any", limit: "100" };
  if (sinceId) params["since_id"] = sinceId;
  const data = await shopifyGet<{ orders: ShopifyOrder[] }>(
    shopDomain,
    accessToken,
    "/orders.json",
    params,
  );
  return data.orders ?? [];
}

export interface FetchOrdersPageOpts {
  /** ISO timestamp (inclusive lower bound on created_at). */
  createdAtMin?: string;
  /** ISO timestamp (inclusive upper bound on created_at). */
  createdAtMax?: string;
  /** Restrict to specific Shopify order ids (max 250 per call). */
  ids?: string[];
  /** Comma-separated field whitelist to trim the payload (reconcile path). */
  fields?: string;
  /** Page size (Shopify caps at 250). */
  limit?: number;
  /**
   * Opaque cursor from a previous page's `nextPageInfo`. When set,
   * Shopify ignores every other filter and only honours `limit`.
   */
  pageInfo?: string | null;
}

export interface ShopifyOrdersPage {
  orders: ShopifyOrder[];
  nextPageInfo: string | null;
}

/**
 * Fetch one page of orders using Shopify's cursor-based pagination.
 * The `link` response header carries the `rel="next"` cursor which we
 * surface as `nextPageInfo`; callers loop until it comes back null.
 *
 * Per Shopify's rules a cursored request (`page_info`) may only be
 * combined with `limit`, so filters (`created_at_*`, `ids`, `fields`)
 * are only sent on the first page.
 */
export async function fetchShopifyOrdersPage(
  shopDomain: string,
  accessToken: string,
  opts: FetchOrdersPageOpts = {},
): Promise<ShopifyOrdersPage> {
  const limit = opts.limit ?? 250;
  const params = new URLSearchParams();
  if (opts.pageInfo) {
    params.set("limit", String(limit));
    params.set("page_info", opts.pageInfo);
  } else {
    params.set("status", "any");
    params.set("limit", String(limit));
    if (opts.createdAtMin) params.set("created_at_min", opts.createdAtMin);
    if (opts.createdAtMax) params.set("created_at_max", opts.createdAtMax);
    if (opts.ids && opts.ids.length > 0) params.set("ids", opts.ids.join(","));
    if (opts.fields) params.set("fields", opts.fields);
  }
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Shopify GET /orders.json failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { orders: ShopifyOrder[] };
  const link = res.headers.get("link") ?? "";
  const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
  let nextPageInfo: string | null = null;
  if (nextMatch) {
    try {
      nextPageInfo = new URL(nextMatch[1]!).searchParams.get("page_info");
    } catch {
      nextPageInfo = null;
    }
  }
  return { orders: data.orders ?? [], nextPageInfo };
}

/**
 * Count orders in a created_at range (cheap — one call, no pagination).
 * Used to seed the import job's `total` so the UI can show "X of Y".
 */
export async function fetchShopifyOrdersCount(
  shopDomain: string,
  accessToken: string,
  opts: { createdAtMin?: string; createdAtMax?: string } = {},
): Promise<number> {
  const params: Record<string, string> = { status: "any" };
  if (opts.createdAtMin) params["created_at_min"] = opts.createdAtMin;
  if (opts.createdAtMax) params["created_at_max"] = opts.createdAtMax;
  const data = await shopifyGet<{ count: number }>(
    shopDomain,
    accessToken,
    "/orders/count.json",
    params,
  );
  return data.count ?? 0;
}

/**
 * Set absolute inventory level for a variant at the org's location.
 * Used by outbound stock sync.
 */
export async function setInventoryLevel(
  shopDomain: string,
  accessToken: string,
  inventoryItemId: string,
  locationId: string,
  available: number,
): Promise<void> {
  await shopifyPost(shopDomain, accessToken, "/inventory_levels/set.json", {
    location_id: Number(locationId),
    inventory_item_id: Number(inventoryItemId),
    available,
  });
}

/**
 * Map Shopify's fulfillment_status to a human-readable label stored verbatim
 * in shopifyFulfillmentStatus. We keep the raw Shopify value so the UI can
 * render it with Shopify-style labels without any lossy mapping.
 * Returns null for non-Shopify orders or when no value is provided.
 */
export function mapShopifyFulfillmentStatus(
  fulfillmentStatus: string | null | undefined,
): string | null {
  return fulfillmentStatus ?? null;
}

/**
 * Map a Shopify financial_status value to our internal paymentStatus.
 * Returns null when the order has no meaningful payment status yet.
 */
export function mapShopifyPaymentStatus(
  financialStatus: string | null | undefined,
): string | null {
  switch (financialStatus) {
    case "paid":
      return "paid";
    case "partially_paid":
    case "partially_refunded":
      return "partially_paid";
    case "refunded":
      return "refunded";
    case "voided":
      return "void";
    case "pending":
    case "authorized":
      return "pending";
    default:
      return financialStatus ? "pending" : null;
  }
}

export type CreateFulfillmentResult =
  | { ok: true; shopifyFulfillmentId: string }
  | { ok: false; reason: "already_fulfilled" | "api_error"; message?: string };

/**
 * Create a fulfillment on a Shopify order using the legacy REST endpoint.
 * Fulfills all remaining unfulfilled line items. Requires write_orders scope.
 * Returns the created Shopify fulfillment ID on success.
 * Returns ok=false with reason="already_fulfilled" when Shopify returns 422
 * (order already fully fulfilled), so callers can log a skip instead of error.
 */
export async function createShopifyFulfillment(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  locationId: string | null,
  tracking?: {
    number?: string | null;
    company?: string | null;
    url?: string | null;
  },
): Promise<CreateFulfillmentResult> {
  const payload: Record<string, unknown> = {
    notify_customer: false,
  };
  if (locationId) {
    payload["location_id"] = Number(locationId);
  }
  if (tracking?.number) payload["tracking_number"] = tracking.number;
  if (tracking?.company) payload["tracking_company"] = tracking.company;
  if (tracking?.url) payload["tracking_url"] = tracking.url;

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/fulfillments.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fulfillment: payload }),
  });

  if (res.status === 422) {
    return { ok: false, reason: "already_fulfilled" };
  }
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, reason: "api_error", message: `${res.status} ${text}` };
  }
  const data = (await res.json()) as { fulfillment?: { id?: number | string } };
  const id = data.fulfillment?.id;
  if (!id) {
    return { ok: false, reason: "api_error", message: "No fulfillment ID in Shopify response" };
  }
  return { ok: true, shopifyFulfillmentId: String(id) };
}

/**
 * Cancel a fulfillment on Shopify using the legacy REST endpoint.
 * No-op (swallowed) when the fulfillment is already cancelled.
 */
export async function cancelShopifyFulfillment(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  shopifyFulfillmentId: string,
): Promise<void> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/fulfillments/${shopifyFulfillmentId}/cancel.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  // 422 = already cancelled or unprocessable; treat as success
  if (!res.ok && res.status !== 422) {
    throw new Error(
      `Shopify POST /orders/${shopifyOrderId}/fulfillments/${shopifyFulfillmentId}/cancel failed: ${res.status} ${await res.text()}`,
    );
  }
}

/**
 * Update carrier tracking on an existing Shopify fulfillment.
 * Uses the legacy REST PUT endpoint (2023-01).
 */
export async function updateShopifyFulfillmentTracking(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  shopifyFulfillmentId: string,
  tracking: {
    number?: string | null;
    company?: string | null;
    url?: string | null;
  },
): Promise<void> {
  const payload: Record<string, unknown> = { id: Number(shopifyFulfillmentId) };
  if (tracking.number != null) payload["tracking_number"] = tracking.number;
  if (tracking.company != null) payload["tracking_company"] = tracking.company;
  if (tracking.url != null) payload["tracking_url"] = tracking.url;
  await shopifyPut(
    shopDomain,
    accessToken,
    `/orders/${shopifyOrderId}/fulfillments/${shopifyFulfillmentId}.json`,
    { fulfillment: payload },
  );
}

export interface ShopifyCustomerAddress {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  company?: string | null;
  phone?: string | null;
}

export interface ShopifyCustomer {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  default_address?: ShopifyCustomerAddress | null;
}

export interface UpsertShopifyCustomerFields {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  note?: string | null;
}

export async function createShopifyCustomer(
  shopDomain: string,
  accessToken: string,
  fields: UpsertShopifyCustomerFields,
): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (fields.firstName) payload["first_name"] = fields.firstName;
  if (fields.lastName) payload["last_name"] = fields.lastName;
  if (fields.email) payload["email"] = fields.email;
  if (fields.phone) payload["phone"] = fields.phone;
  if (fields.note) payload["note"] = fields.note;
  if (fields.company) {
    payload["default_address"] = { company: fields.company };
  }
  const data = await shopifyPost<{ customer: ShopifyCustomer }>(
    shopDomain,
    accessToken,
    "/customers.json",
    { customer: payload },
  );
  return String(data.customer.id);
}

export async function updateShopifyCustomer(
  shopDomain: string,
  accessToken: string,
  shopifyCustomerId: string,
  fields: UpsertShopifyCustomerFields,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.firstName !== undefined) payload["first_name"] = fields.firstName;
  if (fields.lastName !== undefined) payload["last_name"] = fields.lastName;
  if (fields.email !== undefined) payload["email"] = fields.email;
  if (fields.phone !== undefined) payload["phone"] = fields.phone;
  if (fields.note !== undefined) payload["note"] = fields.note;
  if (fields.company !== undefined) {
    payload["default_address"] = { company: fields.company };
  }
  await shopifyPut(
    shopDomain,
    accessToken,
    `/customers/${shopifyCustomerId}.json`,
    { customer: payload },
  );
}

/**
 * Push ERP payment status to a Shopify order using note_attributes.
 * GETs the current attributes first so merchant-set attributes aren't lost.
 * erp_* attributes are owned by ERP and will be replaced; all others kept.
 */
export async function updateShopifyOrderPaymentStatus(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  erpPaymentStatus: string,
): Promise<void> {
  // GET existing note_attributes to avoid clobbering merchant-set ones
  let existingAttrs: Array<{ name: string; value: string }> = [];
  try {
    const data = await shopifyGet<{
      order?: { note_attributes?: Array<{ name: string; value: string }> };
    }>(shopDomain, accessToken, `/orders/${shopifyOrderId}.json`, {
      fields: "id,note_attributes",
    });
    existingAttrs = (data.order?.note_attributes ?? []).filter(
      (a) => !a.name.startsWith("erp_"),
    );
  } catch {
    // If GET fails just proceed with empty — don't let it block the update
  }

  const mergedAttrs = [
    ...existingAttrs,
    { name: "erp_payment_status", value: erpPaymentStatus },
    { name: "erp_synced_at", value: new Date().toISOString() },
  ];

  await shopifyPut(shopDomain, accessToken, `/orders/${shopifyOrderId}.json`, {
    order: { id: Number(shopifyOrderId), note_attributes: mergedAttrs },
  });
}

// ─── Fulfillment Orders API ───────────────────────────────────────────────────

/**
 * Fetch all fulfillment orders for a Shopify order.
 * Returns the subset of fields we need (id + status).
 */
export async function fetchFulfillmentOrders(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
): Promise<Array<{ id: number; status: string }>> {
  const data = await shopifyGet<{
    fulfillment_orders: Array<{ id: number; status: string }>;
  }>(shopDomain, accessToken, `/orders/${shopifyOrderId}/fulfillment_orders.json`);
  return data.fulfillment_orders ?? [];
}

/**
 * Place a hold on a Shopify fulfillment order.
 * The fulfillment_order status becomes "on_hold" and the parent order's
 * fulfillment_status reflects "on_hold".
 */
export async function holdFulfillmentOrder(
  shopDomain: string,
  accessToken: string,
  fulfillmentOrderId: number,
  reasonNotes?: string,
): Promise<void> {
  await shopifyPost(
    shopDomain,
    accessToken,
    `/fulfillment_orders/${fulfillmentOrderId}/hold.json`,
    { fulfillment_hold: { reason: "other", reason_notes: reasonNotes ?? "Held via ERP" } },
  );
}

/**
 * Create a fulfillment event on a Shopify fulfillment — used to mark an
 * order as "delivered" after we receive confirmation that the carrier
 * delivered the package. Status must be one of Shopify's event statuses.
 */
export async function createShopifyFulfillmentEvent(
  shopDomain: string,
  accessToken: string,
  shopifyFulfillmentId: string,
  status: "delivered" | "in_transit" | "out_for_delivery" | "ready_for_pickup",
): Promise<void> {
  await shopifyPost(
    shopDomain,
    accessToken,
    `/fulfillments/${shopifyFulfillmentId}/events.json`,
    { event: { status } },
  );
}

/**
 * Release a hold (or move from scheduled → open) on a Shopify fulfillment order.
 * Moves status back to "open" / "in_progress" on Shopify.
 */
export async function openFulfillmentOrder(
  shopDomain: string,
  accessToken: string,
  fulfillmentOrderId: number,
): Promise<void> {
  await shopifyPost(
    shopDomain,
    accessToken,
    `/fulfillment_orders/${fulfillmentOrderId}/open.json`,
    {},
  );
}

/**
 * Update the `note` field on a Shopify order. Used to sync ERP order notes
 * back to Shopify when the operator edits them in the ERP.
 */
export async function updateShopifyOrderNote(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  note: string | null,
): Promise<void> {
  await shopifyPut(shopDomain, accessToken, `/orders/${shopifyOrderId}.json`, {
    order: { id: Number(shopifyOrderId), note: note ?? "" },
  });
}

/**
 * Create a refund on a Shopify order. Sends a manual transaction for the
 * given amount so Shopify's financial_status is updated to partially_refunded
 * or refunded. No line items are sent because the ERP doesn't store Shopify
 * line-item IDs — the transaction-only form is sufficient to sync the money.
 */
export async function createShopifyRefund(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  opts: {
    amountRupees: number;
    currency?: string;
    note?: string | null;
    notify?: boolean;
  },
): Promise<void> {
  await shopifyPost(shopDomain, accessToken, `/orders/${shopifyOrderId}/refunds.json`, {
    refund: {
      currency: opts.currency ?? "INR",
      notify: opts.notify ?? false,
      note: opts.note ?? "",
      transactions: [
        {
          amount: opts.amountRupees.toFixed(2),
          kind: "refund",
          gateway: "manual",
        },
      ],
    },
  });
}

export { REQUIRED_SCOPES, WEBHOOK_TOPICS };
