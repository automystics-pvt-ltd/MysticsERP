import { bigserial, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

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
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("shopify_sync_logs_org_idx").on(t.organizationId),
    orgCreatedIdx: index("shopify_sync_logs_org_created_idx").on(t.organizationId, t.createdAt),
  }),
);

export type ShopifySyncLog = typeof shopifySyncLogsTable.$inferSelect;
