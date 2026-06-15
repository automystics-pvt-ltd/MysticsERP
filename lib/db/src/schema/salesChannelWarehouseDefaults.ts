import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { warehousesTable } from "./warehouses";

export const salesChannelWarehouseDefaultsTable = pgTable(
  "sales_channel_warehouse_defaults",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    salesChannel: text("sales_channel").notNull(),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgChannelWh: uniqueIndex("sales_channel_defaults_org_channel_wh_idx").on(
      t.organizationId,
      t.salesChannel,
      t.warehouseId,
    ),
  }),
);

export type SalesChannelWarehouseDefault = typeof salesChannelWarehouseDefaultsTable.$inferSelect;
