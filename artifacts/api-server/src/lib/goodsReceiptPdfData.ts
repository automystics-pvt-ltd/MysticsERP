// Data-loading layer for the Goods Receipt Note PDF endpoint.
// Fetches the GRN, its parent PO, supplier, warehouse, and org in a
// single round-trip, then delegates rendering to goodsReceiptPdf.ts.

import { and, asc, eq } from "drizzle-orm";
import {
  db,
  goodsReceiptsTable,
  goodsReceiptLinesTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  suppliersTable,
  warehousesTable,
  itemsTable,
} from "@workspace/db";
import { loadOrgForPdf } from "./orgPdfHelpers";
import { renderGoodsReceiptPdf } from "./goodsReceiptPdf";
import { toNum } from "./numeric";

export interface LoadedGoodsReceiptPdf {
  pdf: Buffer;
  receiptNumber: string;
}

export async function loadGoodsReceiptPdf(
  organizationId: number,
  receiptId: number,
): Promise<LoadedGoodsReceiptPdf | { notFound: true }> {
  // Load GRN header + PO + supplier + warehouse in one query
  const rows = await db
    .select({
      receipt: goodsReceiptsTable,
      po: purchaseOrdersTable,
      supplier: suppliersTable,
      warehouse: warehousesTable,
    })
    .from(goodsReceiptsTable)
    .innerJoin(
      purchaseOrdersTable,
      and(
        eq(purchaseOrdersTable.id, goodsReceiptsTable.purchaseOrderId),
        eq(purchaseOrdersTable.organizationId, organizationId),
      ),
    )
    .innerJoin(
      suppliersTable,
      eq(suppliersTable.id, purchaseOrdersTable.supplierId),
    )
    .innerJoin(
      warehousesTable,
      eq(warehousesTable.id, purchaseOrdersTable.warehouseId),
    )
    .where(
      and(
        eq(goodsReceiptsTable.id, receiptId),
        eq(goodsReceiptsTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  const head = rows[0];
  if (!head) return { notFound: true };

  const orgBundle = await loadOrgForPdf(organizationId);
  if (!orgBundle) return { notFound: true };

  // Load GRN lines with the corresponding PO line quantities and item details
  const lineRows = await db
    .select({
      grLine: goodsReceiptLinesTable,
      poLine: purchaseOrderLinesTable,
      itemName: itemsTable.name,
      sku: itemsTable.sku,
    })
    .from(goodsReceiptLinesTable)
    .innerJoin(
      purchaseOrderLinesTable,
      eq(purchaseOrderLinesTable.id, goodsReceiptLinesTable.purchaseOrderLineId),
    )
    .innerJoin(itemsTable, eq(itemsTable.id, purchaseOrderLinesTable.itemId))
    .where(
      and(
        eq(goodsReceiptLinesTable.goodsReceiptId, receiptId),
        eq(goodsReceiptLinesTable.organizationId, organizationId),
      ),
    )
    .orderBy(asc(goodsReceiptLinesTable.id));

  const pdf = await renderGoodsReceiptPdf({
    org: orgBundle.docOrg,
    logoBuffer: orgBundle.logoBuffer,
    supplier: {
      name: head.supplier.name,
      gstNumber: head.supplier.gstNumber,
      phone: head.supplier.phone,
      email: head.supplier.email,
      address: head.supplier.address,
    },
    warehouseName: head.warehouse.name,
    receipt: {
      receiptNumber: head.receipt.receiptNumber,
      receivedDate: head.receipt.receivedDate,
      status: head.receipt.status,
      notes: head.receipt.notes,
    },
    po: {
      orderNumber: head.po.orderNumber,
      orderDate: head.po.orderDate,
    },
    lines: lineRows.map((r) => ({
      itemName: r.itemName,
      sku: r.sku,
      orderedQty: toNum(r.poLine.quantity),
      receivedQty: toNum(r.grLine.quantity),
    })),
  });

  return { pdf, receiptNumber: head.receipt.receiptNumber };
}
