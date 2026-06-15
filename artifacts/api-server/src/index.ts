import app from "./app";
import { logger } from "./lib/logger";
import { ensureSessionTable } from "./lib/sessions";
import { startShiprocketSyncScheduler } from "./lib/shiprocketSync";
import {
  recoverInFlightBulkBatches,
  startBulkBatchPruneScheduler,
} from "./routes/einvoice";
import { reconcileOrphanedImportJobs } from "./lib/shopifyImportJobs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Ensure the session table exists before accepting any requests.
// This is blocking by design — a missing session table means every
// login fails, so we must not start listening until it's guaranteed.
await ensureSessionTable().catch((err) => {
  logger.error({ err }, "Failed to ensure session table — aborting startup");
  process.exit(1);
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Arm the daily Shiprocket tracking sweep. The scheduler is a
  // simple in-process timer; on multi-instance deployments only one
  // replica should run it (set SHIPROCKET_SYNC_DISABLED=1 on the
  // others). Set the same env var to skip it during local dev/tests.
  startShiprocketSyncScheduler();

  // Resume any e-invoice bulk batches that were mid-flight when the
  // previous process exited (deploy, crash, workflow restart). The
  // worker is fire-and-forget — listen() has already returned so
  // the resumption can take its time without blocking startup.
  void recoverInFlightBulkBatches().catch((err) => {
    logger.error({ err }, "einvoice: bulk batch recovery failed");
  });

  // Any historical Shopify import left "running" is an orphan from a
  // process that died mid-import — flip it to "failed" so the UI stops
  // polling and the merchant can retry the orders that failed.
  void reconcileOrphanedImportJobs().catch((err) => {
    logger.error({ err }, "shopify: import job recovery failed");
  });
  // Periodic prune of expired bulk batch rows. Idempotent and cheap;
  // unref'd so it never holds the event loop open by itself.
  startBulkBatchPruneScheduler();
});
