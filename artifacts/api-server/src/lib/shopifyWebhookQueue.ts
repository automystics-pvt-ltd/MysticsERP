import { and, eq, lt, sql } from "drizzle-orm";
import { db, shopifyWebhookJobsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Async job queue for Shopify webhook processing.
 *
 * The webhook route calls `enqueueWebhookJob` after HMAC + dedup and returns
 * HTTP 200 to Shopify immediately. This worker polls the queue, claims jobs
 * with FOR UPDATE SKIP LOCKED (safe under concurrent workers), processes them
 * by calling the registered processor function, and schedules retries with
 * exponential backoff on failure.
 */

const POLL_INTERVAL_MS = 2_000;
const MAX_CONCURRENCY = 3;
const BASE_DELAY_MS = 10_000; // 10 s base, doubles each attempt
const MAX_DELAY_MS = 30 * 60 * 1000; // 30 min cap
const PROCESS_BOOT_AT = new Date();

function backoffMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

export async function enqueueWebhookJob(
  organizationId: number,
  topic: string,
  payload: Record<string, unknown>,
  shopifyWebhookId: string | null,
): Promise<void> {
  await db.insert(shopifyWebhookJobsTable).values({
    organizationId,
    topic,
    payload,
    shopifyWebhookId: shopifyWebhookId ?? null,
    status: "pending",
  });
}

// ── Claim ─────────────────────────────────────────────────────────────────────

interface RawJobRow {
  id: number;
  organization_id: number;
  topic: string;
  payload: Record<string, unknown>;
  shopify_webhook_id: string | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | string;
  last_error: string | null;
  processed_at: Date | string | null;
  created_at: Date | string;
}

/**
 * Atomically claim one pending job (set status → 'processing', bump
 * attempt_count). Uses FOR UPDATE SKIP LOCKED so multiple workers never
 * collide. Returns null when the queue is empty or all jobs are deferred.
 */
async function claimJob(): Promise<{
  id: number;
  organizationId: number;
  topic: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
} | null> {
  const result = await db.execute(sql`
    UPDATE shopify_webhook_jobs
    SET    status        = 'processing',
           attempt_count = attempt_count + 1,
           last_error    = NULL
    WHERE  id = (
      SELECT id
      FROM   shopify_webhook_jobs
      WHERE  status          = 'pending'
        AND  next_attempt_at <= NOW()
      ORDER  BY next_attempt_at ASC
      LIMIT  1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, topic, payload,
              attempt_count, max_attempts
  `); // org-scope-allow: queue worker — atomic job claim across all orgs; org stored on each row

  const raw = (result.rows?.[0] ?? null) as unknown as RawJobRow | null;
  if (!raw) return null;

  return {
    id:             Number(raw.id),
    organizationId: Number(raw.organization_id),
    topic:          String(raw.topic),
    payload:        raw.payload as Record<string, unknown>,
    attemptCount:   Number(raw.attempt_count),
    maxAttempts:    Number(raw.max_attempts),
  };
}

// ── Status updates ────────────────────────────────────────────────────────────

async function markDone(id: number): Promise<void> {
  await db
    // org-scope-allow: webhook job — update by server-generated PK; org fixed at insert
    .update(shopifyWebhookJobsTable)
    .set({ status: "done", processedAt: new Date() })
    .where(eq(shopifyWebhookJobsTable.id, id));
}

async function markRetryOrFailed(
  id: number,
  attemptCount: number,
  maxAttempts: number,
  errorMsg: string,
): Promise<void> {
  if (attemptCount >= maxAttempts) {
    await db
      // org-scope-allow: webhook job — update by server-generated PK
      .update(shopifyWebhookJobsTable)
      .set({ status: "failed", lastError: errorMsg, processedAt: new Date() })
      .where(eq(shopifyWebhookJobsTable.id, id));
  } else {
    const nextAt = new Date(Date.now() + backoffMs(attemptCount));
    await db
      // org-scope-allow: webhook job — update by server-generated PK
      .update(shopifyWebhookJobsTable)
      .set({ status: "pending", lastError: errorMsg, nextAttemptAt: nextAt })
      .where(eq(shopifyWebhookJobsTable.id, id));
  }
}

// ── Worker ────────────────────────────────────────────────────────────────────

export type WebhookProcessor = (
  orgId: number,
  topic: string,
  body: Record<string, unknown>,
) => Promise<void>;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let registeredProcessor: WebhookProcessor | null = null;
let inFlight = 0;

async function pollAndProcess(): Promise<void> {
  if (!registeredProcessor) return;
  if (inFlight >= MAX_CONCURRENCY) return;

  const job = await claimJob().catch((err) => {
    logger.warn({ err }, "shopify webhook queue: job claim error");
    return null;
  });
  if (!job) return;

  inFlight++;
  void (async () => {
    try {
      await registeredProcessor!(job.organizationId, job.topic, job.payload);
      await markDone(job.id);
      logger.info(
        { orgId: job.organizationId, topic: job.topic, attempt: job.attemptCount },
        "shopify webhook job: processed successfully",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, orgId: job.organizationId, topic: job.topic, attempt: job.attemptCount },
        "shopify webhook job: processing failed, scheduling retry",
      );
      await markRetryOrFailed(job.id, job.attemptCount, job.maxAttempts, msg).catch(
        () => undefined,
      );
    } finally {
      inFlight--;
    }
  })();
}

/**
 * Start the background worker. The `processFn` is called for each claimed
 * job. Pass the `processWebhookTopic` export from `shopifyWebhook.ts` here
 * to avoid a circular import.
 */
export function startWebhookWorker(processFn: WebhookProcessor): void {
  if (workerTimer) return; // already running
  registeredProcessor = processFn;
  workerTimer = setInterval(() => {
    void pollAndProcess().catch((err) =>
      logger.warn({ err }, "shopify webhook queue: poll error"),
    );
  }, POLL_INTERVAL_MS);
  workerTimer.unref?.();
  logger.info("shopify webhook queue worker started (poll every 2 s, concurrency 3)");
}

export function stopWebhookWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  registeredProcessor = null;
}

/**
 * On startup, reset any job left in 'processing' — those are orphans from
 * a crashed process. Reset to 'pending' so they are retried immediately.
 */
export async function reconcileOrphanedWebhookJobs(): Promise<void> {
  const count = await db
    // org-scope-allow: startup recovery — status-only fixup across all orgs
    .update(shopifyWebhookJobsTable)
    .set({ status: "pending", nextAttemptAt: new Date() })
    .where(
      and(
        eq(shopifyWebhookJobsTable.status, "processing"),
        lt(shopifyWebhookJobsTable.createdAt, PROCESS_BOOT_AT),
      ),
    );
  if (typeof (count as { rowCount?: number }).rowCount === "number" &&
      (count as { rowCount?: number }).rowCount! > 0) {
    logger.info(
      { count: (count as { rowCount?: number }).rowCount },
      "shopify webhook queue: orphaned processing jobs reset to pending",
    );
  }
}

/**
 * Prune completed/failed jobs older than 24 hours to keep the table small.
 * Called on a periodic timer from startWebhookWorker.
 */
export async function pruneOldWebhookJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    // org-scope-allow: retention GC of finished jobs across all orgs
    .delete(shopifyWebhookJobsTable)
    .where(
      and(
        eq(shopifyWebhookJobsTable.status, "done"),
        lt(shopifyWebhookJobsTable.createdAt, cutoff),
      ),
    );
}
