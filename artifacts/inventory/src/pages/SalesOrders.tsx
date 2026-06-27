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
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, ChevronsUpDown, IndianRupee, Plus, Receipt, X, Package } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
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
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";
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

type SortKey = "date" | "created" | "total";

function SortableHead({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: string;
  dir: string;
  onSort: (key: SortKey, dir: "asc" | "desc") => void;
  className?: string;
}) {
  const active = current === sortKey;
  const nextDir = active && dir === "desc" ? "asc" : "desc";
  const Icon = active ? (dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey, nextDir)}
        className={cn(
          "inline-flex items-center gap-1 rounded px-0.5 -mx-0.5 transition-colors hover:text-foreground select-none whitespace-nowrap",
          active ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "opacity-80" : "opacity-40")} />
      </button>
    </TableHead>
  );
}

const SO_STATUS_VALUES = [
  "all", "outstanding", "draft", "confirmed", "partially_shipped",
  "shipped", "delivered", "invoiced", "paid", "returned", "refunded", "cancelled",
];

export default function SalesOrders() {
  const { values, set, setMany, reset, debouncedSearch } = useListFilters({
    search: "",
    overdue: "false",
    status: "all",
    orderType: "all",
    channel: "all",
    customer: "all",
    from: "",
    to: "",
    sort: "created",
    sortDir: "desc",
  });
  const search = values.search;
  const overdueFilter = values.overdue === "true";
  const statusFilter = values.status;
  const orderTypeFilter = values.orderType;
  const channelFilter = values.channel;
  const customerFilter = values.customer;
  const fromDate = values.from;
  const toDate = values.to;
  const sortBy = values.sort;
  const sortDir = values.sortDir;
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
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

  const { data: customers } = useListCustomers({});
  const { data: org } = useGetCurrentOrganization();
  const ptDays: number = (org as { defaultPaymentTermsDays?: number } | undefined)?.defaultPaymentTermsDays ?? 30;

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
    sortBy: sortBy !== "created" ? sortBy : undefined,
    sortDir: sortDir !== "desc" ? sortDir : undefined,
  };

  const { data, isLoading } = useQuery<SalesOrdersPage>({
    queryKey: [...getListSalesOrdersQueryKey(), queryParams],
    queryFn: () => fetchSalesOrdersPaginated(queryParams),
    placeholderData: (prev) => prev,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;


  const overdueButton = (
    <Button
      variant={overdueFilter ? "default" : "outline"}
      size="sm"
      className={overdueFilter
        ? "h-9 gap-1.5 bg-orange-600 hover:bg-orange-700 border-orange-600 text-white"
        : "h-9 gap-1.5 text-muted-foreground"}
      onClick={() => { setMany({ overdue: overdueFilter ? "false" : "true", status: "all" }); setPage(1); }}
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

  const handleSort = (key: SortKey, dir: "asc" | "desc") => {
    setMany({ sort: key, sortDir: dir });
    setPage(1);
  };

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
          search={values.search}
          onSearchChange={(v) => { set("search", v); setPage(1); }}
          searchPlaceholder="Order # or customer name…"
          filterDefs={[
            {
              key: "status", label: "Status", type: "select",
              options: [
                { value: "outstanding", label: "Outstanding (unpaid)" },
                { value: "draft", label: "Draft" },
                { value: "confirmed", label: "Confirmed" },
                { value: "shipped", label: "Shipped" },
                { value: "delivered", label: "Delivered" },
                { value: "invoiced", label: "Invoiced" },
                { value: "paid", label: "Paid" },
                { value: "returned", label: "Returned" },
                { value: "refunded", label: "Refunded" },
                { value: "cancelled", label: "Cancelled" },
              ],
            },
            {
              key: "orderType", label: "Order Type", type: "select",
              options: [
                { value: "sales_order", label: "Sales Order" },
                { value: "pos", label: "POS" },
              ],
            },
            {
              key: "channel", label: "Channel", type: "select",
              options: Object.entries(SALE_CHANNEL_LABELS).map(([v, l]) => ({ value: v, label: l })),
            },
            {
              key: "customer", label: "Customer", type: "select",
              options: (customers ?? []).map((c) => ({ value: String(c.id), label: c.name })),
            },
            { key: "date", label: "Date range", type: "daterange", fromKey: "from", toKey: "to" },
          ]}
          filterValues={values}
          onFilterChange={(k, v) => {
            if (k === "status") {
              setMany({ status: v, overdue: "false" });
            } else {
              set(k, v);
            }
            setPage(1);
          }}
          rightSlot={overdueButton}
          onReset={() => { reset(); setPage(1); }}
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
              <SortableHead label="Order #" sortKey="created" current={sortBy} dir={sortDir} onSort={handleSort} />
              <SortableHead label="Date" sortKey="date" current={sortBy} dir={sortDir} onSort={handleSort} />
              <TableHead>Customer</TableHead>
              <SortableHead label="Total" sortKey="total" current={sortBy} dir={sortDir} onSort={handleSort} className="text-right" />
              {overdueFilter && <TableHead className="text-right">Days Overdue</TableHead>}
              <TableHead>Payment</TableHead>
              <TableHead>Fulfillment</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead>Delivery Status</TableHead>
              <TableHead>Delivery Method</TableHead>
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
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  {overdueFilter && <TableCell><Skeleton className="h-5 w-14 rounded-full ml-auto" /></TableCell>}
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10 + (showSelection ? 1 : 0) + (overdueFilter ? 1 : 0)}
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
                      <div className="flex flex-col gap-1">
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
                        {order.einvoice?.status === "failed" &&
                          (() => {
                            const fix = getEinvoiceFixSummary(
                              order.einvoice,
                              { customerId: order.customerId, customerName: order.customerName },
                            );
                            const summary = fix?.title ?? order.einvoice?.error;
                            if (!summary) return null;
                            return (
                              <Link
                                href={fix?.href ?? `/sales-orders/${order.id}`}
                                className="inline-flex max-w-[200px] items-start gap-1 text-xs text-destructive hover:underline"
                                title={summary}
                                data-testid={`einvoice-fix-summary-${order.id}`}
                              >
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                <span className="truncate">e-Invoice: {summary}</span>
                              </Link>
                            );
                          })()}
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
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(order.total)}
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
                    <TableCell>
                      {order.paymentStatus ? (
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
                                  : "Pending"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const s = order.status;
                        // Derive a fulfillment-specific label/color from the order status.
                        // Order status mixes payment and fulfillment concerns — we only surface
                        // the shipping/delivery dimension here.
                        const fulfilled =
                          s === "delivered"
                            ? { label: "Delivered", cls: "bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40" }
                            : s === "shipped"
                              ? { label: "Shipped", cls: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/40" }
                              : s === "partially_shipped"
                                ? { label: "Partially Shipped", cls: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40" }
                                : s === "returned"
                                  ? { label: "Returned", cls: "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800/40" }
                                  : s === "cancelled" || s === "refunded"
                                    ? null
                                    : { label: "Unfulfilled", cls: "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700" };
                        return fulfilled ? (
                          <Badge
                            variant="outline"
                            className={`text-[11px] font-medium ${fulfilled.cls}`}
                            data-testid={`badge-so-fulfillment-${order.id}`}
                          >
                            {fulfilled.label}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="flex items-center justify-end gap-1 text-sm">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        {order.itemCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      {order.latestShipmentStatus ? (
                        <span className="text-sm text-muted-foreground capitalize">
                          {order.latestShipmentStatus.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {order.deliveryMethod ? (
                        <span className="text-sm text-muted-foreground">{order.deliveryMethod}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
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
                const totalAmt = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);
                const colsBefore = (showSelection ? 1 : 0) + 3;
                const colsAfter = (overdueFilter ? 1 : 0) + 6;
                return (
                  <TableRow className="border-t-2 font-semibold bg-muted/30">
                    <TableCell colSpan={colsBefore} className="text-muted-foreground text-sm">
                      Page Total ({orders.length} order{orders.length !== 1 ? "s" : ""})
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(totalAmt)}</TableCell>
                    <TableCell colSpan={colsAfter} />
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
