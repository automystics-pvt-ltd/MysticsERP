export interface FulfillmentLine {
  id: number;
  fulfillmentId: number;
  salesOrderLineId: number;
  itemId: number;
  itemName: string;
  sku: string;
  barcode: string | null;
  quantityRequired: number;
  quantityPicked: number;
  stockAvailable: number | null;
}

export interface Fulfillment {
  id: number;
  fulfillmentNumber: string;
  salesOrderId: number;
  orderNumber: string;
  shopifyOrderId: string | null;
  shopifyFulfillmentId: string | null;
  shipmentId: number | null;
  status: string;
  warehouseId: number;
  warehouseName: string;
  courierName: string | null;
  awbNumber: string | null;
  trackingUrl: string | null;
  notes: string | null;
  pickedAt: string | null;
  packedAt: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: FulfillmentLine[];
}

export interface ScanRecord {
  id: number;
  scannedCode: string;
  result: string;
  itemName: string | null;
  sku: string | null;
  fulfillmentLineId: number | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  createdAt: string;
}
