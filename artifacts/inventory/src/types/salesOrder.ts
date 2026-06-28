import { z } from "zod/v4";
import type { PaymentBreakdownEntry, Shipment, ShipmentLine, Refund } from "@workspace/api-client-react";

export type PaymentEntry = {
  kind: "payment";
  date: string;
  paymentId: number;
  mode: string;
  referenceNumber: string | null;
  amount: number;
};

export type ReversalEntry = {
  kind: "reversal";
  date: string;
  shipmentNumber: string;
  warehouseName: string;
  items: Array<{ itemName: string; sku: string; quantity: number }>;
};

export type RefundEntry = {
  kind: "refund";
  date: string;
  refundId: number;
  refundNumber: string;
  refundType: "full" | "partial" | "item_wise";
  amount: number;
  reason: string | null;
  restockItems: boolean;
};

export type TimelineEntry = PaymentEntry | ReversalEntry | RefundEntry;

// ---------------------------------------------------------------------------
// Zod schemas anchored to the generated API types via `satisfies`.
//
// Each schema picks only the fields that the UI actually reads from the API
// response.  The `satisfies z.ZodType<Pick<GeneratedInterface, ...>>` clause
// is intentional: if the OpenAPI spec renames a field (e.g. `refundAmount`
// → `amount`) and codegen regenerates the TypeScript interface, TypeScript
// will flag the mismatch HERE at compile time rather than letting it silently
// produce `undefined` in the UI.  At runtime, `z.parse` will throw when
// the live response doesn't match.
// ---------------------------------------------------------------------------

export const apiPaymentBreakdownEntrySchema = z.object({
  paymentId: z.number(),
  mode: z.string(),
  referenceNumber: z.string().nullable(),
  paymentDate: z.string().nullable(),
  amount: z.number(),
}) satisfies z.ZodType<Pick<PaymentBreakdownEntry, "paymentId" | "mode" | "referenceNumber" | "paymentDate" | "amount">>;

export const apiShipmentLineSchema = z.object({
  itemName: z.string(),
  sku: z.string(),
  quantity: z.number(),
}) satisfies z.ZodType<Pick<ShipmentLine, "itemName" | "sku" | "quantity">>;

export const apiShipmentForReversalSchema = z.object({
  status: z.string(),
  shipmentNumber: z.string(),
  cancelledAt: z.string().nullable(),
  lines: z.array(apiShipmentLineSchema),
}) satisfies z.ZodType<Pick<Shipment, "status" | "shipmentNumber" | "cancelledAt"> & { lines: Array<Pick<ShipmentLine, "itemName" | "sku" | "quantity">> }>;

export const apiRefundSchema = z.object({
  id: z.number(),
  refundNumber: z.string(),
  refundType: z.enum(["full", "partial", "item_wise"]),
  refundAmount: z.number(),
  restockItems: z.boolean(),
  reason: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<Pick<Refund, "id" | "refundNumber" | "refundType" | "refundAmount" | "restockItems" | "reason" | "createdAt">>;

// ---------------------------------------------------------------------------
// Mapper functions — parse the raw API shape and return a TimelineEntry.
// Keeping the mapping logic here (alongside the schemas) means both the
// validation and the field-mapping stay in sync in one place.
// ---------------------------------------------------------------------------

export function mapPaymentToEntry(
  raw: z.infer<typeof apiPaymentBreakdownEntrySchema>,
): PaymentEntry {
  return {
    kind: "payment",
    date: raw.paymentDate ?? "",
    paymentId: raw.paymentId,
    mode: raw.mode,
    referenceNumber: raw.referenceNumber,
    amount: raw.amount,
  };
}

export function mapShipmentToReversalEntry(
  raw: z.infer<typeof apiShipmentForReversalSchema>,
  warehouseName: string,
): ReversalEntry | null {
  if (raw.status !== "cancelled" || !raw.cancelledAt) return null;
  return {
    kind: "reversal",
    date: raw.cancelledAt,
    shipmentNumber: raw.shipmentNumber,
    warehouseName,
    items: raw.lines.map((l) => ({
      itemName: l.itemName,
      sku: l.sku,
      quantity: l.quantity,
    })),
  };
}

export function mapRefundToEntry(raw: z.infer<typeof apiRefundSchema>): RefundEntry {
  return {
    kind: "refund",
    date: raw.createdAt,
    refundId: raw.id,
    refundNumber: raw.refundNumber,
    refundType: raw.refundType,
    amount: raw.refundAmount,
    reason: raw.reason,
    restockItems: raw.restockItems,
  };
}
