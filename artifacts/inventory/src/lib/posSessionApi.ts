export interface PosCounter {
  id: number;
  organizationId: number;
  warehouseId: number;
  warehouseName: string | null;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PosSession {
  id: number;
  organizationId: number;
  counterId: number | null;
  counterName: string | null;
  counterCode: string | null;
  warehouseId: number;
  warehouseName: string | null;
  cashierId: number;
  cashierName: string | null;
  cashierEmail: string | null;
  sessionNumber: string;
  status: "open" | "closed" | "pending_approval" | "approved" | "rejected";
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  closingCash: string | null;
  notes: string | null;
  approvedById: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalRemarks: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface PosSessionExpense {
  id: number;
  organizationId: number;
  sessionId: number;
  label: string;
  amount: string;
  category: string | null;
  createdById: number | null;
  createdAt: string;
}

export interface PosSessionAuditLog {
  id: number;
  organizationId: number;
  sessionId: number;
  action: string;
  performedByUserId: number | null;
  performedByName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface PosSessionDetail extends PosSession {
  expenses: PosSessionExpense[];
  auditLogs: PosSessionAuditLog[];
}

export interface PosSessionReportOrder {
  id: number;
  orderNumber: string;
  total: string;
  status: string;
  createdAt: string;
}

export interface PosSessionReportTopItem {
  itemId: number;
  itemName: string;
  itemSku: string;
  totalQty: string;
  totalAmount: string;
}

export interface PosSessionReport {
  sessionId: number;
  warehouseId: number;
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  closingCash: string | null;
  totalOrders: number;
  activeOrders: number;
  cancelledOrders: number;
  totalSales: string;
  totalDiscounts: string;
  paymentsByMode: Array<{ mode: string; total: string }>;
  cashReturns: string;
  totalExpenses: string;
  expenses: PosSessionExpense[];
  expectedClosingCash: string;
  actualClosingCash: string | null;
  cashVariance: string | null;
  topItems: PosSessionReportTopItem[];
  orders: PosSessionReportOrder[];
}

export interface ActiveSession {
  id: number;
  sessionNumber: string;
  status: string;
  openedAt: string;
  warehouseId: number;
  warehouseName: string | null;
  counterName: string | null;
  openingCash: string;
}

export class PosApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  constructor(status: number, data: unknown) {
    const msg =
      data && typeof data === "object" && "message" in data
        ? String((data as Record<string, unknown>).message)
        : `HTTP ${status}`;
    super(msg);
    this.name = "PosApiError";
    this.status = status;
    this.data = data;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PosApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Counters
export const listCounters = (includeInactive = false) =>
  apiFetch<PosCounter[]>(`/pos/counters${includeInactive ? "?includeInactive=true" : ""}`);

export const createCounter = (body: { name: string; code: string; warehouseId: number }) =>
  apiFetch<PosCounter>("/pos/counters", { method: "POST", body: JSON.stringify(body) });

export const updateCounter = (id: number, body: { name?: string; code?: string; warehouseId?: number; isActive?: boolean }) =>
  apiFetch<PosCounter>(`/pos/counters/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const deactivateCounter = (id: number) =>
  apiFetch<void>(`/pos/counters/${id}`, { method: "DELETE" });

// Sessions
export interface SessionsPage {
  sessions: PosSession[];
  total: number;
  page: number;
  pageSize: number;
}

export const listSessions = (params?: {
  status?: string;
  warehouseId?: number;
  counterId?: number;
  cashierId?: number;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.warehouseId) qs.set("warehouseId", String(params.warehouseId));
  if (params?.counterId) qs.set("counterId", String(params.counterId));
  if (params?.cashierId) qs.set("cashierId", String(params.cashierId));
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params?.search) qs.set("search", params.search);
  const q = qs.toString();
  return apiFetch<SessionsPage>(`/pos/sessions${q ? `?${q}` : ""}`);
};

export const getMyActiveSession = () =>
  apiFetch<ActiveSession | null>("/pos/sessions/my-active");

export const openSession = (body: { warehouseId: number; counterId?: number | null; openingCash?: number; notes?: string }) =>
  apiFetch<PosSession>("/pos/sessions", { method: "POST", body: JSON.stringify(body) });

export const getSession = (id: number) =>
  apiFetch<PosSessionDetail>(`/pos/sessions/${id}`);

export const closeSession = (id: number, body: { closingCash: number; notes?: string }) =>
  apiFetch<PosSession>(`/pos/sessions/${id}/close`, { method: "POST", body: JSON.stringify(body) });

export const approveSession = (id: number, body?: { remarks?: string }) =>
  apiFetch<PosSession>(`/pos/sessions/${id}/approve`, { method: "POST", body: JSON.stringify(body ?? {}) });

export const rejectSession = (id: number, body: { reason?: string }) =>
  apiFetch<PosSession>(`/pos/sessions/${id}/reject`, { method: "POST", body: JSON.stringify(body) });

export const submitSession = (id: number) =>
  apiFetch<PosSession>(`/pos/sessions/${id}/submit`, { method: "POST", body: JSON.stringify({}) });

export const resubmitSession = (id: number) =>
  apiFetch<PosSession>(`/pos/sessions/${id}/resubmit`, { method: "POST", body: JSON.stringify({}) });

export const reopenSession = (id: number, body: { reason?: string }) =>
  apiFetch<PosSession>(`/pos/sessions/${id}/reopen`, { method: "POST", body: JSON.stringify(body) });

export const getSessionReport = (id: number) =>
  apiFetch<PosSessionReport>(`/pos/sessions/${id}/report`);

export const addExpense = (sessionId: number, body: { label: string; amount: number; category?: string }) =>
  apiFetch<PosSessionExpense>(`/pos/sessions/${sessionId}/expenses`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const deleteExpense = (sessionId: number, expId: number) =>
  apiFetch<void>(`/pos/sessions/${sessionId}/expenses/${expId}`, { method: "DELETE" });
