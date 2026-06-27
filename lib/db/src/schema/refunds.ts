import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { salesOrdersTable, salesOrderLinesTable } from "./salesOrders";
import { itemsTable } from "./items";
import { warehousesTable } from "./warehouses";

export const refundsTable = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    salesOrderId: integer("sales_order_id")
      .notNull()
      .references(() => salesOrdersTable.id, { onDelete: "cascade" }),
    refundNumber: text("refund_number").notNull(),
    refundDate: date("refund_date").notNull(),
    /**
     * Total money amount being refunded to the customer.
     */
    refundAmount: numeric("refund_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    /**
     * When true, the returned item quantities are added back into warehouse stock.
     */
    restockItems: boolean("restock_items").notNull().default(false),
    /**
     * Warehouse where restocked items are credited. Required when restockItems=true.
     */
    warehouseId: integer("warehouse_id").references(() => warehousesTable.id, {
      onDelete: "set null",
    }),
    /**
     * Why the refund was issued (customer-visible reason).
     */
    reason: text("reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgOrderIdx: index("refunds_org_order_idx").on(t.organizationId, t.salesOrderId),
    orgNumberIdx: uniqueIndex("refunds_org_number_idx").on(t.organizationId, t.refundNumber),
  }),
);

export const refundLinesTable = pgTable(
  "refund_lines",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    refundId: integer("refund_id")
      .notNull()
      .references(() => refundsTable.id, { onDelete: "cascade" }),
    salesOrderLineId: integer("sales_order_line_id")
      .notNull()
      .references(() => salesOrderLinesTable.id, { onDelete: "restrict" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => itemsTable.id, { onDelete: "restrict" }),
    /**
     * Quantity being returned/refunded for this line.
     */
    quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull(),
    /**
     * Money amount refunded for this line (informational).
     */
    refundAmount: numeric("refund_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
  },
  (t) => ({
    refundIdx: index("refund_lines_refund_idx").on(t.refundId),
    orgIdx: index("refund_lines_org_idx").on(t.organizationId),
  }),
);

export type Refund = typeof refundsTable.$inferSelect;
export type RefundLine = typeof refundLinesTable.$inferSelect;
