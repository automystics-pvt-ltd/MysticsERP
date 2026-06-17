import { useState } from "react";
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
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";
import { DateRangePicker } from "@/components/DateRangePicker";
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
  const { values, set, setMany, reset, debouncedSearch } = useListFilters({
    search: "",
    status: "all",
    overdue: "false",
    wh: "all",
    from: "",
    to: "",
    sort: "date",
    sortDir: "desc",
  });
  const search = values.search;
  const statusFilter = values.status;
  const overdueFilter = values.overdue === "true";
  const warehouseFilter = values.wh;
  const fromDate = values.from;
  const toDate = values.to;
  const sortBy = values.sort;
  const sortDir = values.sortDir as "asc" | "desc";

  const { data: warehouses } = useListWarehouses();
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);

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


  const overdueButtonPO = (
    <Button
      variant={overdueFilter ? "default" : "outline"}
      size="sm"
      className={overdueFilter
        ? "h-9 gap-1.5 bg-orange-600 hover:bg-orange-700 border-orange-600 text-white"
        : "h-9 gap-1.5 text-muted-foreground"}
      onClick={() => { setMany({ overdue: overdueFilter ? "false" : "true", status: "all" }); setPage(1); }}
      data-testid="filter-po-overdue"
    >
      <AlertCircle className="h-3.5 w-3.5" />
      Overdue
      {overdueFilter && <X className="h-3 w-3 ml-0.5 opacity-70" />}
    </Button>
  );

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
    const newDir: "asc" | "desc" = values.sort === col ? (values.sortDir === "desc" ? "asc" : "desc") : "desc";
    setMany({ sort: col, sortDir: newDir });
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

      <FilterBar
        search={values.search}
        onSearchChange={(v) => { set("search", v); setPage(1); }}
        searchPlaceholder="Order # or supplier name…"
        filterDefs={[
          {
            key: "status", label: "Status", type: "select",
            options: [
              { value: "outstanding", label: "Outstanding (unpaid)" },
              { value: "draft", label: "Draft" },
              { value: "ordered", label: "Ordered" },
              { value: "partially_received", label: "Partially Received" },
              { value: "received", label: "Received" },
              { value: "billed", label: "Billed" },
              { value: "paid", label: "Paid" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          {
            key: "wh", label: "Warehouse", type: "select",
            options: (warehouses ?? []).filter((w) => !w.isVirtual).map((w) => ({ value: String(w.id), label: w.name })),
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
        sortDefs={[
          { key: "date", label: "Order Date" },
          { key: "total", label: "Total" },
          { key: "balance", label: "Balance Due" },
        ]}
        sortValues={{ sortBy: values.sort, sortDir: values.sortDir as "asc" | "desc" }}
        onSortChange={(s, d) => { setMany({ sort: s, sortDir: d }); setPage(1); }}
        rightSlot={overdueButtonPO}
        onReset={() => { reset(); setPage(1); }}
      />

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
                    : (statusFilter !== "all" || !!search.trim() || !!fromDate || !!toDate || warehouseFilter !== "all")
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
