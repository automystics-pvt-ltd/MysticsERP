import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, lt, isNotNull, isNull, inArray, sql, count, sum, gte, lte } from "drizzle-orm";
import {
  db,
  organizationsTable,
  itemsTable,
  itemWarehouseStockTable,
  salesOrdersTable,
  shopifyOauthStatesTable,
  shopifySyncLogsTable,
  shopifyProductSyncJobsTable,
  warehousesTable,
  usersTable,
} from "@workspace/db";
import { tenantMiddleware, getDefaultWarehouseId } from "../lib/tenant";
import { getClientIp } from "../lib/audit";
import {
  buildInstallUrl,
  fetchShopifyOrders,
  fetchShopifyOrdersPage,
  fetchShopifyOrdersCount,
  fetchAllShopifyLocations,
  findMissingShopifyScopes,
  normalizeShopifyDomain,
  getPrimaryLocationId,
  registerWebhooks,
  type ShopifyOrder,
} from "../lib/shopify";
import { importShopifyOrder } from "../lib/shopifyOrderImport";
import {
  createImportJob,
  getImportJob,
  incrementImportJob,
  finishImportJob,
} from "../lib/shopifyImportJobs";
import { toNum, toStr } from "../lib/numeric";
import { pushProductFieldsToShopify, pushStockToShopify } from "../lib/shopifyOutbound";
import {
  startProductSync,
  getLatestProductSyncJob,
  getProductSyncJob,
  cancelProductSync,
  pauseProductSync,
  resumeProductSync,
} from "../lib/shopifyProductSync";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const router: IRouter = Router();

// Everything in this router requires the tenant context. The public
// OAuth callback lives in routes/shopifyOauthCallback.ts so it can
// be mounted before clerkMiddleware (and before any other router's
// router.use(tenantMiddleware), which would otherwise short-circuit
// the unauth'd request with 401).
router.use(tenantMiddleware);

router.post("/shopify/oauth/install", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const b = req.body ?? {};
    if (!b.shopDomain || typeof b.shopDomain !== "string") {
      res.status(400).json({ error: "shopDomain is required" });
      return;
    }
    if (!b.apiKey || typeof b.apiKey !== "string") {
      res.status(400).json({ error: "apiKey is required" });
      return;
    }
    if (!b.apiSecret || typeof b.apiSecret !== "string") {
      res.status(400).json({ error: "apiSecret is required" });
      return;
    }
    const shopDomain = normalizeShopifyDomain(b.shopDomain);
    if (!shopDomain) {
      res.status(400).json({
        error: "Shop domain must look like your-store.myshopify.com",
      });
      return;
    }

    // Persist per-org credentials before starting the OAuth flow so the
    // callback can look them up when Shopify redirects back.
    await db
      .update(organizationsTable)
      .set({ shopifyApiKey: b.apiKey, shopifyApiSecret: b.apiSecret })
      .where(eq(organizationsTable.id, t.organizationId));

    // GC any expired states for this org (older than 10 minutes)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await db
      .delete(shopifyOauthStatesTable)
      .where(
        and(
          eq(shopifyOauthStatesTable.organizationId, t.organizationId),
          lt(shopifyOauthStatesTable.createdAt, tenMinAgo),
        ),
      );

    // Derive the app's public URL from the incoming request so neither
    // SHOPIFY_APP_URL nor REPLIT_DEV_DOMAIN env vars are required.
    const appUrl = `${req.protocol}://${req.get("host")}`;

    const state = crypto.randomBytes(24).toString("hex");
    await db.insert(shopifyOauthStatesTable).values({
      organizationId: t.organizationId,
      state,
      shopDomain,
      appUrl,
    });

    const installUrl = buildInstallUrl(shopDomain, state, b.apiKey, appUrl);
    res.json({ installUrl });
  } catch (err) {
    next(err);
  }
});

// ─── DEV MOCK (SHOPIFY_DEV_MOCK=true) ───────────────────────────────────────
// Set SHOPIFY_DEV_MOCK=true in your .env to test the full Shopify UI without
// a real store. All routes below are intercepted with realistic fake data.
// This block is completely inert in production (env var is never set there).
if (process.env.SHOPIFY_DEV_MOCK === "true" && process.env.NODE_ENV !== "test") {
  const MOCK_JOB_ID = "dev-mock-job-001";
  const mockJob = (overrides: Record<string, unknown> = {}) => ({
    id: MOCK_JOB_ID,
    organizationId: 0,
    status: "completed",
    totalShopify: 142,
    totalErp: 138,
    processed: 142,
    created: 87,
    updated: 47,
    skipped: 5,
    failed: 3,
    missing: 2,
    cancelSignal: false,
    pauseSignal: false,
    error: null,
    startedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    finishedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    triggeredByName: "Rahul Sharma",
    triggeredByEmail: "rahul@devmock.com",
    triggeredByIp: "49.36.103.42",
    triggeredByLocation: "Mumbai, Maharashtra, India",
    ...overrides,
  });
  const mockJobs = () => [
    mockJob({ id: "dev-mock-job-001", startedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), finishedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() }),
    mockJob({ id: "dev-mock-job-002", status: "completed_with_errors", created: 50, updated: 30, failed: 8, skipped: 12, startedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), finishedAt: new Date(Date.now() - 26 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString(), triggeredByName: "Priya Mehta", triggeredByEmail: "priya@devmock.com", triggeredByIp: "103.21.58.220", triggeredByLocation: "Bangalore, Karnataka, India" }),
    mockJob({ id: "dev-mock-job-003", status: "completed", created: 130, updated: 10, failed: 0, skipped: 2, startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), finishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 8 * 60 * 1000).toISOString(), triggeredByName: "Rahul Sharma", triggeredByEmail: "rahul@devmock.com", triggeredByIp: "49.36.103.42", triggeredByLocation: "Mumbai, Maharashtra, India" }),
  ];
  const mockItems = () => {
    const now = Date.now();
    return [
      { id: "mi-1", shopifyProductId: "gid://shopify/Product/100", sku: "TSHIRT-BLU-M", title: "Blue Cotton T-Shirt (M)", status: "synced", errorMessage: null, createdAt: new Date(now - 5 * 60 * 1000).toISOString() },
      { id: "mi-2", shopifyProductId: "gid://shopify/Product/101", sku: "KURTA-RED-L",  title: "Red Handloom Kurta (L)",  status: "synced", errorMessage: null, createdAt: new Date(now - 5 * 60 * 1000).toISOString() },
      { id: "mi-3", shopifyProductId: "gid://shopify/Product/102", sku: "SAREE-GRN-01", title: "Green Silk Saree",        status: "error",  errorMessage: "SKU not found in inventory", createdAt: new Date(now - 4 * 60 * 1000).toISOString() },
      { id: "mi-4", shopifyProductId: "gid://shopify/Product/103", sku: null,           title: "Cotton Dupatta",           status: "skipped", errorMessage: null, createdAt: new Date(now - 3 * 60 * 1000).toISOString() },
      { id: "mi-5", shopifyProductId: "gid://shopify/Product/104", sku: "LEHENGA-PNK",  title: "Pink Bridal Lehenga",     status: "synced", errorMessage: null, createdAt: new Date(now - 3 * 60 * 1000).toISOString() },
    ];
  };

  router.get("/shopify/connection", (_req, res) => {
    res.json({
      connected: true,
      shopDomain: "dev-mock-store.myshopify.com",
      lastSyncedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      productCount: 142,
      scopes: "read_products,write_products,read_inventory,write_inventory,read_orders,write_orders",
      locationId: "gid://shopify/Location/98765432",
      lastWebhookAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      webhooksRegisteredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      mappedWarehouseCount: 3,
      totalWarehouseCount: 3,
    });
  });

  router.get("/shopify/dashboard", (_req, res) => {
    res.json({
      itemsSynced: 134,
      itemsTotal: 142,
      errorCount: 3,
      skippedCount: 5,
      lastSyncedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      inventoryValue: "2847500.00",
      shopifyTotal: 142,
      warehouseCount: 3,
    });
  });

  router.get("/shopify/product-sync-job/latest", (_req, res) => { res.json(mockJob()); });
  router.get("/shopify/product-sync-job/:id",    (_req, res) => { res.json(mockJob()); });
  router.get("/shopify/sync-jobs",               (_req, res) => { res.json(mockJobs()); });

  router.post("/shopify/sync", (_req, res) => {
    res.json({ jobId: MOCK_JOB_ID });
  });

  router.post("/shopify/product-sync-job/:id/cancel", (_req, res) => {
    res.json({ ...mockJob(), status: "cancelled", cancelledAt: new Date().toISOString() });
  });
  router.post("/shopify/product-sync-job/:id/pause", (_req, res) => {
    res.json({ ...mockJob(), status: "paused", pausedAt: new Date().toISOString() });
  });
  router.post("/shopify/product-sync-job/:id/resume", (_req, res) => {
    res.json({ ...mockJob(), status: "running" });
  });
  router.post("/shopify/product-sync-job/:id/retry-skipped", (_req, res) => {
    res.json({ jobId: MOCK_JOB_ID, message: "New sync started — skipped items will be retried" });
  });

  router.get("/shopify/sync-logs", (_req, res) => {
    res.json(mockItems().map((i) => ({ ...i, shopifyVariantId: null })));
  });

  router.get("/shopify/product-sync-job/:id/items", (_req, res) => {
    res.json({ items: mockItems(), total: 5, hasMore: false });
  });

  router.get("/shopify/export-report.csv", (_req, res) => {
    const rows = mockItems()
      .map((i) => `"${i.sku ?? ""}","${i.title}","${i.status}","${i.errorMessage ?? ""}"`)
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="shopify-sync-report-dev.csv"');
    res.send(`"SKU","Title","Status","Error"\n${rows}`);
  });
}

router.get("/shopify/connection", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const rows = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const o = rows[0]!;

    const counts = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        mapped: sql<number>`COUNT(*) FILTER (WHERE ${warehousesTable.shopifyLocationId} IS NOT NULL)::int`,
      })
      .from(warehousesTable)
      .where(eq(warehousesTable.organizationId, t.organizationId));
    const totalWarehouseCount = Number(counts[0]?.total ?? 0);
    const mappedWarehouseCount = Number(counts[0]?.mapped ?? 0);

    res.json({
      connected: !!o.shopifyAccessToken,
      shopDomain: o.shopifyShopDomain,
      lastSyncedAt: o.shopifyLastSyncedAt
        ? o.shopifyLastSyncedAt.toISOString()
        : null,
      productCount: o.shopifyProductCount ? Number(o.shopifyProductCount) : null,
      scopes: o.shopifyScopes,
      locationId: o.shopifyLocationId,
      lastWebhookAt: o.shopifyLastWebhookAt
        ? o.shopifyLastWebhookAt.toISOString()
        : null,
      webhooksRegisteredAt: o.shopifyWebhookRegisteredAt
        ? o.shopifyWebhookRegisteredAt.toISOString()
        : null,
      mappedWarehouseCount,
      totalWarehouseCount,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/shopify/locations", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const rows = await db
      .select({
        shopDomain: organizationsTable.shopifyShopDomain,
        accessToken: organizationsTable.shopifyAccessToken,
        scopes: organizationsTable.shopifyScopes,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const o = rows[0];
    if (!o?.shopDomain || !o?.accessToken) {
      res.status(400).json({ error: "Shopify is not connected" });
      return;
    }
    const missing = findMissingShopifyScopes(o.scopes);
    if (missing.length > 0) {
      res.status(409).json({
        error: "shopify_reinstall_required",
        message:
          "Your Shopify connection is missing required permissions. Please reconnect to grant updated access.",
        missingScopes: missing,
      });
      return;
    }

    // Cross-reference each Shopify location with the warehouse (if any)
    // already mapped to it, so the UI can show "(mapped to Main Warehouse)"
    // inline without a second round-trip.
    const [shopifyLocations, mappedRows] = await Promise.all([
      fetchAllShopifyLocations(o.shopDomain, o.accessToken),
      db
        .select({
          warehouseId: warehousesTable.id,
          warehouseName: warehousesTable.name,
          shopifyLocationId: warehousesTable.shopifyLocationId,
        })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.organizationId, t.organizationId),
            isNotNull(warehousesTable.shopifyLocationId),
          ),
        ),
    ]);

    const mappedByLoc = new Map(
      mappedRows
        .filter((r) => r.shopifyLocationId)
        .map((r) => [r.shopifyLocationId!, r]),
    );

    res.json({
      locations: shopifyLocations.map((l) => {
        const m = mappedByLoc.get(l.id);
        return {
          id: l.id,
          name: l.name,
          primary: l.primary,
          mappedWarehouseId: m?.warehouseId ?? null,
          mappedWarehouseName: m?.warehouseName ?? null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/shopify/connection", async (req, res, next) => {
  try {
    const t = req.tenant!;
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
      })
      .where(eq(organizationsTable.id, t.organizationId));
    // Wipe per-item shopify mappings so a future install starts fresh
    await db
      .update(itemsTable)
      .set({
        shopifyProductId: null,
        shopifyVariantId: null,
        shopifyInventoryItemId: null,
      })
      .where(eq(itemsTable.organizationId, t.organizationId));
    // Clear warehouse → Shopify location mappings too. Stale mappings
    // would otherwise carry over to a future reconnect (possibly to a
    // different store) and silently push to the wrong locations.
    await db
      .update(warehousesTable)
      .set({ shopifyLocationId: null, shopifyLocationName: null })
      .where(eq(warehousesTable.organizationId, t.organizationId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/shopify/connect-custom", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const b = req.body ?? {};
    if (!b.shopDomain || typeof b.shopDomain !== "string") {
      res.status(400).json({ error: "shopDomain is required" });
      return;
    }
    if (!b.accessToken || typeof b.accessToken !== "string") {
      res.status(400).json({ error: "accessToken is required" });
      return;
    }
    const shopDomain = normalizeShopifyDomain(b.shopDomain);
    if (!shopDomain) {
      res
        .status(400)
        .json({ error: "Shop domain must look like your-store.myshopify.com" });
      return;
    }
    const accessToken = b.accessToken.trim();

    // Validate the token by calling the Shopify API
    const testRes = await fetch(
      `https://${shopDomain}/admin/api/2024-04/shop.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } },
    );
    if (!testRes.ok) {
      res.status(400).json({
        error:
          testRes.status === 401
            ? "Invalid access token — make sure you copied the Admin API access token from your Shopify custom app."
            : `Shopify returned ${testRes.status}. Check the store domain and token.`,
      });
      return;
    }

    // Get the primary location for inventory sync
    const locationId = await getPrimaryLocationId(shopDomain, accessToken);

    const apiKey = typeof b.apiKey === "string" && b.apiKey.trim() ? b.apiKey.trim() : null;
    const apiSecret = typeof b.apiSecret === "string" && b.apiSecret.trim() ? b.apiSecret.trim() : null;

    await db
      .update(organizationsTable)
      .set({
        shopifyShopDomain: shopDomain,
        shopifyAccessToken: accessToken,
        ...(apiKey !== null && { shopifyApiKey: apiKey }),
        ...(apiSecret !== null && { shopifyApiSecret: apiSecret }),
        shopifyScopes: null, // Custom apps don't return scopes via OAuth
        shopifyLocationId: locationId,
      })
      .where(eq(organizationsTable.id, t.organizationId));

    // Register webhooks (best effort)
    try {
      await registerWebhooks(shopDomain, accessToken);
      await db
        .update(organizationsTable)
        .set({ shopifyWebhookRegisteredAt: new Date() })
        .where(eq(organizationsTable.id, t.organizationId));
    } catch (err) {
      req.log?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to register webhooks for custom app (non-fatal)",
      );
    }

    // Return the connection status same shape as GET /shopify/connection
    const orgRows = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const o = orgRows[0]!;
    const counts = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        mapped: sql<number>`COUNT(*) FILTER (WHERE ${warehousesTable.shopifyLocationId} IS NOT NULL)::int`,
      })
      .from(warehousesTable)
      .where(eq(warehousesTable.organizationId, t.organizationId));

    res.json({
      connected: !!o.shopifyAccessToken,
      shopDomain: o.shopifyShopDomain,
      lastSyncedAt: null,
      productCount: null,
      scopes: o.shopifyScopes,
      locationId: o.shopifyLocationId,
      lastWebhookAt: null,
      webhooksRegisteredAt: o.shopifyWebhookRegisteredAt
        ? o.shopifyWebhookRegisteredAt.toISOString()
        : null,
      mappedWarehouseCount: Number(counts[0]?.mapped ?? 0),
      totalWarehouseCount: Number(counts[0]?.total ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/shopify/webhooks/sync", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgRows = await db
      .select({
        shopDomain: organizationsTable.shopifyShopDomain,
        accessToken: organizationsTable.shopifyAccessToken,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const org = orgRows[0];
    if (!org?.shopDomain || !org.accessToken) {
      res.status(400).json({ error: "Shopify not connected" });
      return;
    }
    await registerWebhooks(org.shopDomain, org.accessToken);
    await db
      .update(organizationsTable)
      .set({ shopifyWebhookRegisteredAt: new Date() })
      .where(eq(organizationsTable.id, t.organizationId));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /shopify/sync — start an async product sync job.
 *
 * Returns { jobId } immediately; the frontend polls
 * GET /shopify/product-sync-job/latest (or /:id) for live progress.
 */
router.post("/shopify/sync", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgRows = await db
      .select({
        shopDomain: organizationsTable.shopifyShopDomain,
        accessToken: organizationsTable.shopifyAccessToken,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const org = orgRows[0];
    if (!org?.shopDomain || !org.accessToken) {
      res.status(400).json({ error: "Shopify not connected" });
      return;
    }

    // Capture audit info — look up name/email from users table.
    const ip = getClientIp(req);
    const userRows = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, t.userId))
      .limit(1); // org-scope-allow: lookup by internal PK for audit record
    const user = userRows[0];

    const jobId = await startProductSync(t.organizationId, {
      audit: {
        name: user?.name ?? null,
        email: user?.email ?? null,
        ip,
        location: null, // filled in by async geo lookup below
      },
    });

    // Fire-and-forget geolocation — update the job row when it resolves.
    void (async () => {
      try {
        if (ip === "unknown" || ip.startsWith("127.") || ip.startsWith("::")) return;
        const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country`);
        if (!geoRes.ok) return;
        const geo = (await geoRes.json()) as { city?: string; regionName?: string; country?: string };
        const parts = [geo.city, geo.regionName, geo.country].filter(Boolean);
        if (!parts.length) return;
        await db
          .update(shopifyProductSyncJobsTable) // org-scope-allow: scoped by job UUID owned by this org; geo lookup fires after job creation
          .set({ triggeredByLocation: parts.join(", ") })
          .where(eq(shopifyProductSyncJobsTable.id, jobId));
      } catch {
        // geo lookup is best-effort
      }
    })();

    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

/** GET /shopify/product-sync-job/latest — latest job for this org. */
router.get("/shopify/product-sync-job/latest", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const job = await getLatestProductSyncJob(t.organizationId);
    if (!job) {
      res.status(404).json({ error: "No sync job found" });
      return;
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

/** GET /shopify/product-sync-job/:id — specific job (org-scoped). */
router.get("/shopify/product-sync-job/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const job = await getProductSyncJob(t.organizationId, req.params.id);
    if (!job) {
      res.status(404).json({ error: "Sync job not found" });
      return;
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

/** POST /shopify/product-sync-job/:id/cancel */
router.post("/shopify/product-sync-job/:id/cancel", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const ok = await cancelProductSync(t.organizationId, req.params.id);
    if (!ok) {
      res.status(400).json({ error: "Job is not cancellable (already finished?)" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /shopify/product-sync-job/:id/pause */
router.post("/shopify/product-sync-job/:id/pause", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const ok = await pauseProductSync(t.organizationId, req.params.id);
    if (!ok) {
      res.status(400).json({ error: "Job is not pausable" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /shopify/product-sync-job/:id/resume */
router.post("/shopify/product-sync-job/:id/resume", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const ok = await resumeProductSync(t.organizationId, req.params.id);
    if (!ok) {
      res.status(400).json({ error: "Job is not resumable" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Force-push all linked products (those with a shopifyProductId) from
 * inventory to Shopify. Fire-and-forget per item so the response is
 * immediate; each push coalesces via pushProductFieldsToShopify's
 * in-flight tracker.
 */
router.post("/shopify/push-products", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgRows = await db
      .select({
        shopDomain: organizationsTable.shopifyShopDomain,
        accessToken: organizationsTable.shopifyAccessToken,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const org = orgRows[0];
    if (!org?.shopDomain || !org?.accessToken) {
      res.status(400).json({ error: "Shopify not connected" });
      return;
    }

    const linkedItems = await db
      .select({ id: itemsTable.id })
      .from(itemsTable)
      .where(
        and(
          eq(itemsTable.organizationId, t.organizationId),
          isNotNull(itemsTable.shopifyProductId),
          isNotNull(itemsTable.shopifyVariantId),
        ),
      );

    for (const item of linkedItems) {
      pushProductFieldsToShopify(t.organizationId, item.id);
      pushStockToShopify(t.organizationId, item.id);
    }

    res.json({ itemCount: linkedItems.length });
  } catch (err) {
    next(err);
  }
});

router.post("/shopify/sync-orders", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgRows = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const org = orgRows[0]!;
    if (!org.shopifyShopDomain || !org.shopifyAccessToken) {
      res.status(400).json({ error: "Shopify not connected" });
      return;
    }

    const warehouseId = await getDefaultWarehouseId(t.organizationId);
    const orders = await fetchShopifyOrders(
      org.shopifyShopDomain,
      org.shopifyAccessToken,
      org.shopifyLastOrderId,
    );

    let imported = 0;
    let skipped = 0;
    let lastOrderId = org.shopifyLastOrderId
      ? Number(org.shopifyLastOrderId)
      : 0;

    for (const o of orders) {
      const outcome = await importShopifyOrder(
        t.organizationId,
        warehouseId,
        o,
      );
      if (outcome === "imported") imported += 1;
      else skipped += 1;
      if (o.id > lastOrderId) lastOrderId = o.id;
    }

    const syncedAt = new Date();
    await db
      .update(organizationsTable)
      .set({
        shopifyLastSyncedAt: syncedAt,
        shopifyLastOrderId: lastOrderId > 0 ? String(lastOrderId) : null,
      })
      .where(eq(organizationsTable.id, t.organizationId));

    res.json({
      ordersImported: imported,
      ordersSkipped: skipped,
      warehouseId,
      syncedAt: syncedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Run a historical import in the background, updating the job record as
 * it pages through Shopify. Never throws — failures are recorded on the
 * job so the polling client can surface them.
 */
async function runHistoricalImport(
  jobId: string,
  organizationId: number,
  warehouseId: number,
  shopDomain: string,
  accessToken: string,
  opts: {
    createdAtMin?: string;
    createdAtMax?: string;
    orderIds?: string[];
  },
): Promise<void> {
  const processOrder = async (o: ShopifyOrder) => {
    try {
      const outcome = await importShopifyOrder(organizationId, warehouseId, o);
      await incrementImportJob(jobId, {
        processed: 1,
        imported: outcome === "imported" ? 1 : 0,
        skipped: outcome === "duplicate" ? 1 : 0,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await incrementImportJob(jobId, {
        processed: 1,
        failed: 1,
        failedOrder: { id: String(o.id), reason },
      });
    }
  };

  try {
    if (opts.orderIds && opts.orderIds.length > 0) {
      // Import a specific set of ids (the reconciliation "import missing"
      // path). Shopify's `ids` filter accepts up to 250 per call.
      for (let i = 0; i < opts.orderIds.length; i += 250) {
        const chunk = opts.orderIds.slice(i, i + 250);
        let pageInfo: string | null = null;
        do {
          const page = await fetchShopifyOrdersPage(shopDomain, accessToken, {
            ids: pageInfo ? undefined : chunk,
            pageInfo,
          });
          for (const o of page.orders) await processOrder(o);
          pageInfo = page.nextPageInfo;
        } while (pageInfo);
      }
    } else {
      let pageInfo: string | null = null;
      do {
        const page = await fetchShopifyOrdersPage(shopDomain, accessToken, {
          createdAtMin: pageInfo ? undefined : opts.createdAtMin,
          createdAtMax: pageInfo ? undefined : opts.createdAtMax,
          pageInfo,
        });
        for (const o of page.orders) await processOrder(o);
        pageInfo = page.nextPageInfo;
      } while (pageInfo);
    }

    await db
      .update(organizationsTable)
      .set({ shopifyLastSyncedAt: new Date() })
      .where(eq(organizationsTable.id, organizationId));
    const finalJob = await getImportJob(organizationId, jobId);
    await finishImportJob(
      jobId,
      (finalJob?.failed ?? 0) > 0 ? "completed_with_errors" : "completed",
    );
  } catch (err) {
    await finishImportJob(
      jobId,
      "failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

router.post("/shopify/import-orders", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgRows = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const org = orgRows[0]!;
    if (!org.shopifyShopDomain || !org.shopifyAccessToken) {
      res.status(400).json({ error: "Shopify not connected" });
      return;
    }

    const b = req.body ?? {};
    const rawIds: unknown = b.orderIds;
    const orderIds = Array.isArray(rawIds)
      ? rawIds.map((x) => String(x)).filter((s) => s.length > 0)
      : undefined;
    const fromDate = typeof b.fromDate === "string" ? b.fromDate : null;
    const toDate = typeof b.toDate === "string" ? b.toDate : null;

    let createdAtMin: string | undefined;
    let createdAtMax: string | undefined;
    let total: number | null = null;

    if (orderIds && orderIds.length > 0) {
      total = orderIds.length;
    } else {
      if (!fromDate || !toDate || !DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
        res.status(400).json({
          error: "Provide fromDate and toDate (YYYY-MM-DD), or orderIds",
        });
        return;
      }
      if (fromDate > toDate) {
        res.status(400).json({ error: "fromDate must be on or before toDate" });
        return;
      }
      createdAtMin = `${fromDate}T00:00:00Z`;
      createdAtMax = `${toDate}T23:59:59Z`;
      try {
        total = await fetchShopifyOrdersCount(
          org.shopifyShopDomain,
          org.shopifyAccessToken,
          { createdAtMin, createdAtMax },
        );
      } catch {
        // Non-fatal: progress will show processed count without a total.
        total = null;
      }
    }

    const warehouseId = await getDefaultWarehouseId(t.organizationId);
    const job = await createImportJob({
      organizationId: t.organizationId,
      fromDate: orderIds ? null : fromDate,
      toDate: orderIds ? null : toDate,
      total,
    });

    // Fire-and-forget: the client polls GET /shopify/import-orders/:jobId.
    void runHistoricalImport(
      job.id,
      t.organizationId,
      warehouseId,
      org.shopifyShopDomain,
      org.shopifyAccessToken,
      { createdAtMin, createdAtMax, orderIds },
    );

    res.status(202).json({ jobId: job.id });
  } catch (err) {
    next(err);
  }
});

router.get("/shopify/import-orders/:jobId", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const job = await getImportJob(t.organizationId, req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Import job not found" });
      return;
    }
    res.json({
      jobId: job.id,
      status: job.status,
      total: job.total,
      processed: job.processed,
      imported: job.imported,
      skipped: job.skipped,
      failed: job.failed,
      failedOrders: job.failedOrders,
      fromDate: job.fromDate,
      toDate: job.toDate,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/shopify/reconcile", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgRows = await db
      .select({
        shopDomain: organizationsTable.shopifyShopDomain,
        accessToken: organizationsTable.shopifyAccessToken,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, t.organizationId))
      .limit(1);
    const org = orgRows[0];
    if (!org?.shopDomain || !org?.accessToken) {
      res.status(400).json({ error: "Shopify not connected" });
      return;
    }

    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      res.status(400).json({ error: "from and to (YYYY-MM-DD) are required" });
      return;
    }
    if (from > to) {
      res.status(400).json({ error: "from must be on or before to" });
      return;
    }
    const createdAtMin = `${from}T00:00:00Z`;
    const createdAtMax = `${to}T23:59:59Z`;

    // Page through Shopify, collecting just id + total_price for the range.
    const shopifyIds: string[] = [];
    let shopifyTotal = 0;
    let pageInfo: string | null = null;
    do {
      const page = await fetchShopifyOrdersPage(org.shopDomain, org.accessToken, {
        createdAtMin: pageInfo ? undefined : createdAtMin,
        createdAtMax: pageInfo ? undefined : createdAtMax,
        fields: pageInfo ? undefined : "id,total_price",
        pageInfo,
      });
      for (const o of page.orders) {
        shopifyIds.push(String(o.id));
        shopifyTotal += toNum(o.total_price);
      }
      pageInfo = page.nextPageInfo;
    } while (pageInfo);

    // Pull matching inventory rows (org-scoped) keyed by shopifyOrderId.
    const idCounts = new Map<string, number>();
    let inventoryTotal = 0;
    if (shopifyIds.length > 0) {
      for (let i = 0; i < shopifyIds.length; i += 500) {
        const chunk = shopifyIds.slice(i, i + 500);
        const rows = await db
          .select({
            shopifyOrderId: salesOrdersTable.shopifyOrderId,
            total: salesOrdersTable.total,
          })
          .from(salesOrdersTable)
          .where(
            and(
              eq(salesOrdersTable.organizationId, t.organizationId),
              inArray(salesOrdersTable.shopifyOrderId, chunk),
            ),
          );
        for (const r of rows) {
          if (!r.shopifyOrderId) continue;
          idCounts.set(
            r.shopifyOrderId,
            (idCounts.get(r.shopifyOrderId) ?? 0) + 1,
          );
          inventoryTotal += toNum(r.total);
        }
      }
    }

    const missingInInventory = shopifyIds.filter((id) => !idCounts.has(id));
    const duplicates = [...idCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id);

    res.json({
      from,
      to,
      shopifyCount: shopifyIds.length,
      inventoryCount: idCounts.size,
      shopifyTotal: toStr(shopifyTotal),
      inventoryTotal: toStr(inventoryTotal),
      missingInInventory,
      duplicates,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/shopify/sync-logs", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const limit = Math.min(Number(req.query["limit"] ?? 200), 500);
    const entity = typeof req.query["entity"] === "string" ? req.query["entity"] : null;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : null;
    const days = req.query["days"] ? Number(req.query["days"]) : null;

    const conds = [eq(shopifySyncLogsTable.organizationId, t.organizationId)];
    if (entity) conds.push(eq(shopifySyncLogsTable.entity, entity));
    if (status) conds.push(eq(shopifySyncLogsTable.status, status));
    if (days && days > 0) {
      conds.push(
        sql`${shopifySyncLogsTable.createdAt} >= NOW() - INTERVAL '${sql.raw(String(Math.floor(days)))} days'`,
      );
    }

    const [rows, summary] = await Promise.all([
      db
        .select()
        .from(shopifySyncLogsTable)
        .where(and(...conds))
        .orderBy(sql`${shopifySyncLogsTable.createdAt} DESC`)
        .limit(limit),
      db
        .select({
          status: shopifySyncLogsTable.status,
          count: sql<string>`COUNT(*)`,
        })
        .from(shopifySyncLogsTable)
        .where(and(eq(shopifySyncLogsTable.organizationId, t.organizationId)))
        .groupBy(shopifySyncLogsTable.status),
    ]);

    const counts = { total: 0, success: 0, error: 0, skipped: 0 };
    for (const row of summary) {
      const n = Number(row.count);
      counts.total += n;
      if (row.status === "success") counts.success = n;
      else if (row.status === "error") counts.error = n;
      else if (row.status === "skipped") counts.skipped = n;
    }

    res.json({ logs: rows, summary: counts });
  } catch (err) {
    next(err);
  }
});

router.post("/shopify/sync-logs/retry-failed", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const { retryFailedProductSyncs } = await import("../lib/shopifyOutbound");
    const queued = await retryFailedProductSyncs(t.organizationId);
    res.json({ queued });
  } catch (err) {
    next(err);
  }
});

// ─── GET /shopify/sync-jobs ───────────────────────────────────────────────────
// Returns the last 50 product sync jobs with audit trail info.

router.get("/shopify/sync-jobs", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const jobs = await db
      .select({
        id: shopifyProductSyncJobsTable.id,
        status: shopifyProductSyncJobsTable.status,
        totalShopify: shopifyProductSyncJobsTable.totalShopify,
        processed: shopifyProductSyncJobsTable.processed,
        created: shopifyProductSyncJobsTable.created,
        updated: shopifyProductSyncJobsTable.updated,
        skipped: shopifyProductSyncJobsTable.skipped,
        failed: shopifyProductSyncJobsTable.failed,
        missing: shopifyProductSyncJobsTable.missing,
        error: shopifyProductSyncJobsTable.error,
        startedAt: shopifyProductSyncJobsTable.startedAt,
        finishedAt: shopifyProductSyncJobsTable.finishedAt,
        triggeredByName: shopifyProductSyncJobsTable.triggeredByName,
        triggeredByEmail: shopifyProductSyncJobsTable.triggeredByEmail,
        triggeredByIp: shopifyProductSyncJobsTable.triggeredByIp,
        triggeredByLocation: shopifyProductSyncJobsTable.triggeredByLocation,
      })
      .from(shopifyProductSyncJobsTable)
      .where(eq(shopifyProductSyncJobsTable.organizationId, t.organizationId))
      .orderBy(sql`${shopifyProductSyncJobsTable.startedAt} DESC`)
      .limit(limit);
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// ─── GET /shopify/dashboard ───────────────────────────────────────────────────
// Returns ERP + connection stats for the enterprise dashboard metrics grid.

router.get("/shopify/dashboard", async (req, res, next) => {
  try {
    const t = req.tenant!;

    const [orgRows, erpStats, stockValue, warehouseCount] = await Promise.all([
      db
        .select({
          shopifyProductCount: organizationsTable.shopifyProductCount,
          shopifyLastSyncedAt: organizationsTable.shopifyLastSyncedAt,
          shopifyShopDomain: organizationsTable.shopifyShopDomain,
        })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, t.organizationId))
        .limit(1),

      // ERP item breakdown (non-archived, non-bundle)
      db
        .select({
          totalItems: sql<number>`COUNT(*)::int`,
          mappedItems: sql<number>`COUNT(*) FILTER (WHERE ${itemsTable.shopifyProductId} IS NOT NULL)::int`,
          simpleItems: sql<number>`COUNT(*) FILTER (
            WHERE ${itemsTable.shopifyProductId} IS NOT NULL
              AND ${itemsTable.hasVariants} = false
              AND ${itemsTable.parentItemId} IS NULL
          )::int`,
          variantProducts: sql<number>`COUNT(*) FILTER (
            WHERE ${itemsTable.shopifyProductId} IS NOT NULL
              AND ${itemsTable.hasVariants} = true
              AND ${itemsTable.parentItemId} IS NULL
          )::int`,
          totalVariants: sql<number>`COUNT(*) FILTER (
            WHERE ${itemsTable.parentItemId} IS NOT NULL
              AND ${itemsTable.archivedAt} IS NULL
          )::int`,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, t.organizationId),
            isNull(itemsTable.archivedAt),
          ),
        ),

      // Inventory value
      db
        .select({
          totalValue: sql<string>`COALESCE(SUM(
            ${itemWarehouseStockTable.quantity} * ${itemsTable.salePrice}
          ), 0)`,
        })
        .from(itemWarehouseStockTable)
        .innerJoin(
          itemsTable,
          and(
            eq(itemsTable.id, itemWarehouseStockTable.itemId),
            isNull(itemsTable.archivedAt),
          ),
        )
        .where(eq(itemWarehouseStockTable.organizationId, t.organizationId)),

      // Physical warehouse count
      db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.organizationId, t.organizationId),
            eq(warehousesTable.isVirtual, false),
          ),
        ),
    ]);

    const org = orgRows[0]!;
    const erp = erpStats[0]!;

    res.json({
      shopifyTotal: org.shopifyProductCount ? Number(org.shopifyProductCount) : null,
      lastSyncedAt: org.shopifyLastSyncedAt ? org.shopifyLastSyncedAt.toISOString() : null,
      erpTotal: erp.totalItems,
      mappedItems: erp.mappedItems,
      simpleItems: erp.simpleItems,
      variantProducts: erp.variantProducts,
      totalVariants: erp.totalVariants,
      inventoryValue: stockValue[0]?.totalValue ?? "0",
      warehouseCount: Number(warehouseCount[0]?.n ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /shopify/product-sync-job/:id/items ──────────────────────────────────
// Drill-down: sync log rows for a specific job, filtered by status.
// status param: "created" | "updated" | "failed" | "skipped" | "missing"

router.get("/shopify/product-sync-job/:id/items", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const jobId = req.params.id;
    const statusParam = typeof req.query.status === "string" ? req.query.status : null;
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const offset = Number(req.query.offset ?? 0);

    // Fetch the job to get its time window.
    const jobRows = await db
      .select()
      .from(shopifyProductSyncJobsTable)
      .where(
        and(
          eq(shopifyProductSyncJobsTable.id, jobId),
          eq(shopifyProductSyncJobsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!jobRows[0]) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const job = jobRows[0];

    // Build filter conditions
    const conds = [
      eq(shopifySyncLogsTable.organizationId, t.organizationId),
      eq(shopifySyncLogsTable.entity, "product"),
      gte(shopifySyncLogsTable.createdAt, job.startedAt),
    ];
    if (job.finishedAt) {
      conds.push(lte(shopifySyncLogsTable.createdAt, job.finishedAt));
    }
    if (statusParam === "failed") {
      conds.push(eq(shopifySyncLogsTable.status, "error"));
    } else if (statusParam === "skipped") {
      conds.push(eq(shopifySyncLogsTable.status, "skipped"));
    } else if (statusParam === "created") {
      conds.push(eq(shopifySyncLogsTable.status, "success"));
      conds.push(eq(shopifySyncLogsTable.action, "create"));
    } else if (statusParam === "updated") {
      conds.push(eq(shopifySyncLogsTable.status, "success"));
      conds.push(eq(shopifySyncLogsTable.action, "update"));
    }

    const [rows, totalCount] = await Promise.all([
      db
        .select()
        .from(shopifySyncLogsTable)
        .where(and(...conds))
        .orderBy(sql`${shopifySyncLogsTable.createdAt} DESC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(shopifySyncLogsTable)
        .where(and(...conds)),
    ]);

    res.json({ items: rows, total: Number(totalCount[0]?.n ?? 0) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /shopify/product-sync-job/:id/retry-skipped ────────────────────────
// Re-queue all products that were skipped in the given job for a fresh sync.

router.post("/shopify/product-sync-job/:id/retry-skipped", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const jobId = req.params.id;

    // Validate job ownership
    const jobRows = await db
      .select({ id: shopifyProductSyncJobsTable.id, startedAt: shopifyProductSyncJobsTable.startedAt, finishedAt: shopifyProductSyncJobsTable.finishedAt })
      .from(shopifyProductSyncJobsTable)
      .where(
        and(
          eq(shopifyProductSyncJobsTable.id, jobId),
          eq(shopifyProductSyncJobsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!jobRows[0]) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    // Start a new full sync — retry-skipped re-runs the entire import,
    // which will naturally pick up previously-skipped items.
    const { startProductSync } = await import("../lib/shopifyProductSync");
    const newJobId = await startProductSync(t.organizationId);
    res.json({ jobId: newJobId, message: "New sync started — skipped items will be retried" });
  } catch (err) {
    next(err);
  }
});

// ─── GET /shopify/export-report.csv ──────────────────────────────────────────
// Export the most recent sync logs as CSV.

router.get("/shopify/export-report.csv", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const statusFilter = typeof req.query.status === "string" ? req.query.status : null;

    const conds = [eq(shopifySyncLogsTable.organizationId, t.organizationId)];
    if (statusFilter) conds.push(eq(shopifySyncLogsTable.status, statusFilter));

    // Support both legacy ?days= and new ?from=&to= ISO date params.
    if (req.query.from && typeof req.query.from === "string") {
      const from = new Date(req.query.from);
      if (!isNaN(from.getTime())) conds.push(gte(shopifySyncLogsTable.createdAt, from));
    } else if (req.query.days) {
      const days = Number(req.query.days);
      if (days > 0) {
        conds.push(
          sql`${shopifySyncLogsTable.createdAt} >= NOW() - INTERVAL '${sql.raw(String(Math.floor(days)))} days'`,
        );
      }
    }
    if (req.query.to && typeof req.query.to === "string") {
      // "to" is inclusive — extend to end of that day.
      const to = new Date(req.query.to);
      if (!isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        conds.push(lte(shopifySyncLogsTable.createdAt, to));
      }
    }

    const rows = await db
      .select()
      .from(shopifySyncLogsTable)
      .where(and(...conds))
      .orderBy(sql`${shopifySyncLogsTable.createdAt} DESC`)
      .limit(5000);

    const headers = ["ID", "Direction", "Entity", "Action", "Status", "Shopify ID", "ERP ID", "SKU", "Name", "Failure Reason", "Error Message", "Date/Time"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        [r.id, r.direction, r.entity, r.action, r.status, r.shopifyId, r.erpId, r.sku, r.name, r.failureReason, r.errorMessage, r.createdAt.toISOString()]
          .map(escape)
          .join(","),
      ),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="shopify-sync-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvLines.join("\n"));
  } catch (err) {
    next(err);
  }
});

export default router;
