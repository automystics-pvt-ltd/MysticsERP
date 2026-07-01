import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, lt, isNotNull, inArray, sql } from "drizzle-orm";
import {
  db,
  organizationsTable,
  itemsTable,
  salesOrdersTable,
  shopifyOauthStatesTable,
  shopifySyncLogsTable,
  warehousesTable,
} from "@workspace/db";
import { tenantMiddleware, getDefaultWarehouseId } from "../lib/tenant";
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
    const jobId = await startProductSync(t.organizationId);
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

export default router;
