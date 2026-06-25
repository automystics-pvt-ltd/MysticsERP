import { bigserial, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { itemsTable } from "./items";

export const shopifySyncLogsTable = pgTable(
  "shopify_sync_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // "inbound" | "outbound"
    entity: text("entity").notNull(),       // "product" | "customer" | "order" | "inventory" | "payment"
    action: text("action").notNull(),       // "create" | "update" | "delete" | "sync"
    status: text("status").notNull(),       // "success" | "error" | "skipped"
    shopifyId: text("shopify_id"),
    erpId: text("erp_id"),
    sku: text("sku"),
    name: text("name"),
    parentItemId: integer("parent_item_id").references(() => itemsTable.id, { onDelete: "set null" }),
    failureReason: text("failure_reason"), // "validation" | "api_error" | "missing_data" | "duplicate_sku" | "rate_limit" | "skipped_bundle" | "skipped_parent" | "skipped_mapped" | "skipped_no_connection"
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("shopify_sync_logs_org_idx").on(t.organizationId),
    orgCreatedIdx: index("shopify_sync_logs_org_created_idx").on(t.organizationId, t.createdAt),
    orgStatusIdx: index("shopify_sync_logs_org_status_idx").on(t.organizationId, t.status),
  }),
);

export type ShopifySyncLog = typeof shopifySyncLogsTable.$inferSelect;
