import { pgTable, serial, integer, text, numeric, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  gstNumber: text("gst_number"),
  address: text("address"),
  notes: text("notes"),
  outstandingPayable: numeric("outstanding_payable", { precision: 14, scale: 2 }).notNull().default("0"),
  // True when this supplier is also a job worker / outsourcing partner
  // (textile printer, embroiderer, cut-and-sew unit, etc.). The job work
  // module surfaces these in its vendor picker and creates a dedicated
  // virtual warehouse the first time we issue raw material to them.
  isJobWorker: boolean("is_job_worker").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
},
(t) => ({
  orgIdx:       index("suppliers_org_idx").on(t.organizationId),
  orgCreatedIdx: index("suppliers_org_created_idx").on(t.organizationId, t.createdAt),
  orgNameIdx:   index("suppliers_org_name_idx").on(t.organizationId, t.name),
}));

export type Supplier = typeof suppliersTable.$inferSelect;
