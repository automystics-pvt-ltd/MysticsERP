import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  date,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { customersTable } from "./customers";
import { warehousesTable } from "./warehouses";
import { itemsTable } from "./items";
import { posSessionsTable } from "./posSessions";

export const salesOrdersTable = pgTable(
  "sales_orders",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "restrict" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    expectedShipDate: date("expected_ship_date"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    balanceDue: numeric("balance_due", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    notes: text("notes"),
    stockAppliedAt: timestamp("stock_applied_at", { withTimezone: true }),
    shopifyOrderId: text("shopify_order_id"),
    externalReference: text("external_reference"),
    paymentStatus: text("payment_status"),
    // ── E-way bill (NIC EWB) ──────────────────────────────────────────
    // Populated when an EWB has been generated for this order. Status
    // values: null (not generated), "active", "cancelled". Expiry is
    // derived at read time by comparing ewbValidUntil to now.
    ewbNumber: text("ewb_number"),
    ewbDate: timestamp("ewb_date", { withTimezone: true }),
    ewbValidUntil: timestamp("ewb_valid_until", { withTimezone: true }),
    ewbStatus: text("ewb_status"),
    ewbQrPayload: text("ewb_qr_payload"),
    ewbVehicleNumber: text("ewb_vehicle_number"),
    ewbTransportMode: text("ewb_transport_mode"),
    ewbTransporterName: text("ewb_transporter_name"),
    ewbTransporterId: text("ewb_transporter_id"),
    ewbDistanceKm: integer("ewb_distance_km"),
    ewbDispatchAddress: jsonb("ewb_dispatch_address"),
    ewbShipToAddress: jsonb("ewb_ship_to_address"),
    ewbCancelledAt: timestamp("ewb_cancelled_at", { withTimezone: true }),
    ewbCancelReason: text("ewb_cancel_reason"),
    // ── E-invoice (IRP) ───────────────────────────────────────────────
    // Populated when an IRN (Invoice Reference Number) has been issued
    // by the Invoice Registration Portal for this order. Status
    // values: null (not yet attempted / not eligible), "pending" (in
    // flight), "active", "cancelled", "failed". The signed QR payload
    // is the opaque base64 string the IRP returns; we render it as a
    // QR image on the invoice PDF. irpError carries the most recent
    // failure message so the UI can surface a Retry action.
    irn: text("irn"),
    irpAckNumber: text("irp_ack_number"),
    irpAckDate: timestamp("irp_ack_date", { withTimezone: true }),
    irpQrPayload: text("irp_qr_payload"),
    irpStatus: text("irp_status"),
    irpError: text("irp_error"),
    // Machine-readable identifier for the most recent IRP failure
    // (e.g. "missing_buyer_gstin", "invalid_hsn"). Used by the
    // UI to render a structured "What to fix" panel that points
    // the operator at the right edit screen instead of forcing
    // them to parse a free-text error message.
    irpErrorCode: text("irp_error_code"),
    // Optional structured context for the most recent IRP failure.
    // For per-line errors (invalid_hsn) this carries `{ itemId }`
    // so the UI can deep-link to the item that needs fixing.
    irpErrorContext: jsonb("irp_error_context"),
    irpCancelledAt: timestamp("irp_cancelled_at", { withTimezone: true }),
    irpCancelReason: text("irp_cancel_reason"),
    // POS session FK — set at checkout so the per-session reconciliation
    // report can query by session instead of time-window + warehouse.
    // Nullable so regular (non-POS) sales orders and legacy POS orders
    // (created before this column existed) are unaffected.
    posSessionId: integer("pos_session_id").references(() => posSessionsTable.id, {
      onDelete: "set null",
    }),
    /**
     * Free-text payment terms set by the operator (e.g. "Net 30", "Cash on Delivery",
     * "Advance", "Due on receipt"). Informational only — does not affect payment tracking.
     */
    paymentTerms: text("payment_terms"),
    /**
     * Payment method used by the customer (e.g. "Cash", "Bank Transfer", "UPI", "Cheque").
     * Informational — does not affect accounting; edited via PATCH /sales-orders/:id/payment-meta.
     */
    paymentMethod: text("payment_method"),
    /**
     * Payment reference / transaction ID (e.g. UTR, cheque number, UPI reference).
     * Informational — edited via PATCH /sales-orders/:id/payment-meta.
     */
    paymentReference: text("payment_reference"),
    /** Shipping method name synced from Shopify (e.g. "Standard Shipping"). */
    deliveryMethod: text("delivery_method"),
    /**
     * Shopify fulfillment_status value, stored verbatim so the UI can show
     * Shopify's own labels (unfulfilled / partial / fulfilled / in_progress /
     * on_hold / scheduled) separately from the ERP's internal order status.
     * Null for non-Shopify orders.
     */
    shopifyFulfillmentStatus: text("shopify_fulfillment_status"),
    /**
     * Order-level tax-line breakdown from Shopify, stored as a JSON array so
     * the UI can render each tax component (CGST, SGST, IGST, etc.) with its
     * title, rate, price, and whether it is included in the price.
     * Shape: Array<{ title: string; rate: number; price: string; channel_liable?: boolean }>
     * Null for non-Shopify orders or orders with no tax lines.
     */
    shopifyTaxLines: jsonb("shopify_tax_lines"),
    /**
     * True when Shopify reports taxes_included=true — the unit prices already
     * contain the tax component, so taxTotal must NOT be added to subtotal to
     * get the customer-facing total.  Null / false for non-Shopify orders.
     */
    taxesIncluded: boolean("taxes_included").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgNumber:      uniqueIndex("sales_orders_org_number_idx").on(t.organizationId, t.orderNumber),
    orgShopifyOrder: uniqueIndex("sales_orders_org_shopify_order_idx").on(t.organizationId, t.shopifyOrderId),
    posSessionIdx:  index("sales_orders_pos_session_idx").on(t.posSessionId),
    // Filtering & sorting indexes
    orgStatusIdx:   index("sales_orders_org_status_idx").on(t.organizationId, t.status),
    orgCustomerIdx: index("sales_orders_org_customer_idx").on(t.organizationId, t.customerId),
    orgDateIdx:     index("sales_orders_org_date_idx").on(t.organizationId, t.orderDate),
    orgCreatedIdx:  index("sales_orders_org_created_idx").on(t.organizationId, t.createdAt),
  }),
);

export const salesOrderLinesTable = pgTable("sales_order_lines", {
  id: serial("id").primaryKey(),
  salesOrderId: integer("sales_order_id")
    .notNull()
    .references(() => salesOrdersTable.id, { onDelete: "cascade" }),
  itemId: integer("item_id")
    .notNull()
    .references(() => itemsTable.id, { onDelete: "restrict" }),
  description: text("description"),
  quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull(),
  quantityShipped: numeric("quantity_shipped", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  taxRate: numeric("tax_rate", { precision: 6, scale: 2 }).notNull().default("0"),
  // Per-line discount applied before tax. `discountPercent` is what the
  // operator entered (0-100); `discountAmount` is the resolved money
  // value subtracted from (qty * unitPrice). If the operator entered a
  // flat amount instead of a percent, `discountPercent` stays 0 and
  // only `discountAmount` carries the discount. lineSubtotal already
  // reflects the post-discount value.
  discountPercent: numeric("discount_percent", { precision: 6, scale: 2 })
    .notNull()
    .default("0"),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  lineSubtotal: numeric("line_subtotal", { precision: 14, scale: 2 }).notNull(),
  lineTax: numeric("line_tax", { precision: 14, scale: 2 }).notNull(),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
}, (t) => ({
  // Most-critical access patterns: fetch all lines for one order (every
  // order detail page load), and scan all lines for one item (reports).
  orderIdx: index("sales_order_lines_order_idx").on(t.salesOrderId),
  itemIdx:  index("sales_order_lines_item_idx").on(t.itemId),
}));

export type SalesOrder = typeof salesOrdersTable.$inferSelect;
export type SalesOrderLine = typeof salesOrderLinesTable.$inferSelect;
