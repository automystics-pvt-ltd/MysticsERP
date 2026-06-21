export * from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react";
import type { Item } from "@workspace/api-client-react";

// ─── Items paginated ────────────────────────────────────────────────────────

export interface ItemsPage {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ItemsFacets {
  categories: string[];
  brands: string[];
  units: string[];
}

export async function fetchItemsPaginated(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  excludeVariants?: boolean;
  includeWarehouseBreakdown?: boolean;
  warehouseId?: number;
  parentItemId?: number;
  category?: string;
  brand?: string;
  priceMin?: number;
  priceMax?: number;
  stockFilter?: string;
  leafOnly?: boolean;
}): Promise<ItemsPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page ?? 1));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  if (params.excludeVariants) qs.set("excludeVariants", "true");
  if (params.includeWarehouseBreakdown) qs.set("includeWarehouseBreakdown", "true");
  if (params.warehouseId) qs.set("warehouseId", String(params.warehouseId));
  if (params.parentItemId) qs.set("parentItemId", String(params.parentItemId));
  if (params.category) qs.set("category", params.category);
  if (params.brand) qs.set("brand", params.brand);
  if (params.priceMin !== undefined) qs.set("priceMin", String(params.priceMin));
  if (params.priceMax !== undefined) qs.set("priceMax", String(params.priceMax));
  if (params.stockFilter) qs.set("stockFilter", params.stockFilter);
  if (params.leafOnly) qs.set("leafOnly", "true");
  return customFetch<ItemsPage>(`/api/items?${qs}`);
}

export async function fetchItemsFacets(): Promise<ItemsFacets> {
  return customFetch<ItemsFacets>("/api/items/facets");
}

export async function fetchItemVariants(
  parentItemId: number,
  opts?: { warehouseId?: number },
): Promise<Item[]> {
  const qs = new URLSearchParams();
  qs.set("parentItemId", String(parentItemId));
  qs.set("includeWarehouseBreakdown", "true");
  if (opts?.warehouseId != null) qs.set("warehouseId", String(opts.warehouseId));
  return customFetch<Item[]>(`/api/items?${qs}`);
}

export interface WarehouseStockSummary {
  warehouseId: number;
  totalItems: number;
  totalUnits: number;
  pendingInUnits: number;
  pendingOutUnits: number;
}

export async function fetchWarehouseStockSummaries(): Promise<WarehouseStockSummary[]> {
  return customFetch<WarehouseStockSummary[]>("/api/warehouses/stock-summaries");
}

export interface WarehouseStockItem {
  itemId: number;
  itemName: string;
  itemSku: string | null;
  category: string | null;
  availableQty: string;
  reorderLevel: string | null;
  isBundle: boolean;
  hasVariants: boolean;
}

export interface WarehouseStockPage {
  items: WarehouseStockItem[];
  categories: string[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchWarehouseStock(
  warehouseId: number,
  params?: { search?: string; category?: string; page?: number; pageSize?: number },
): Promise<WarehouseStockPage> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.category) qs.set("category", params.category);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  return customFetch<WarehouseStockPage>(`/api/warehouses/${warehouseId}/stock?${qs}`);
}

// ─── Paginated stock movements ─────────────────────────────────────────────────

export interface StockMovementsPage {
  movements: import("@workspace/api-client-react").StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchStockMovementsPaginated(params: {
  page: number;
  pageSize: number;
  itemId?: number;
  warehouseId?: number;
  movementTypes?: string[];
  movementType?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<StockMovementsPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  if (params.itemId) qs.set("itemId", String(params.itemId));
  if (params.warehouseId) qs.set("warehouseId", String(params.warehouseId));
  if (params.movementTypes?.length) qs.set("movementTypes", params.movementTypes.join(","));
  if (params.movementType) qs.set("movementTypes", params.movementType);
  if (params.search) qs.set("search", params.search);
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);
  return customFetch<StockMovementsPage>(`/api/stock-movements?${qs}`);
}

// Fetches ALL write-off movements (no pagination) for stats + table.
// Uses the movementTypes filter to avoid pulling the full ledger.
export async function fetchWriteOffMovements(params: {
  warehouseId?: number;
}): Promise<import("@workspace/api-client-react").StockMovement[]> {
  const WRITE_OFF_TYPES = ["damage", "expired", "lost", "theft", "adjustment"];
  const qs = new URLSearchParams();
  qs.set("movementTypes", WRITE_OFF_TYPES.join(","));
  if (params.warehouseId) qs.set("warehouseId", String(params.warehouseId));
  return customFetch<import("@workspace/api-client-react").StockMovement[]>(
    `/api/stock-movements?${qs}`,
  );
}

// ─── Paginated stock transfers ──────────────────────────────────────────────────

export interface StockTransfersPage {
  transfers: import("@workspace/api-client-react").StockTransfer[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchStockTransfersPaginated(params: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  warehouseId?: number;
  fromDate?: string;
  toDate?: string;
}): Promise<StockTransfersPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.warehouseId) qs.set("warehouseId", String(params.warehouseId));
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);
  return customFetch<StockTransfersPage>(`/api/stock-transfers?${qs}`);
}

// ─── Paginated sales orders ─────────────────────────────────────────────────

export interface SalesOrdersPage {
  orders: import("@workspace/api-client-react").SalesOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchSalesOrdersPaginated(params: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  orderType?: string;
  from?: string;
  to?: string;
  customerId?: number;
  channel?: string;
  sortBy?: string;
  sortDir?: string;
  overdue?: boolean;
}): Promise<SalesOrdersPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.orderType) qs.set("orderType", params.orderType);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.customerId) qs.set("customerId", String(params.customerId));
  if (params.channel) qs.set("channel", params.channel);
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDir) qs.set("sortDir", params.sortDir);
  if (params.overdue) qs.set("overdue", "true");
  return customFetch<SalesOrdersPage>(`/api/sales-orders?${qs}`);
}

// ─── Paginated customers ─────────────────────────────────────────────────────

export interface CustomersPage {
  customers: import("@workspace/api-client-react").Customer[];
  total: number;
  totalOutstanding: string;
  page: number;
  pageSize: number;
}

export async function fetchCustomersPaginated(params: {
  page: number;
  pageSize: number;
  search?: string;
  hasBalance?: boolean;
  sortBy?: "name" | "balance" | "createdAt";
  sortDir?: "asc" | "desc";
}): Promise<CustomersPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  if (params.hasBalance) qs.set("hasBalance", "true");
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDir) qs.set("sortDir", params.sortDir);
  return customFetch<CustomersPage>(`/api/customers?${qs}`);
}

// ─── Paginated customer payments ─────────────────────────────────────────────

export interface CustomerPaymentsPage {
  payments: import("@workspace/api-client-react").CustomerPayment[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchCustomerPaymentsPaginated(params: {
  page: number;
  pageSize: number;
  customerId?: number;
  mode?: string;
  from?: string;
  to?: string;
  search?: string;
}): Promise<CustomerPaymentsPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  if (params.customerId) qs.set("customerId", String(params.customerId));
  if (params.mode) qs.set("mode", params.mode);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.search) qs.set("search", params.search);
  return customFetch<CustomerPaymentsPage>(`/api/customer-payments?${qs}`);
}

// ─── Paginated purchase orders ───────────────────────────────────────────────

export interface PurchaseOrdersPage {
  orders: import("@workspace/api-client-react").PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchPurchaseOrdersPaginated(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  supplierId?: number;
  warehouseId?: number;
  from?: string;
  to?: string;
  sortBy?: string;
  sortDir?: string;
  overdue?: boolean;
}): Promise<PurchaseOrdersPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.supplierId) qs.set("supplierId", String(params.supplierId));
  if (params.warehouseId) qs.set("warehouseId", String(params.warehouseId));
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDir) qs.set("sortDir", params.sortDir);
  if (params.overdue) qs.set("overdue", "true");
  return customFetch<PurchaseOrdersPage>(`/api/purchase-orders?${qs}`);
}

// ─── Paginated suppliers ─────────────────────────────────────────────────────

export interface SuppliersPage {
  suppliers: import("@workspace/api-client-react").Supplier[];
  total: number;
  totalPayable: string;
  overduePayablesCount: number;
  overduePayablesAmount: string;
  page: number;
  pageSize: number;
}

export async function fetchSuppliersPaginated(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  hasBalance?: boolean;
  overdueOnly?: boolean;
  sortBy?: string;
  sortDir?: string;
}): Promise<SuppliersPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  if (params.hasBalance) qs.set("hasBalance", "true");
  if (params.overdueOnly) qs.set("overdueOnly", "true");
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDir) qs.set("sortDir", params.sortDir);
  return customFetch<SuppliersPage>(`/api/suppliers?${qs}`);
}

// ─── Paginated supplier payments ─────────────────────────────────────────────

export type SupplierPaymentListItem = import("@workspace/api-client-react").SupplierPayment & {
  unapplied: number;
};

export interface SupplierPaymentsPage {
  payments: SupplierPaymentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchSupplierPaymentsPaginated(params: {
  page?: number;
  pageSize?: number;
  supplierId?: number;
  mode?: string;
  from?: string;
  to?: string;
  search?: string;
}): Promise<SupplierPaymentsPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.supplierId) qs.set("supplierId", String(params.supplierId));
  if (params.mode) qs.set("mode", params.mode);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.search) qs.set("search", params.search);
  return customFetch<SupplierPaymentsPage>(`/api/supplier-payments?${qs}`);
}

// ─── Paginated job work orders ────────────────────────────────────────────────

export interface JobWorkOrdersPage {
  orders: import("@workspace/api-client-react").JobWorkOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchJobWorkOrdersPaginated(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  supplierId?: number;
}): Promise<JobWorkOrdersPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.supplierId) qs.set("supplierId", String(params.supplierId));
  return customFetch<JobWorkOrdersPage>(`/api/job-work-orders?${qs}`);
}

// ─── Supplier payment edit ────────────────────────────────────────────────────

export async function updateSupplierPayment(
  paymentId: number,
  payload: {
    paymentDate?: string;
    mode?: string;
    referenceNumber?: string | null;
    bankAccountLabel?: string | null;
    notes?: string | null;
  },
): Promise<import("@workspace/api-client-react").SupplierPaymentDetail> {
  const res = await fetch(`/api/supplier-payments/${paymentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? "Failed to update payment",
    );
  }
  return res.json() as Promise<import("@workspace/api-client-react").SupplierPaymentDetail>;
}

// ─── Supplier payment allocation ─────────────────────────────────────────────

export async function applySupplierPaymentAllocation(
  paymentId: number,
  payload: { purchaseOrderId: number; amount: number },
): Promise<import("@workspace/api-client-react").SupplierPaymentDetail> {
  const res = await fetch(`/api/supplier-payments/${paymentId}/allocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? "Failed to apply allocation",
    );
  }
  return res.json() as Promise<import("@workspace/api-client-react").SupplierPaymentDetail>;
}

export async function bulkMoveWarehouse(payload: {
  ids: number[];
  warehouseId: number;
}): Promise<{ moved: number }> {
  const res = await fetch("/api/items/bulk-move-warehouse", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? "Move warehouse failed",
    );
  }
  return res.json() as Promise<{ moved: number }>;
}
