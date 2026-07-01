import {
  pgTable,
  varchar,
  integer,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Persisted state for background Shopify product sync jobs.
 *
 * POST /shopify/sync kicks one off and returns { jobId }; the frontend
 * polls GET /shopify/product-sync-job/latest (or /:id) for live progress.
 *
 * cancelSignal / pauseSignal are written by control routes and checked by
 * the worker every N items so the job can be safely interrupted without
 * killing the process.
 */
export const shopifyProductSyncJobsTable = pgTable(
  "shopify_product_sync_jobs",
  {
    id: varchar("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    /** running | paused | cancelled | completed | completed_with_errors | failed */
    status: text("status").notNull().default("running"),
    /** Total leaf-variant count fetched from Shopify (known after first fetch). */
    totalShopify: integer("total_shopify"),
    /** ERP items with a shopifyVariantId mapping at the time sync started. */
    totalErp: integer("total_erp"),
    /** Leaf variants processed so far (created + updated + skipped + failed). */
    processed: integer("processed").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    /**
     * ERP items whose shopifyVariantId no longer appears in the current
     * Shopify catalog — computed once at job completion.
     */
    missing: integer("missing").notNull().default(0),
    /** Set by the cancel route; checked by the worker each poll interval. */
    cancelSignal: boolean("cancel_signal").notNull().default(false),
    /** Set by the pause route; cleared by the resume route. */
    pauseSignal: boolean("pause_signal").notNull().default(false),
    /** Top-level error message when status === "failed". */
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Refreshed on every progress flush so ETA can be computed client-side. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Who triggered this sync (recorded at start time). */
    triggeredByName: text("triggered_by_name"),
    triggeredByEmail: text("triggered_by_email"),
    triggeredByIp: text("triggered_by_ip"),
    triggeredByLocation: text("triggered_by_location"),
  },
  (t) => ({
    orgIdx: index("shopify_product_sync_jobs_org_idx").on(t.organizationId),
    orgStartedIdx: index("shopify_product_sync_jobs_org_started_idx").on(
      t.organizationId,
      t.startedAt,
    ),
  }),
);

export type ShopifyProductSyncJob =
  typeof shopifyProductSyncJobsTable.$inferSelect;
