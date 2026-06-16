import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { salesOrdersTable, salesOrderLinesTable } from "./salesOrders";
import { warehousesTable } from "./warehouses";
import { itemsTable } from "./items";
import { shipmentsTable } from "./shipments";

/**
 * A fulfillment represents the 3-step operational workflow for shipping
 * a sales order: Pick → Pack → Dispatch.
 *
 * Status flow:
 *   picking  – lines created, staff is scanning / entering quantities
 *   picked   – all quantities confirmed; stock has been deducted and a
 *              shipment record created (fulfillment.shipmentId is set)
 *   packed   – physical packing confirmed; awaiting dispatch
 *   dispatched – AWB / courier recorded; Shopify order updated
 */
export const fulfillmentsTable = pgTable(
  "fulfillments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    salesOrderId: integer("sales_order_id")
      .notNull()
      .references(() => salesOrdersTable.id, { onDelete: "cascade" }),
    /** Linked after confirm-pick (when stock is actually deducted). */
    shipmentId: integer("shipment_id").references(() => shipmentsTable.id, {
      onDelete: "set null",
    }),
    /** FULFIL-YYMMDD-NNNN */
    fulfillmentNumber: text("fulfillment_number").notNull(),
    status: text("status").notNull().default("picking"),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    /** Courier name entered at dispatch (e.g. "Delhivery", "Bluedart"). */
    courierName: text("courier_name"),
    /** Airway bill / tracking number entered at dispatch. */
    awbNumber: text("awb_number"),
    trackingUrl: text("tracking_url"),
    notes: text("notes"),
    pickedAt: timestamp("picked_at", { withTimezone: true }),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgNumberIdx: uniqueIndex("fulfillments_org_number_idx").on(
      t.organizationId,
      t.fulfillmentNumber,
    ),
    orgOrderIdx: index("fulfillments_org_order_idx").on(
      t.organizationId,
      t.salesOrderId,
    ),
    orgStatusIdx: index("fulfillments_org_status_idx").on(
      t.organizationId,
      t.status,
    ),
  }),
);

/**
 * One row per sales-order line included in the fulfillment.
 * quantityPicked starts at 0 and is updated as the picker scans items.
 */
export const fulfillmentLinesTable = pgTable(
  "fulfillment_lines",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    fulfillmentId: integer("fulfillment_id")
      .notNull()
      .references(() => fulfillmentsTable.id, { onDelete: "cascade" }),
    salesOrderLineId: integer("sales_order_line_id")
      .notNull()
      .references(() => salesOrderLinesTable.id, { onDelete: "restrict" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => itemsTable.id, { onDelete: "restrict" }),
    /** Ordered quantity remaining to be shipped on this line. */
    quantityRequired: numeric("quantity_required", {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** How many the picker has confirmed. Starts at 0. */
    quantityPicked: numeric("quantity_picked", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
  },
  (t) => ({
    fulfillmentIdx: index("fulfillment_lines_fulfillment_idx").on(
      t.fulfillmentId,
    ),
    orgLineIdx: index("fulfillment_lines_org_line_idx").on(
      t.organizationId,
      t.salesOrderLineId,
    ),
  }),
);

export type Fulfillment = typeof fulfillmentsTable.$inferSelect;
export type FulfillmentLine = typeof fulfillmentLinesTable.$inferSelect;
