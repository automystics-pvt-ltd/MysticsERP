import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  shopifyOauthStatesTable,
} from "@workspace/db";
import {
  exchangeCodeForToken,
  getPrimaryLocationId,
  getShopifyAppUrl,
  normalizeShopifyDomain,
  registerWebhooks,
  REQUIRED_SCOPES,
  verifyOauthHmac,
} from "../lib/shopify";

const router: IRouter = Router();

/**
 * Public Shopify OAuth callback. MUST live in its own router that is
 * mounted BEFORE clerkMiddleware (and before any router that registers
 * a `router.use(tenantMiddleware)`), because Express runs the inner
 * `use(...)` middleware of an upstream router for every request that
 * reaches it — even ones whose path doesn't match any route in that
 * router. Putting this in shopifyRouter (mounted last) caused
 * tenantMiddleware in earlier routers to short-circuit with 401.
 */
router.get("/shopify/oauth/callback", async (req, res, next) => {
  try {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === "string") query[k] = v;
    }
    const { code, state, shop } = query;
    if (!code || !state || !shop) {
      res.status(400).send("Missing OAuth parameters");
      return;
    }
    const shopDomain = normalizeShopifyDomain(shop);
    if (!shopDomain) {
      res.status(400).send("Invalid shop domain");
      return;
    }

    // Look up the state row first (cryptographically unguessable 48-hex token)
    // so we can retrieve the org's per-org API credentials before HMAC check.
    const stateRows = await db
      .select()
      // org-scope-allow: pre-auth OAuth callback. The state is a one-time
      // CSRF token; we look it up to discover which org initiated the install.
      .from(shopifyOauthStatesTable)
      .where(eq(shopifyOauthStatesTable.state, state))
      .limit(1);
    const stateRow = stateRows[0];
    if (!stateRow) {
      req.log?.warn({ state, shopDomain, knownStates: (await db.select({ s: shopifyOauthStatesTable.state, d: shopifyOauthStatesTable.shopDomain }).from(shopifyOauthStatesTable).limit(10)) }, "OAuth state not found in DB"); // org-scope-allow: debug logging all states for OAuth failure diagnosis
      res.status(400).send(`Invalid OAuth state: state token not found. shopDomain=${shopDomain}`);
      return;
    }
    if (stateRow.shopDomain !== shopDomain) {
      req.log?.warn({ state, shopDomain, storedShopDomain: stateRow.shopDomain }, "OAuth state shop domain mismatch");
      res.status(400).send(`Invalid OAuth state: shop domain mismatch (got ${shopDomain}, expected ${stateRow.shopDomain})`);
      return;
    }

    // Load per-org Shopify credentials (saved by /shopify/oauth/install).
    const orgRows = await db
      .select({
        shopifyApiKey: organizationsTable.shopifyApiKey,
        shopifyApiSecret: organizationsTable.shopifyApiSecret,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, stateRow.organizationId))
      .limit(1);
    const orgCreds = orgRows[0];
    const orgApiKey = orgCreds?.shopifyApiKey ?? undefined;
    const orgApiSecret = orgCreds?.shopifyApiSecret ?? undefined;

    // Verify HMAC using the org's own API secret (falls back to global env var
    // for legacy connections that pre-date per-org credentials).
    if (!verifyOauthHmac(query, orgApiSecret)) {
      res.status(400).send("Invalid OAuth HMAC");
      return;
    }

    await db
      // org-scope-allow: deletes the just-loaded one-time CSRF token row.
      .delete(shopifyOauthStatesTable)
      .where(eq(shopifyOauthStatesTable.id, stateRow.id));

    const token = await exchangeCodeForToken(shopDomain, code, orgApiKey, orgApiSecret);

    // Log granted scopes and warn on missing ones, but allow connection to proceed.
    const granted = new Set(
      (token.scope ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const missing = REQUIRED_SCOPES.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      req.log?.warn(
        { granted: [...granted], missing, raw: token.scope },
        "Shopify granted fewer scopes than requested — proceeding anyway",
      );
    }

    const locationId = await getPrimaryLocationId(
      shopDomain,
      token.access_token,
    );

    await db
      .update(organizationsTable)
      .set({
        shopifyShopDomain: shopDomain,
        shopifyAccessToken: token.access_token,
        shopifyScopes: token.scope,
        shopifyLocationId: locationId,
      })
      .where(eq(organizationsTable.id, stateRow.organizationId));

    try {
      await registerWebhooks(shopDomain, token.access_token);
      await db
        .update(organizationsTable)
        .set({ shopifyWebhookRegisteredAt: new Date() })
        .where(eq(organizationsTable.id, stateRow.organizationId));
    } catch (err) {
      req.log?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to register Shopify webhooks (will retry on next sync)",
      );
    }

    res.redirect(`${getShopifyAppUrl()}/integrations/shopify?connected=1`);
  } catch (err) {
    next(err);
  }
});

export default router;
