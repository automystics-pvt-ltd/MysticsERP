import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { itemsTable } from "./items";
import { warehousesTable } from "./warehouses";
import { usersTable } from "./users";

export const stagedWriteOffsTable = pgTable(
  "staged_write_offs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => itemsTable.id, { onDelete: "restrict" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    movementType: text("movement_type").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("pending_approval"),
    approvalRequestId: integer("approval_request_id"),
    submittedById: integer("submitted_by_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgStatusIdx: index("staged_write_offs_org_status_idx").on(
      t.organizationId,
      t.status,
    ),
  }),
);

export type StagedWriteOff = typeof stagedWriteOffsTable.$inferSelect;
