import { useState, useEffect } from "react";
import { Can } from "@/components/Can";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { fetchPurchaseOrdersPaginated, useListWarehouses } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/TableSkeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { Plus, IndianRupee, Search, X, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RecordSupplierPaymentDialog } from "@/components/RecordSupplierPaymentDialog";
import { useDebounce } from "@/hooks/use-debounce";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";

const PAYABLE_STATUSES = new Set([
  "ordered",
  "partially_received",
  "received",
  "billed",
]);

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

const PO_STATUS_VALUES = [
  "all", "outstanding", "draft", "ordered", "partially_received",
  "received", "billed", "paid", "cancelled",
];

export default function PurchaseOrders() {
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    return s && PO_STATUS_VALUES.includes(s) ? s : "all";
  });
  const [overdueFilter, setOverdueFilter] = useState<boolean>(() =>
    new URLSearchParams(window.location.search).get("overdue") === "true"
  );
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const { data: warehouses } = useListWarehouses();
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string>(() => {
    try { return JSON.parse(sessionStorage.getItem("sort:purchase-orders") ?? "{}").sortBy ?? "date"; } catch { return "date"; }
  });
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => {
    try { return JSON.parse(sessionStorage.getItem("sort:purchase-orders") ?? "{}").sortDir ?? "desc"; } catch { return "desc"; }
  });

  const debouncedSearch = useDebounce(search, 400);

  // Keep URL in sync with overdue + status filters so links are bookmarkable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (overdueFilter) {
      params.set("overdue", "true");
      params.delete("status");
    } else {
      params.delete("overdue");
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      } else {
        params.delete("status");
      }
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [overdueFilter, statusFilter]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "purchase-orders-paginated",
      { page, pageSize, search: debouncedSearch, statusFilter, overdueFilter, fromDate, toDate, sortBy, sortDir, warehouseFilter },
    ],
    queryFn: () =>
      fetchPurchaseOrdersPaginated({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        status: overdueFilter ? undefined : (statusFilter === "all" ? undefined : statusFilter),
        overdue: overdueFilter || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        sortBy,
        sortDir,
        warehouseId: warehouseFilter !== "all" ? Number(warehouseFilter) : undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;

  const hasFilters = overdueFilter || statusFilter !== "all" || !!search.trim() || !!fromDate || !!toDate || warehouseFilter !== "all";
  const clearFilters = () => {
    setOverdueFilter(false);
    setStatusFilter("all");
    setWarehouseFilter("all");
    setSearch("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const resetPage = () => setPage(1);

  type OrderRow = NonNullable<typeof data>["orders"][number];
  const exportColumns: ExportColumn<OrderRow>[] = [
    { header: "Order #", accessor: (r) => r.orderNumber },
    { header: "Date", accessor: (r) => r.orderDate },
    { header: "Supplier", accessor: (r) => r.supplierName },
    { header: "Status", accessor: (r) => r.status },
    { header: "Total", accessor: (r) => Number(r.total ?? 0) },
    { header: "Paid", accessor: (r) => Number(r.amountPaid ?? 0) },
    { header: "Balance", accessor: (r) => Number(r.balanceDue ?? 0) },
  ];

  const [paymentTarget, setPaymentTarget] = useState<{
    supplierId: number;
    supplierName: string;
    purchaseOrderId: number;
    balance: number;
  } | null>(null);

  const handleSort = (col: string) => {
    const newBy = col;
    const newDir: "asc" | "desc" = sortBy === col ? (sortDir === "desc" ? "asc" : "desc") : "desc";
    setSortBy(newBy);
    setSortDir(newDir);
    try { sessionStorage.setItem("sort:purchase-orders", JSON.stringify({ sortBy: newBy, sortDir: newDir })); } catch {}
    setPage(1);
  };
  const SortIcon = ({ col }: { col: string }) =>
    sortBy === col
      ? sortDir === "asc"
        ? <ArrowUp className="h-3.5 w-3.5" />
        : <ArrowDown className="h-3.5 w-3.5" />
      : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        description="Manage stock replenishment and vendor orders."
        actions={
          <div className="flex items-center gap-2">
            <Can module="purchase_orders" action="export">
              <ReportExportButton
                filename="purchase-orders"
                title="Purchase Orders"
                columns={exportColumns}
                rows={orders}
                disabled={isLoading || orders.length === 0}
              />
            </Can>
            <Can module="purchase_orders" action="create">
              <Button asChild data-testid="btn-create-po">
                <Link href="/purchase-orders/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Purchase Order
                </Link>
              </Button>
            </Can>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-4 bg-card border rounded-lg p-4 w-full">
        {/* Overdue quick-filter chip */}
        <div className="space-y-1 w-full sm:w-auto">
          <Label className="invisible sm:hidden">Filter</Label>
          <Button
            variant={overdueFilter ? "default" : "outline"}
            size="sm"
            className={overdueFilter
              ? "h-9 gap-1.5 bg-orange-600 hover:bg-orange-700 border-orange-600 text-white"
              : "h-9 gap-1.5 text-muted-foreground"}
            onClick={() => { setOverdueFilter((v) => !v); setStatusFilter("all"); resetPage(); }}
            data-testid="filter-po-overdue"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            Overdue bills
            {overdueFilter && <X className="h-3 w-3 ml-0.5 opacity-70" />}
          </Button>
        </div>

        <div className="relative space-y-1 w-full sm:w-60">
          <Label>Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Order # or supplier name…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              className="pl-8"
              data-testid="filter-po-search"
            />
          </div>
        </div>
        <div className="space-y-1 w-full sm:w-48">
          <Label>Status</Label>
          <Select
            value={overdueFilter ? "all" : statusFilter}
            onValueChange={(v) => { setStatusFilter(v); setOverdueFilter(false); resetPage(); }}
            disabled={overdueFilter}
          >
            <SelectTrigger data-testid="filter-po-status" disabled={overdueFilter}>
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="outstanding">Outstanding (unpaid)</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="ordered">Ordered</SelectItem>
              <SelectItem value="partially_received">Partially Received</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="billed">Billed</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 w-full sm:w-36">
          <Label>From</Label>
          <Input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => { setFromDate(e.target.value); resetPage(); }}
            data-testid="filter-po-from"
          />
        </div>
        <div className="space-y-1 w-full sm:w-36">
          <Label>To</Label>
          <Input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => { setToDate(e.target.value); resetPage(); }}
            data-testid="filter-po-to"
          />
        </div>
        <div className="space-y-1 w-full sm:w-44">
          <Label>Warehouse</Label>
          <Select
            value={warehouseFilter}
            onValueChange={(v) => { setWarehouseFilter(v); resetPage(); }}
          >
            <SelectTrigger data-testid="filter-po-warehouse">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All warehouses</SelectItem>
              {warehouses?.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <div className="space-y-1">
            <Label className="invisible">Clear</Label>
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="btn-po-clear-filters">
              <X className="mr-1 h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("date")}>
                <span className="flex items-center gap-1">Date <SortIcon col="date" /></span>
              </TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("total")}>
                <span className="flex items-center justify-end gap-1">Total <SortIcon col="total" /></span>
              </TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("balance")}>
                <span className="flex items-center justify-end gap-1">Balance <SortIcon col="balance" /></span>
              </TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={8} cols={8} />
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {overdueFilter
                    ? "No overdue purchase orders — all bills are within payment terms."
                    : hasFilters
                    ? "No orders match the current filters."
                    : "No purchase orders yet."}
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => {
                const balance = Number(order.balanceDue ?? 0);
                const canPay = PAYABLE_STATUSES.has(order.status) && balance > 0;
                return (
                  <TableRow key={order.id} data-testid={`row-po-${order.id}`}>
                    <TableCell className="font-mono">
                      <div className="flex items-center gap-2">
                        <Link href={`/purchase-orders/${order.id}`} className="font-medium text-primary hover:underline">
                          {order.orderNumber}
                        </Link>
                        {order.jobWorkReceiptId != null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className="text-[10px] font-normal"
                                data-testid={`badge-jwo-${order.id}`}
                              >
                                from JWO
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {order.jwoNumber
                                ? `Auto-created from job-work order ${order.jwoNumber}`
                                : "Auto-created from a job-work receipt"}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(order.orderDate)}</TableCell>
                    <TableCell>{order.supplierName}</TableCell>
                    <TableCell><StatusBadge status={order.status} /></TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(order.total)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(order.amountPaid ?? 0))}</TableCell>
                    <TableCell className="text-right">
                      <span className={balance > 0 ? "text-orange-600 font-medium" : "text-muted-foreground"}>
                        {formatCurrency(balance)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {canPay && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPaymentTarget({
                              supplierId: order.supplierId,
                              supplierName: order.supplierName,
                              purchaseOrderId: order.id,
                              balance,
                            })
                          }
                          data-testid={`btn-row-record-payment-${order.id}`}
                        >
                          <IndianRupee className="mr-1 h-3.5 w-3.5" />
                          Record payment
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
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
        itemLabel="purchase orders"
      />

      {paymentTarget && (
        <RecordSupplierPaymentDialog
          open={!!paymentTarget}
          onOpenChange={(o) => !o && setPaymentTarget(null)}
          supplierId={paymentTarget.supplierId}
          supplierName={paymentTarget.supplierName}
          presetPurchaseOrderId={paymentTarget.purchaseOrderId}
          presetPurchaseOrderBalance={paymentTarget.balance}
        />
      )}
    </div>
  );
}
