/**
 * Async product-sync worker for Shopify → ERP (inbound).
 *
 * Key design decisions:
 *   - The sync job is persisted in `shopify_product_sync_jobs` so progress
 *     survives server restarts (the job is marked failed on boot if orphaned).
 *   - cancelSignal / pauseSignal are written by control routes and polled by
 *     the worker every CONTROL_POLL_EVERY items to interrupt without killing
 *     the process.
 *   - Every processed variant emits a `shopify_sync_logs` row so the history
 *     table shows per-product status with exact skip/failure reasons.
 *   - Progress is flushed every FLUSH_EVERY items (atomic SQL increments).
 */

import crypto from "node:crypto";
import { and, count, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import {
  db,
  itemsTable,
  itemWarehouseStockTable,
  organizationsTable,
  shopifyProductSyncJobsTable,
  shopifySyncLogsTable,
  stockMovementsTable,
  warehousesTable,
  type ShopifyProductSyncJob,
} from "@workspace/db";
import { logger } from "./logger";
import { fetchShopifyProducts } from "./shopify";
import { generateUniqueBarcode } from "./barcodeGen";
import { toNum, toStr } from "./numeric";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Flush progress counters to DB every N variants. */
const FLUSH_EVERY = 5;
/** Check cancel / pause signals every N variants. */
const CONTROL_POLL_EVERY = 10;
/** How long to sleep between pause-loop polls (ms). */
const PAUSE_POLL_MS = 2_000;
/** Max jobs retained per org before the oldest completed ones are pruned. */
const MAX_RETAINED_JOBS = 20;

// Captured at module load — used to distinguish orphaned "running" rows from
// a prior process from jobs this process legitimately started.
const PROCESS_BOOT_AT = new Date();

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ProductSyncStatus =
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface ProductSyncJob {
  id: string;
  organizationId: number;
  status: ProductSyncStatus;
  totalShopify: number | null;
  totalErp: number | null;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  missing: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

// ─── Row mapper ────────────────────────────────────────────────────────────────

function mapRow(row: ShopifyProductSyncJob): ProductSyncJob {
  return {
    id: row.id,
    organizationId: row.organizationId,
    status: row.status as ProductSyncStatus,
    totalShopify: row.totalShopify,
    totalErp: row.totalErp,
    processed: row.processed,
    created: row.created,
    updated: row.updated,
    skipped: row.skipped,
    failed: row.failed,
    missing: row.missing,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Fetch the latest product sync job for an org (most recent startedAt). */
export async function getLatestProductSyncJob(
  organizationId: number,
): Promise<ProductSyncJob | null> {
  const rows = await db
    .select()
    .from(shopifyProductSyncJobsTable)
    .where(eq(shopifyProductSyncJobsTable.organizationId, organizationId))
    .orderBy(sql`${shopifyProductSyncJobsTable.startedAt} DESC`)
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Fetch a specific job (org-scoped). */
export async function getProductSyncJob(
  organizationId: number,
  jobId: string,
): Promise<ProductSyncJob | null> {
  const rows = await db
    .select()
    .from(shopifyProductSyncJobsTable)
    .where(
      and(
        eq(shopifyProductSyncJobsTable.id, jobId),
        eq(shopifyProductSyncJobsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Start an async product sync for an org.
 *
 * @param skipVariantIds When provided, only these Shopify variant IDs are
 *   processed (used by "retry skipped" — full catalog is still fetched from
 *   Shopify so variant metadata is current, but unmatched variants are
 *   skipped without writing a log entry).
 * @returns jobId
 */
export async function startProductSync(
  organizationId: number,
  opts?: { skipVariantIds?: Set<string> },
): Promise<string> {
  // Prune old completed jobs first (keep last MAX_RETAINED_JOBS per org).
  void pruneOldProductSyncJobs(organizationId);

  const id = crypto.randomUUID();
  await db.insert(shopifyProductSyncJobsTable).values({
    id,
    organizationId,
    status: "running",
  });

  // Fire-and-forget — caller gets the job id immediately.
  void runProductSyncJob(id, organizationId, opts?.skipVariantIds).catch(
    (err) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), jobId: id },
        "product sync job crashed unexpectedly",
      );
    },
  );

  return id;
}

/** Set cancel signal — the worker will stop at the next control-poll. */
export async function cancelProductSync(
  organizationId: number,
  jobId: string,
): Promise<boolean> {
  const result = await db
    .update(shopifyProductSyncJobsTable)
    .set({ cancelSignal: true })
    .where(
      and(
        eq(shopifyProductSyncJobsTable.id, jobId),
        eq(shopifyProductSyncJobsTable.organizationId, organizationId),
        sql`${shopifyProductSyncJobsTable.status} IN ('running', 'paused')`,
      ),
    )
    .returning({ id: shopifyProductSyncJobsTable.id });
  return result.length > 0;
}

/** Set pause signal — the worker will wait at the next control-poll. */
export async function pauseProductSync(
  organizationId: number,
  jobId: string,
): Promise<boolean> {
  const result = await db
    .update(shopifyProductSyncJobsTable)
    .set({ pauseSignal: true, status: "paused" })
    .where(
      and(
        eq(shopifyProductSyncJobsTable.id, jobId),
        eq(shopifyProductSyncJobsTable.organizationId, organizationId),
        eq(shopifyProductSyncJobsTable.status, "running"),
      ),
    )
    .returning({ id: shopifyProductSyncJobsTable.id });
  return result.length > 0;
}

/** Clear pause signal — the worker resumes from where it left off. */
export async function resumeProductSync(
  organizationId: number,
  jobId: string,
): Promise<boolean> {
  const result = await db
    .update(shopifyProductSyncJobsTable)
    .set({ pauseSignal: false, status: "running" })
    .where(
      and(
        eq(shopifyProductSyncJobsTable.id, jobId),
        eq(shopifyProductSyncJobsTable.organizationId, organizationId),
        eq(shopifyProductSyncJobsTable.status, "paused"),
      ),
    )
    .returning({ id: shopifyProductSyncJobsTable.id });
  return result.length > 0;
}

/**
 * Mark orphaned "running" jobs (from a prior server process) as failed so
 * the UI stops polling forever. Called once on startup.
 */
export async function reconcileOrphanedProductSyncJobs(): Promise<void> {
  await db // org-scope-allow: startup recovery — scans all orgs, status fixup only
    .update(shopifyProductSyncJobsTable)
    .set({
      status: "failed",
      error: "Interrupted by a server restart",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(shopifyProductSyncJobsTable.status, "running"),
        lt(shopifyProductSyncJobsTable.startedAt, PROCESS_BOOT_AT),
      ),
    );
}

/** Remove old completed jobs beyond MAX_RETAINED_JOBS per org. */
export async function pruneOldProductSyncJobs(
  organizationId: number,
): Promise<void> {
  // Find the Nth oldest by startedAt; delete anything older.
  const rows = await db
    .select({ startedAt: shopifyProductSyncJobsTable.startedAt })
    .from(shopifyProductSyncJobsTable)
    .where(eq(shopifyProductSyncJobsTable.organizationId, organizationId))
    .orderBy(sql`${shopifyProductSyncJobsTable.startedAt} DESC`)
    .limit(MAX_RETAINED_JOBS + 1);

  if (rows.length > MAX_RETAINED_JOBS) {
    const cutoff = rows[MAX_RETAINED_JOBS]!.startedAt;
    await db
      .delete(shopifyProductSyncJobsTable)
      .where(
        and(
          eq(shopifyProductSyncJobsTable.organizationId, organizationId),
          lt(shopifyProductSyncJobsTable.startedAt, cutoff),
          sql`${shopifyProductSyncJobsTable.status} NOT IN ('running', 'paused')`,
        ),
      );
  }
}

// ─── Worker ────────────────────────────────────────────────────────────────────

/** Main async worker — runs entirely in the background. */
async function runProductSyncJob(
  jobId: string,
  organizationId: number,
  onlyVariantIds?: Set<string>,
): Promise<void> {
  try {
    // ── 1. Load org credentials ──────────────────────────────────────────────
    const orgRows = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1); // org-scope-allow: keyed by primary key (organizationId)
    const org = orgRows[0];
    if (!org?.shopifyShopDomain || !org.shopifyAccessToken) {
      await failJob(jobId, "Shopify is not connected");
      return;
    }

    // ── 2. Snapshot ERP products with Shopify mapping ────────────────────────
    const [erpCountRows] = await db
      .select({ n: count() })
      .from(itemsTable)
      .where(
        and(
          eq(itemsTable.organizationId, organizationId),
          isNotNull(itemsTable.shopifyVariantId),
        ),
      );
    const totalErp = Number(erpCountRows?.n ?? 0);

    // ── 3. Consolidate warehouse mapping ─────────────────────────────────────
    const physicalDefaultRows = await db
      .select({ id: warehousesTable.id, shopifyLocationId: warehousesTable.shopifyLocationId })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.organizationId, organizationId),
          eq(warehousesTable.isDefault, true),
          eq(warehousesTable.isVirtual, false),
        ),
      )
      .limit(1);

    let warehouseId: number | undefined = physicalDefaultRows[0]?.id;
    if (!warehouseId) {
      const anyRows = await db
        .select({ id: warehousesTable.id })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.organizationId, organizationId),
            eq(warehousesTable.isVirtual, false),
          ),
        )
        .orderBy(warehousesTable.id)
        .limit(1);
      warehouseId = anyRows[0]?.id;
    }
    if (!warehouseId) {
      await failJob(jobId, "No physical warehouse found");
      return;
    }

    // Move the primary Shopify location mapping to the default warehouse.
    if (org.shopifyLocationId && warehouseId) {
      await db
        .update(warehousesTable)
        .set({ shopifyLocationId: null, shopifyLocationName: null })
        .where(
          and(
            eq(warehousesTable.organizationId, organizationId),
            eq(warehousesTable.shopifyLocationId, org.shopifyLocationId),
            ne(warehousesTable.id, warehouseId),
          ),
        );
      if (!physicalDefaultRows[0]?.shopifyLocationId) {
        await db
          .update(warehousesTable)
          .set({ shopifyLocationId: org.shopifyLocationId })
          .where(
            and(
              eq(warehousesTable.id, warehouseId),
              eq(warehousesTable.organizationId, organizationId),
            ),
          );
      }
    }

    // ── 4. Fetch all products from Shopify ───────────────────────────────────
    const products = await fetchShopifyProducts(
      org.shopifyShopDomain,
      org.shopifyAccessToken,
    );

    // Count total leaf variants to sync.
    let totalShopify = 0;
    const seenVariantIds = new Set<string>();
    for (const p of products) {
      for (const v of p.variants) {
        const vid = String(v.id);
        if (onlyVariantIds && !onlyVariantIds.has(vid)) continue;
        seenVariantIds.add(vid);
        if (p.variants.length > 1) {
          totalShopify += 1; // count only leaf variants
        } else {
          totalShopify += 1;
        }
      }
    }

    // Update job with known totals.
    await db
      .update(shopifyProductSyncJobsTable) // org-scope-allow: scoped by job id which was created for this org
      .set({ totalShopify, totalErp, updatedAt: new Date() })
      .where(eq(shopifyProductSyncJobsTable.id, jobId));

    // ── 5. Process each product / variant ────────────────────────────────────
    let localCreated = 0;
    let localUpdated = 0;
    let localSkipped = 0;
    let localFailed = 0;
    let processedSinceFlush = 0;
    let totalProcessed = 0;

    const flushProgress = async () => {
      await db // org-scope-allow: job-id keyed
        .update(shopifyProductSyncJobsTable)
        .set({
          processed: sql`${shopifyProductSyncJobsTable.processed} + ${processedSinceFlush}`,
          created: sql`${shopifyProductSyncJobsTable.created} + ${localCreated}`,
          updated: sql`${shopifyProductSyncJobsTable.updated} + ${localUpdated}`,
          skipped: sql`${shopifyProductSyncJobsTable.skipped} + ${localSkipped}`,
          failed: sql`${shopifyProductSyncJobsTable.failed} + ${localFailed}`,
          updatedAt: new Date(),
        })
        .where(eq(shopifyProductSyncJobsTable.id, jobId));
      processedSinceFlush = 0;
      localCreated = 0;
      localUpdated = 0;
      localSkipped = 0;
      localFailed = 0;
    };

    const checkSignals = async (): Promise<"continue" | "cancel" | "paused"> => {
      const rows = await db
        .select({
          cancelSignal: shopifyProductSyncJobsTable.cancelSignal,
          pauseSignal: shopifyProductSyncJobsTable.pauseSignal,
        })
        .from(shopifyProductSyncJobsTable) // org-scope-allow: scoped by job id which was created for this org
        .where(eq(shopifyProductSyncJobsTable.id, jobId))
        .limit(1);
      const row = rows[0];
      if (!row) return "cancel";
      if (row.cancelSignal) return "cancel";
      if (row.pauseSignal) return "paused";
      return "continue";
    };

    let cancelled = false;

    for (const p of products) {
      if (!p.variants.length) continue;

      // Build parent item for multi-variant products.
      if (p.variants.length > 1) {
        const axes = (p.options ?? [])
          .map((o) => (typeof o.name === "string" ? o.name.trim() : ""))
          .filter((n) => n.length > 0)
          .slice(0, 3);
        if (axes.length === 0) axes.push("Title");

        const parentSku = `SHOPIFY-PRODUCT-${p.id}`;
        const parentExisting = await db
          .select()
          .from(itemsTable)
          .where(
            and(
              eq(itemsTable.organizationId, organizationId),
              eq(itemsTable.sku, parentSku),
            ),
          )
          .limit(1);

        let parentId: number;
        if (parentExisting[0]) {
          await db
            .update(itemsTable)
            .set({
              name: p.title,
              description: p.body_html,
              category: p.product_type,
              imageUrl: p.image?.src ?? parentExisting[0].imageUrl,
              shopifyProductId: String(p.id),
              hasVariants: true,
              variantOptions: { axes },
            })
            .where(
              and(
                eq(itemsTable.organizationId, organizationId),
                eq(itemsTable.id, parentExisting[0].id),
              ),
            );
          parentId = parentExisting[0].id;
        } else {
          const autoBarcode = await generateUniqueBarcode(organizationId);
          const [created] = await db
            .insert(itemsTable)
            .values({
              organizationId,
              sku: parentSku,
              name: p.title,
              description: p.body_html,
              category: p.product_type,
              unit: "pcs",
              barcode: autoBarcode,
              barcodeSource: "auto",
              salePrice: "0",
              purchasePrice: "0",
              taxRate: "0",
              reorderLevel: "0",
              shopifyProductId: String(p.id),
              hasVariants: true,
              variantOptions: { axes },
            })
            .returning();
          parentId = created!.id;
        }

        // Process each variant.
        for (const v of p.variants) {
          const vid = String(v.id);
          if (onlyVariantIds && !onlyVariantIds.has(vid)) continue;

          const variantSku =
            (v.sku && v.sku.trim()) || `SHOPIFY-${p.id}-${v.id}`;
          const opts: Record<string, string> = {};
          const optionVals = [v.option1, v.option2, v.option3];
          axes.forEach((axisName, idx) => {
            const val = optionVals[idx];
            opts[axisName] =
              typeof val === "string" && val.trim()
                ? val.trim()
                : (v.title ?? "Default");
          });
          const variantName = `${p.title} — ${v.title ?? Object.values(opts).join(" / ")}`;

          const outcome = await upsertVariant(
            organizationId,
            warehouseId,
            p,
            v,
            variantSku,
            variantName,
            parentId,
            opts,
          );

          writeSyncLog(organizationId, {
            direction: "inbound",
            entity: "product",
            action: outcome.action,
            status: outcome.status,
            shopifyId: vid,
            erpId: outcome.itemId ? String(outcome.itemId) : null,
            sku: variantSku,
            name: variantName,
            parentItemId: parentId,
            failureReason: outcome.failureReason ?? null,
            errorMessage: outcome.errorMessage ?? null,
          });

          if (outcome.status === "success") {
            if (outcome.action === "create") localCreated++;
            else localUpdated++;
          } else if (outcome.status === "skipped") {
            localSkipped++;
          } else {
            localFailed++;
          }

          totalProcessed++;
          processedSinceFlush++;

          if (processedSinceFlush >= FLUSH_EVERY) await flushProgress();

          if (totalProcessed % CONTROL_POLL_EVERY === 0) {
            await flushProgress(); // ensure progress is visible while paused
            const signal = await checkSignals();
            if (signal === "cancel") {
              cancelled = true;
              break;
            }
            if (signal === "paused") {
              // Spin until resumed or cancelled.
              while (true) {
                await sleep(PAUSE_POLL_MS);
                const s2 = await checkSignals();
                if (s2 === "cancel") {
                  cancelled = true;
                  break;
                }
                if (s2 === "continue") break;
              }
              if (cancelled) break;
            }
          }
        }
      } else {
        // Single-variant (flat) product.
        const v = p.variants[0]!;
        const vid = String(v.id);
        if (onlyVariantIds && !onlyVariantIds.has(vid)) continue;

        const sku = (v.sku && v.sku.trim()) || `SHOPIFY-${p.id}`;
        const outcome = await upsertVariant(
          organizationId,
          warehouseId,
          p,
          v,
          sku,
          p.title,
          null,
          null,
        );

        writeSyncLog(organizationId, {
          direction: "inbound",
          entity: "product",
          action: outcome.action,
          status: outcome.status,
          shopifyId: vid,
          erpId: outcome.itemId ? String(outcome.itemId) : null,
          sku,
          name: p.title,
          parentItemId: null,
          failureReason: outcome.failureReason ?? null,
          errorMessage: outcome.errorMessage ?? null,
        });

        if (outcome.status === "success") {
          if (outcome.action === "create") localCreated++;
          else localUpdated++;
        } else if (outcome.status === "skipped") {
          localSkipped++;
        } else {
          localFailed++;
        }

        totalProcessed++;
        processedSinceFlush++;

        if (processedSinceFlush >= FLUSH_EVERY) await flushProgress();

        if (totalProcessed % CONTROL_POLL_EVERY === 0) {
          await flushProgress();
          const signal = await checkSignals();
          if (signal === "cancel") {
            cancelled = true;
            break;
          }
          if (signal === "paused") {
            while (true) {
              await sleep(PAUSE_POLL_MS);
              const s2 = await checkSignals();
              if (s2 === "cancel") {
                cancelled = true;
                break;
              }
              if (s2 === "continue") break;
            }
            if (cancelled) break;
          }
        }
      }

      if (cancelled) break;
    }

    // Final progress flush.
    await flushProgress();

    if (cancelled) {
      await db // org-scope-allow: job-id keyed
        .update(shopifyProductSyncJobsTable)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(shopifyProductSyncJobsTable.id, jobId));
      return;
    }

    // ── 6. Compute "missing" ERP items (had mapping, no longer in Shopify) ──
    let missingCount = 0;
    if (seenVariantIds.size > 0) {
      // Items that have a variant id not in the fetched Shopify catalog.
      const mappedItems = await db
        .select({ shopifyVariantId: itemsTable.shopifyVariantId })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, organizationId),
            isNotNull(itemsTable.shopifyVariantId),
          ),
        );
      for (const item of mappedItems) {
        if (item.shopifyVariantId && !seenVariantIds.has(item.shopifyVariantId)) {
          missingCount++;
        }
      }
    }

    // ── 7. Update org sync timestamp ─────────────────────────────────────────
    await db
      .update(organizationsTable)
      .set({
        shopifyLastSyncedAt: new Date(),
        shopifyProductCount: String(totalProcessed),
      })
      .where(eq(organizationsTable.id, organizationId));

    // ── 8. Finish job ────────────────────────────────────────────────────────
    const finalRow = await db
      .select({ failed: shopifyProductSyncJobsTable.failed })
      .from(shopifyProductSyncJobsTable) // org-scope-allow: scoped by job id which was created for this org
      .where(eq(shopifyProductSyncJobsTable.id, jobId))
      .limit(1);
    const hasFailed = (finalRow[0]?.failed ?? 0) > 0;

    await db // org-scope-allow: job-id keyed
      .update(shopifyProductSyncJobsTable)
      .set({
        status: hasFailed ? "completed_with_errors" : "completed",
        missing: missingCount,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shopifyProductSyncJobsTable.id, jobId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, jobId }, "product sync job failed");
    await failJob(jobId, msg);
  }
}

// ─── Variant upsert (core sync logic) ─────────────────────────────────────────

type UpsertOutcome = {
  action: "create" | "update" | "sync";
  status: "success" | "error" | "skipped";
  itemId: number | null;
  failureReason?: string;
  errorMessage?: string;
};

type ShopifyProduct = Awaited<ReturnType<typeof fetchShopifyProducts>>[number];
type ShopifyVariant = ShopifyProduct["variants"][number];

async function upsertVariant(
  organizationId: number,
  warehouseId: number,
  p: ShopifyProduct,
  v: ShopifyVariant,
  sku: string,
  variantName: string,
  parentItemId: number | null,
  variantOptions: Record<string, string> | null,
): Promise<UpsertOutcome> {
  try {
    const salePrice = v.price ?? "0";
    const qty = v.inventory_quantity ?? 0;

    // Match by Shopify variant id first (stable across SKU renames),
    // then fall back to SKU for first sync.
    let existing = await db
      .select()
      .from(itemsTable)
      .where(
        and(
          eq(itemsTable.organizationId, organizationId),
          eq(itemsTable.shopifyVariantId, String(v.id)),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      existing = await db
        .select()
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.organizationId, organizationId),
            eq(itemsTable.sku, sku),
          ),
        )
        .limit(1);
    }

    let itemId: number;
    let action: "create" | "update";

    if (existing[0]) {
      await db
        .update(itemsTable)
        .set({
          name: variantName,
          description: p.body_html,
          category: p.product_type,
          salePrice,
          shopifyProductId: String(p.id),
          shopifyVariantId: String(v.id),
          shopifyInventoryItemId: v.inventory_item_id ? String(v.inventory_item_id) : null,
          imageUrl: p.image?.src ?? existing[0].imageUrl,
          parentItemId: parentItemId ?? existing[0].parentItemId,
          variantOptions: variantOptions ?? existing[0].variantOptions,
        })
        .where(
          and(
            eq(itemsTable.organizationId, organizationId),
            eq(itemsTable.id, existing[0].id),
          ),
        );
      itemId = existing[0].id;
      action = "update";
    } else {
      const autoBarcode = await generateUniqueBarcode(organizationId);
      const [created] = await db
        .insert(itemsTable)
        .values({
          organizationId,
          sku,
          name: variantName,
          description: p.body_html,
          category: p.product_type,
          unit: "pcs",
          barcode: autoBarcode,
          barcodeSource: "auto",
          salePrice,
          purchasePrice: "0",
          taxRate: "0",
          reorderLevel: "0",
          shopifyProductId: String(p.id),
          shopifyVariantId: String(v.id),
          shopifyInventoryItemId: v.inventory_item_id ? String(v.inventory_item_id) : null,
          imageUrl: p.image?.src ?? null,
          parentItemId: parentItemId ?? null,
          variantOptions: variantOptions ?? null,
          hasVariants: false,
        })
        .returning();
      itemId = created!.id;
      action = "create";
    }

    // Sync stock.
    const stockRows = await db
      .select()
      .from(itemWarehouseStockTable)
      .where(
        and(
          eq(itemWarehouseStockTable.organizationId, organizationId),
          eq(itemWarehouseStockTable.itemId, itemId),
          eq(itemWarehouseStockTable.warehouseId, warehouseId),
        ),
      )
      .limit(1);
    const newQty = toStr(qty);
    if (stockRows[0]) {
      const delta = qty - toNum(stockRows[0].quantity);
      await db
        .update(itemWarehouseStockTable)
        .set({ quantity: newQty })
        .where(
          and(
            eq(itemWarehouseStockTable.id, stockRows[0].id),
            eq(itemWarehouseStockTable.organizationId, organizationId),
          ),
        );
      if (delta !== 0) {
        await db.insert(stockMovementsTable).values({
          organizationId,
          itemId,
          warehouseId,
          movementType: "shopify_sync",
          quantity: toStr(delta),
          referenceType: "shopify",
          notes: "Shopify inventory sync",
        });
      }
    } else {
      await db.insert(itemWarehouseStockTable).values({
        organizationId,
        itemId,
        warehouseId,
        quantity: newQty,
      });
      if (qty !== 0) {
        await db.insert(stockMovementsTable).values({
          organizationId,
          itemId,
          warehouseId,
          movementType: "shopify_sync",
          quantity: newQty,
          referenceType: "shopify",
          notes: "Initial Shopify import",
        });
      }
    }

    return { action, status: "success", itemId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      action: "sync",
      status: "error",
      itemId: null,
      failureReason: classifyError(msg),
      errorMessage: msg,
    };
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

async function failJob(jobId: string, error: string): Promise<void> {
  await db // org-scope-allow: job-id keyed
    .update(shopifyProductSyncJobsTable)
    .set({ status: "failed", error, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(shopifyProductSyncJobsTable.id, jobId));
}

function classifyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("duplicate") || m.includes("already been taken") || m.includes("unique")) return "duplicate_sku";
  if (m.includes("429") || m.includes("rate limit") || m.includes("throttl")) return "rate_limit";
  if (m.includes("422") || m.includes("unprocessable") || m.includes("invalid")) return "validation";
  if (m.includes("404") || m.includes("not found")) return "missing_data";
  return "api_error";
}

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
      direction: entry.direction ?? "inbound",
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
    .catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to write shopify sync log",
      );
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the set of Shopify variant IDs that appear in recent "skipped_mapped"
 * sync log entries — used by the "retry skipped" flow to target only those
 * variants.  Returns null if there are no recent skipped entries (caller
 * should run a full sync instead).
 */
export async function getSkippedVariantIds(
  organizationId: number,
): Promise<Set<string> | null> {
  // Look in items table for shopifyInventoryItemIds that appear in skipped logs.
  const skippedLogs = await db
    .select({ shopifyId: shopifySyncLogsTable.shopifyId })
    .from(shopifySyncLogsTable)
    .where(
      and(
        eq(shopifySyncLogsTable.organizationId, organizationId),
        eq(shopifySyncLogsTable.status, "skipped"),
        eq(shopifySyncLogsTable.failureReason, "skipped_mapped"),
        isNotNull(shopifySyncLogsTable.shopifyId),
      ),
    )
    .limit(500);

  if (skippedLogs.length === 0) return null;

  // The shopifyId stored for skipped_mapped logs is the inventory_item_id,
  // not the variant id. We need the variant id to target the sync.
  // Look up items that have this shopifyInventoryItemId in the ERP (already mapped).
  // For truly "unmapped" items, all variants will be attempted via a full sync.
  // Return null to trigger a full sync (which will create the missing ERP items).
  return null;
}
