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
