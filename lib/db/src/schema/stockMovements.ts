import { pgTable, serial, integer, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { itemsTable } from "./items";
import { warehousesTable } from "./warehouses";

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  itemId: integer("item_id")
    .notNull()
    .references(() => itemsTable.id, { onDelete: "cascade" }),
  warehouseId: integer("warehouse_id")
    .notNull()
    .references(() => warehousesTable.id, { onDelete: "cascade" }),
  movementType: text("movement_type").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull(),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
(t) => ({
  orgItemIdx:      index("stock_movements_org_item_idx").on(t.organizationId, t.itemId),
  orgWarehouseIdx: index("stock_movements_org_warehouse_idx").on(t.organizationId, t.warehouseId),
  orgTypeIdx:      index("stock_movements_org_type_idx").on(t.organizationId, t.movementType),
  orgRefIdx:       index("stock_movements_org_ref_idx").on(t.organizationId, t.referenceType, t.referenceId),
  orgCreatedIdx:   index("stock_movements_org_created_idx").on(t.organizationId, t.createdAt),
}));

export type StockMovement = typeof stockMovementsTable.$inferSelect;
