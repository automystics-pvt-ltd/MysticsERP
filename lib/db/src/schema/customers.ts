import { pgTable, serial, integer, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  gstNumber: text("gst_number"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  placeOfSupply: text("place_of_supply"),
  notes: text("notes"),
  outstandingBalance: numeric("outstanding_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  shopifyCustomerId: text("shopify_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
},
(t) => ({
  orgIdx:       index("customers_org_idx").on(t.organizationId),
  orgCreatedIdx: index("customers_org_created_idx").on(t.organizationId, t.createdAt),
  orgNameIdx:   index("customers_org_name_idx").on(t.organizationId, t.name),
}));

export type Customer = typeof customersTable.$inferSelect;
