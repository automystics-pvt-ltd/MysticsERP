import { useEffect, useMemo, useState } from "react";
import { Can } from "@/components/Can";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  useGetEinvoiceConnection,
  useGetCurrentOrganization,
  useListCustomers,
  fetchSalesOrdersPaginated,
  type SalesOrdersPage,
  getListSalesOrdersQueryKey,
} from "@/lib/queryKeys";
import type { SalesOrder } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDate } from "@/lib/format";
import { AlertCircle, AlertTriangle, IndianRupee, Plus, Receipt, Search, ArrowUpDown, X } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { StatusBadge } from "@/components/StatusBadge";
import { getEinvoiceFixSummary } from "@/lib/einvoiceFixes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RecordPaymentDialog } from "@/components/RecordPaymentDialog";
import { BulkEinvoiceDialog } from "@/components/BulkEinvoiceDialog";
import { useDebounce } from "@/hooks/use-debounce";
import { FilterBar, type FilterChip } from "@/components/FilterBar";
import { DateRangePicker } from "@/components/DateRangePicker";

const SALE_CHANNEL_LABELS: Record<string, string> = {
  walkin: "Walk-in",
  website: "Website",
  store: "Store",
  whatsapp: "WhatsApp",
  phone: "Phone",
  instagram: "Instagram",
  other: "Other",
};

const PAYABLE_STATUSES = new Set([
  "confirmed",
  "shipped",
  "delivered",
  "invoiced",
]);

const EINVOICE_ELIGIBLE_STATUSES = new Set([
  "shipped",
  "delivered",
  "invoiced",
  "paid",
]);

type SalesOrderRow = SalesOrder;

function isEinvoiceEligible(order: SalesOrderRow): boolean {
  if (!EINVOICE_ELIGIBLE_STATUSES.has(order.status)) return false;
  if (!order.customerGstNumber) return false;
  const ein = order.einvoice;
  if (ein && ein.status === "active") return false;
  if (ein && ein.status === "pending") return false;
  if (ein && ein.status === "cancelled") return false;
  return true;
}

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

const SO_STATUS_VALUES = [
  "all", "outstanding", "draft", "confirmed", "partially_shipped",
  "shipped", "delivered", "invoiced", "paid", "returned", "refunded", "cancelled",
];

export default function SalesOrders() {
  const [overdueFilter, setOverdueFilter] = useState<boolean>(() =>
    new URLSearchParams(window.location.search).get("overdue") === "true"
  );
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    return s && SO_STATUS_VALUES.includes(s) ? s : "all";
  });
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
  const [orderTypeFilter, setOrderTypeFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("orderType") ?? "all",
  );
  const [channelFilter, setChannelFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("channel") ?? "all",
  );
  const [customerFilter, setCustomerFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("customer") ?? "all",
  );
  const [fromDate, setFromDate] = useState<string>(
    () => new URLSearchParams(window.location.search).get("from") ?? "",
  );
  const [toDate, setToDate] = useState<string>(
    () => new URLSearchParams(window.location.search).get("to") ?? "",
  );
  const [sortBy, setSortBy] = useState<string>(
    () => new URLSearchParams(window.location.search).get("sortBy") ?? "date",
  );
  const [sortDir, setSortDir] = useState<string>(
    () => new URLSearchParams(window.location.search).get("sortDir") ?? "desc",
  );
  const [paymentTarget, setPaymentTarget] = useState<{
    customerId: number;
    salesOrderId: number;
    balanceDue: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDialogState, setBulkDialogState] = useState<{
    open: boolean;
    orderIds: number[];
  }>({ open: false, orderIds: [] });

  const [search, setSearch] = useState<string>("");
  const debouncedSearch = useDebounce(search, 400);

  const { data: customers } = useListCustomers({});
  const { data: org } = useGetCurrentOrganization();
  const ptDays: number = (org as { defaultPaymentTermsDays?: number } | undefined)?.defaultPaymentTermsDays ?? 30;

  // Keep URL in sync with all filters so links are bookmarkable / refresh-safe.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (overdueFilter) {
      params.set("overdue", "true");
      params.delete("status");
    } else {
      params.delete("overdue");
      statusFilter !== "all" ? params.set("status", statusFilter) : params.delete("status");
    }
    search ? params.set("q", search) : params.delete("q");
    fromDate ? params.set("from", fromDate) : params.delete("from");
    toDate ? params.set("to", toDate) : params.delete("to");
    orderTypeFilter !== "all" ? params.set("orderType", orderTypeFilter) : params.delete("orderType");
    channelFilter !== "all" ? params.set("channel", channelFilter) : params.delete("channel");
    customerFilter !== "all" ? params.set("customer", customerFilter) : params.delete("customer");
    sortBy !== "date" ? params.set("sortBy", sortBy) : params.delete("sortBy");
    sortDir !== "desc" ? params.set("sortDir", sortDir) : params.delete("sortDir");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [overdueFilter, statusFilter, search, fromDate, toDate, orderTypeFilter, channelFilter, customerFilter, sortBy, sortDir]);

  const queryParams = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    overdue: overdueFilter || undefined,
    status: overdueFilter ? undefined : (statusFilter === "all" ? undefined : statusFilter),
    orderType:
      orderTypeFilter === "pos"
        ? "pos"
        : orderTypeFilter === "sales_order"
          ? "sales_order"
          : undefined,
    channel: channelFilter === "all" ? undefined : channelFilter,
    customerId: customerFilter !== "all" ? Number(customerFilter) : undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    sortBy: sortBy !== "date" ? sortBy : undefined,
    sortDir: sortDir !== "desc" ? sortDir : undefined,
  };

  const { data, isLoading } = useQuery<SalesOrdersPage>({
    queryKey: [...getListSalesOrdersQueryKey(), queryParams],
    queryFn: () => fetchSalesOrdersPaginated(queryParams),
    placeholderData: (prev) => prev,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;

  const resetPage = () => setPage(1);

  const clearFilters = () => {
    setOverdueFilter(false);
    setFromDate("");
    setToDate("");
    setStatusFilter("all");
    setOrderTypeFilter("all");
    setChannelFilter("all");
    setCustomerFilter("all");
    setSortBy("date");
    setSortDir("desc");
    setSearch("");
    resetPage();
  };

  const customerName = customerFilter !== "all" ? (customers ?? []).find((c) => String(c.id) === customerFilter)?.name : undefined;
  const filterCount = [
    statusFilter !== "all",
    orderTypeFilter !== "all",
    channelFilter !== "all",
    customerFilter !== "all",
    !!(fromDate || toDate),
    sortBy !== "date" || sortDir !== "desc",
  ].filter(Boolean).length;
  const soActiveChips: FilterChip[] = [
    ...(statusFilter !== "all" ? [{ key: "status", label: `Status: ${statusFilter.replace(/_/g, " ")}`, onRemove: () => { setStatusFilter("all"); resetPage(); } }] : []),
    ...(orderTypeFilter !== "all" ? [{ key: "type", label: `Type: ${orderTypeFilter === "pos" ? "POS" : "Sales Order"}`, onRemove: () => { setOrderTypeFilter("all"); resetPage(); } }] : []),
    ...(channelFilter !== "all" ? [{ key: "channel", label: `Channel: ${SALE_CHANNEL_LABELS[channelFilter] ?? channelFilter}`, onRemove: () => { setChannelFilter("all"); resetPage(); } }] : []),
    ...(customerFilter !== "all" && customerName ? [{ key: "customer", label: `Customer: ${customerName}`, onRemove: () => { setCustomerFilter("all"); resetPage(); } }] : []),
    ...((fromDate || toDate) ? [{ key: "date", label: fromDate && toDate ? `${fromDate} – ${toDate}` : (fromDate ? `From ${fromDate}` : `To ${toDate}`), onRemove: () => { setFromDate(""); setToDate(""); resetPage(); } }] : []),
    ...(sortBy !== "date" || sortDir !== "desc" ? [{ key: "sort", label: `Sort: ${sortBy} ${sortDir}`, onRemove: () => { setSortBy("date"); setSortDir("desc"); resetPage(); } }] : []),
  ];

  const overdueButton = (
    <Button
      variant={overdueFilter ? "default" : "outline"}
      size="sm"
      className={overdueFilter
        ? "h-9 gap-1.5 bg-orange-600 hover:bg-orange-700 border-orange-600 text-white"
        : "h-9 gap-1.5 text-muted-foreground"}
      onClick={() => { setOverdueFilter((v) => !v); setStatusFilter("all"); resetPage(); }}
      data-testid="filter-so-overdue"
    >
      <AlertCircle className="h-3.5 w-3.5" />
      Overdue
      {overdueFilter && <X className="h-3 w-3 ml-0.5 opacity-70" />}
    </Button>
  );

  const einvoiceConnection = useGetEinvoiceConnection();
  const einvoiceAvailable =
    einvoiceConnection.data?.connected === true &&
    einvoiceConnection.data?.enabled === true;

  const eligibleVisible = useMemo(
    () => orders.filter(isEinvoiceEligible),
    [orders],
  );
  const selectedEligibleIds = useMemo(
    () => eligibleVisible.filter((o) => selectedIds.has(o.id)).map((o) => o.id),
    [eligibleVisible, selectedIds],
  );

  const allEligibleSelected =
    eligibleVisible.length > 0 &&
    selectedEligibleIds.length === eligibleVisible.length;
  const someEligibleSelected =
    selectedEligibleIds.length > 0 && !allEligibleSelected;

  const toggleAllEligible = () => {
    if (allEligibleSelected) {
      const next = new Set(selectedIds);
      for (const o of eligibleVisible) next.delete(o.id);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const o of eligibleVisible) next.add(o.id);
      setSelectedIds(next);
    }
  };

  const toggleOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const openBulk = () => {
    if (selectedEligibleIds.length === 0) return;
    setBulkDialogState({ open: true, orderIds: selectedEligibleIds });
  };

  const showSelection = einvoiceAvailable;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Orders"
        description="Manage customer orders and fulfillments."
        actions={
          <Can module="sales_orders" action="create">
            <Button asChild data-testid="btn-create-so">
              <Link href="/sales-orders/new">
                <Plus className="mr-2 h-4 w-4" />
                New Order
              </Link>
            </Button>
          </Can>
        }
      />

      <div className="flex flex-wrap items-start gap-4">
        <FilterBar
          className="flex-1"
          search={search}
          onSearchChange={(v) => { setSearch(v); resetPage(); }}
          searchPlaceholder="Order # or customer name…"
          filterCount={filterCount}
          onReset={clearFilters}
          activeChips={soActiveChips}
          rightSlot={overdueButton}
          filterPopoverWidth="320px"
          filterContent={
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select
                  value={overdueFilter ? "all" : statusFilter}
                  onValueChange={(v) => { setStatusFilter(v); setOverdueFilter(false); resetPage(); }}
                  disabled={overdueFilter}
                >
                  <SelectTrigger data-testid="filter-so-status" disabled={overdueFilter}>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="outstanding">Outstanding (unpaid)</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="shipped">Shipped</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                    <SelectItem value="invoiced">Invoiced</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="returned">Returned</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Order Type</Label>
                <Select value={orderTypeFilter} onValueChange={(v) => { setOrderTypeFilter(v); resetPage(); }}>
                  <SelectTrigger data-testid="filter-so-order-type">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="sales_order">Sales Order</SelectItem>
                    <SelectItem value="pos">POS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Channel</Label>
                <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); resetPage(); }}>
                  <SelectTrigger data-testid="filter-so-channel">
                    <SelectValue placeholder="All Channels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Channels</SelectItem>
                    {Object.entries(SALE_CHANNEL_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Customer</Label>
                <Select value={customerFilter} onValueChange={(v) => { setCustomerFilter(v); resetPage(); }}>
                  <SelectTrigger data-testid="filter-so-customer">
                    <SelectValue placeholder="All Customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {customers?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date range</Label>
                <DateRangePicker
                  from={fromDate}
                  to={toDate}
                  onChange={(f, t) => { setFromDate(f); setToDate(t); resetPage(); }}
                  onClear={() => { setFromDate(""); setToDate(""); resetPage(); }}
                  align="start"
                  placeholder="All dates"
                  className="w-full justify-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Sort</Label>
                <div className="flex items-center gap-1">
                  <Select value={sortBy} onValueChange={(v) => { setSortBy(v); resetPage(); }}>
                    <SelectTrigger className="flex-1" data-testid="filter-so-sort-by">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date">Order Date</SelectItem>
                      <SelectItem value="created">Created</SelectItem>
                      <SelectItem value="total">Total</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => { setSortDir((d) => d === "desc" ? "asc" : "desc"); resetPage(); }}
                    data-testid="btn-so-sort-dir"
                    title={sortDir === "desc" ? "Newest first" : "Oldest first"}
                  >
                    <ArrowUpDown className={`h-4 w-4 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />
                  </Button>
                </div>
              </div>
            </>
          }
        />

        {showSelection && selectedEligibleIds.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {selectedEligibleIds.length} selected
            </p>
            <Button
              size="sm"
              onClick={openBulk}
              data-testid="btn-bulk-generate-einvoices"
            >
              <Receipt className="mr-2 h-4 w-4" />
              Generate e-invoices ({selectedEligibleIds.length})
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {showSelection && (
                <TableHead className="w-[44px]">
                  <Checkbox
                    checked={
                      allEligibleSelected
                        ? true
                        : someEligibleSelected
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={toggleAllEligible}
                    disabled={eligibleVisible.length === 0}
                    aria-label="Select all eligible orders"
                    data-testid="checkbox-bulk-select-all"
                  />
                </TableHead>
              )}
              <TableHead>Order #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              {overdueFilter && <TableHead className="text-right">Days Overdue</TableHead>}
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Cash</TableHead>
              <TableHead className="text-right">UPI</TableHead>
              <TableHead className="text-right">Card</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-[140px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: pageSize }).map((_, i) => (
                <TableRow key={i}>
                  {showSelection && <TableCell><Skeleton className="h-4 w-4" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  {overdueFilter && <TableCell><Skeleton className="h-5 w-14 rounded-full ml-auto" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={(showSelection ? 11 : 10) + (overdueFilter ? 1 : 0)}
                  className="h-24 text-center text-muted-foreground"
                >
                  {overdueFilter
                    ? "No overdue sales orders — all invoices are within payment terms."
                    : "No orders found."}
                </TableCell>
              </TableRow>
            ) : (
              <>
              {orders.map((order) => {
                const balance = Number(order.balanceDue ?? 0);
                const canPay =
                  PAYABLE_STATUSES.has(order.status) && balance > 0;
                const eligible = isEinvoiceEligible(order);
                const cash = order.cashPaid ?? 0;
                const upi = order.upiPaid ?? 0;
                const card = order.cardPaid ?? 0;
                return (
                  <TableRow key={order.id} data-testid={`row-so-${order.id}`}>
                    {showSelection && (
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(order.id)}
                          onCheckedChange={() => toggleOne(order.id)}
                          disabled={!eligible}
                          aria-label={`Select order ${order.orderNumber}`}
                          data-testid={`checkbox-bulk-select-${order.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/sales-orders/${order.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                        {order.orderType === "pos" && (
                          <Badge
                            variant="secondary"
                            className="font-sans text-[10px] uppercase tracking-wide"
                            data-testid={`badge-so-pos-${order.id}`}
                          >
                            POS
                          </Badge>
                        )}
                        {order.shopifyOrderId && (
                          <Badge
                            variant="outline"
                            className="font-sans text-[10px] uppercase tracking-wide border-green-600 text-green-700 dark:border-green-500 dark:text-green-400"
                            data-testid={`badge-so-shopify-${order.id}`}
                          >
                            Shopify
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(order.orderDate)}</TableCell>
                    <TableCell>
                      {(() => {
                        const isPos = order.orderType === "pos";
                        const ch = order.saleChannel;
                        const channelLabel = ch
                          ? (SALE_CHANNEL_LABELS[ch] ?? ch)
                          : null;
                        const isWalkInRecord =
                          order.customerName === "Walk-in Customer";
                        const isNonWalkInPosChannel =
                          isPos && ch !== null && ch !== "walkin";

                        let displayName = order.customerName;
                        let subtext: string | null = null;
                        if (isNonWalkInPosChannel && isWalkInRecord) {
                          displayName = `${channelLabel} Customer`;
                        } else if (isNonWalkInPosChannel) {
                          subtext = `Mode of Sale: ${channelLabel}`;
                        }

                        return (
                          <div className="flex flex-col">
                            <span data-testid={`text-so-customer-${order.id}`}>
                              {displayName}
                            </span>
                            {subtext && (
                              <span
                                className="text-xs text-muted-foreground"
                                data-testid={`text-so-channel-${order.id}`}
                              >
                                {subtext}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={order.status} />
                        {order.paymentStatus && (
                          <Badge
                            variant="outline"
                            className={
                              order.paymentStatus === "paid"
                                ? "text-[11px] font-medium bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40"
                                : order.paymentStatus === "partially_paid"
                                  ? "text-[11px] font-medium bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40"
                                  : order.paymentStatus === "refunded"
                                    ? "text-[11px] font-medium bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/40"
                                    : order.paymentStatus === "void"
                                      ? "text-[11px] font-medium bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700"
                                      : "text-[11px] font-medium bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800/40"
                            }
                            data-testid={`badge-so-payment-${order.id}`}
                          >
                            {order.paymentStatus === "paid"
                              ? "Paid"
                              : order.paymentStatus === "partially_paid"
                                ? "Partially Paid"
                                : order.paymentStatus === "refunded"
                                  ? "Refunded"
                                  : order.paymentStatus === "void"
                                    ? "Void"
                                    : "Payment Pending"}
                          </Badge>
                        )}
                        {order.einvoice?.status === "failed" &&
                          (() => {
                            const fix = getEinvoiceFixSummary(
                              order.einvoice,
                              {
                                customerId: order.customerId,
                                customerName: order.customerName,
                              },
                            );
                            const summary = fix?.title ?? order.einvoice?.error;
                            if (!summary) return null;
                            return (
                              <Link
                                href={
                                  fix?.href ?? `/sales-orders/${order.id}`
                                }
                                className="inline-flex max-w-[260px] items-start gap-1 text-xs text-destructive hover:underline"
                                title={summary}
                                data-testid={`einvoice-fix-summary-${order.id}`}
                              >
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  e-Invoice: {summary}
                                </span>
                              </Link>
                            );
                          })()}
                      </div>
                    </TableCell>
                    {overdueFilter && (
                      <TableCell className="text-right">
                        {(() => {
                          const orderDateMs = new Date(order.orderDate).getTime();
                          const todayMs = new Date().setHours(0, 0, 0, 0);
                          const daysPast = Math.floor((todayMs - orderDateMs) / 86_400_000);
                          const daysOverdue = daysPast - ptDays;
                          if (daysOverdue <= 0) return <span className="text-muted-foreground text-xs">—</span>;
                          return (
                            <Badge
                              className={cn(
                                "text-[11px] font-semibold border-0",
                                daysOverdue > 90
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                  : daysOverdue > 30
                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                              )}
                              data-testid={`badge-so-days-overdue-${order.id}`}
                            >
                              {daysOverdue}d overdue
                            </Badge>
                          );
                        })()}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {Number(order.discountTotal) > 0 ? (
                        <span className="text-green-600 dark:text-green-400">
                          -{formatCurrency(order.discountTotal)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {cash > 0 ? formatCurrency(cash) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {upi > 0 ? formatCurrency(upi) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {card > 0 ? formatCurrency(card) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(order.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canPay && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPaymentTarget({
                              customerId: order.customerId,
                              salesOrderId: order.id,
                              balanceDue: balance,
                            })
                          }
                          data-testid={`btn-record-payment-${order.id}`}
                        >
                          <IndianRupee className="mr-1 h-3.5 w-3.5" />
                          Record payment
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(() => {
                const totalDisc = orders.reduce((s, o) => s + Number(o.discountTotal ?? 0), 0);
                const totalCash = orders.reduce((s, o) => s + (o.cashPaid ?? 0), 0);
                const totalUpi = orders.reduce((s, o) => s + (o.upiPaid ?? 0), 0);
                const totalCard = orders.reduce((s, o) => s + (o.cardPaid ?? 0), 0);
                const totalAmt = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);
                const colsBefore = (showSelection ? 5 : 4) + (overdueFilter ? 1 : 0);
                return (
                  <TableRow className="border-t-2 font-semibold bg-muted/30">
                    <TableCell colSpan={colsBefore} className="text-muted-foreground text-sm">
                      Page Total ({orders.length} order{orders.length !== 1 ? "s" : ""})
                    </TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400">
                      {totalDisc > 0 ? `-${formatCurrency(totalDisc)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{totalCash > 0 ? formatCurrency(totalCash) : "—"}</TableCell>
                    <TableCell className="text-right">{totalUpi > 0 ? formatCurrency(totalUpi) : "—"}</TableCell>
                    <TableCell className="text-right">{totalCard > 0 ? formatCurrency(totalCard) : "—"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(totalAmt)}</TableCell>
                    <TableCell />
                  </TableRow>
                );
              })()}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        itemLabel="orders"
      />

      {paymentTarget && (
        <RecordPaymentDialog
          open={!!paymentTarget}
          onOpenChange={(open) => {
            if (!open) setPaymentTarget(null);
          }}
          customerId={paymentTarget.customerId}
          presetSalesOrderId={paymentTarget.salesOrderId}
          presetSalesOrderBalance={paymentTarget.balanceDue}
        />
      )}

      {bulkDialogState.open && (
        <BulkEinvoiceDialog
          open={bulkDialogState.open}
          onOpenChange={(open) => {
            if (!open) {
              setBulkDialogState({ open: false, orderIds: [] });
              setSelectedIds(new Set());
            }
          }}
          orderIds={bulkDialogState.orderIds}
        />
      )}
    </div>
  );
}
