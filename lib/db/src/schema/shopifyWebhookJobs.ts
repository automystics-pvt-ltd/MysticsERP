import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Async job queue for Shopify webhook processing.
 *
 * The webhook route inserts one row per delivery (after HMAC + dedup) and
 * returns HTTP 200 to Shopify immediately. A background worker polls this
 * table, claims jobs atomically with FOR UPDATE SKIP LOCKED, calls the
 * processor, and schedules retries with exponential backoff on failure.
 *
 * This eliminates the synchronous processing that caused ~63% webhook
 * failures by exceeding Shopify's 5-second delivery timeout.
 */
export const shopifyWebhookJobsTable = pgTable(
  "shopify_webhook_jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    shopifyWebhookId: text("shopify_webhook_id"),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pendingIdx: index("shopify_webhook_jobs_pending_idx").on(
      t.status,
      t.nextAttemptAt,
    ),
    orgIdx: index("shopify_webhook_jobs_org_idx").on(t.organizationId),
  }),
);

export type ShopifyWebhookJobRow = typeof shopifyWebhookJobsTable.$inferSelect;
