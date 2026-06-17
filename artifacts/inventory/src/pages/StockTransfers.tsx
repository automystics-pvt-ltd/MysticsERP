import { Link, useLocation } from "wouter";
import { useEffect, useState, useRef, useCallback } from "react";
import { Can } from "@/components/Can";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  useListWarehouses,
  fetchStockTransfersPaginated,
} from "@/lib/queryKeys";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { Plus, ArrowRight, Upload, Search, X } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TablePagination } from "@/components/TablePagination";
import { BulkImportStockTransferDialog } from "@/components/BulkImportStockTransferDialog";
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { StockTransfer } from "@workspace/api-client-react";

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100] as const;

const EXPORT_COLUMNS: ExportColumn<StockTransfer>[] = [
  { header: "Transfer #", accessor: (r) => r.transferNumber },
  { header: "Date", accessor: (r) => r.transferDate },
  { header: "From Warehouse", accessor: (r) => r.fromWarehouseName },
  { header: "To Warehouse", accessor: (r) => r.toWarehouseName },
  { header: "Status", accessor: (r) => r.status },
  { header: "Notes", accessor: (r) => r.notes ?? "" },
];

export default function StockTransfers() {
  const hasMounted = useRef(false);
  const [, setLocation] = useLocation();

  const { values, set, setMany, reset, debouncedSearch } = useListFilters({
    search: "",
    status: "all",
    wh: "all",
    from: "",
    to: "",
  });
  const search = values.search;
  const statusFilter = values.status;
  const warehouseFilter = values.wh;
  const fromDate = values.from;
  const toDate = values.to;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [importOpen, setImportOpen] = useState(false);

  const saveScrollPos = useCallback(() => {
    sessionStorage.setItem(`scroll:${window.location.href}`, String(window.scrollY));
  }, []);

  useEffect(() => {
    const key = `scroll:${window.location.href}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      sessionStorage.removeItem(key);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          window.scrollTo({ top: Number(saved), behavior: "instant" as ScrollBehavior }),
        ),
      );
    }
  }, []);

  useEffect(() => {
    if (!hasMounted.current) return;
    setPage(1);
  }, [debouncedSearch, statusFilter, warehouseFilter, fromDate, toDate]);

  useEffect(() => { hasMounted.current = true; }, []);

  const { data: warehouses } = useListWarehouses();
  const { data, isLoading } = useQuery({
    queryKey: ["stock-transfers-paginated", { page, pageSize, debouncedSearch, statusFilter, warehouseFilter, fromDate, toDate }],
    queryFn: () => fetchStockTransfersPaginated({
      page,
      pageSize,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      warehouseId: warehouseFilter === "all" ? undefined : Number(warehouseFilter),
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const transfers: StockTransfer[] = data?.transfers ?? [];
  const total = data?.total ?? 0;


  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Transfers"
        description="Move inventory between your warehouses."
        actions={
          <div className="flex items-center gap-2">
            <ReportExportButton
              filename="stock-transfers"
              title="Stock Transfers"
              columns={EXPORT_COLUMNS}
              rows={transfers}
              hidePdf
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              data-testid="btn-import-transfers"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Can module="stock_transfers" action="create">
              <Button asChild data-testid="btn-create-transfer">
                <Link href="/transfers/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Transfer
                </Link>
              </Button>
            </Can>
          </div>
        }
      />

      <FilterBar
        search={values.search}
        onSearchChange={(v) => { set("search", v); setPage(1); }}
        searchPlaceholder="Transfer #, warehouse…"
        filterDefs={[
          {
            key: "status", label: "Status", type: "select",
            options: [
              { value: "draft", label: "Draft" },
              { value: "in_transit", label: "In transit" },
              { value: "completed", label: "Completed" },
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
        onFilterChange={(k, v) => { set(k, v); setPage(1); }}
        onReset={() => { reset(); setPage(1); }}
      />

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transfer #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>From</TableHead>
              <TableHead></TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : transfers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No transfers found.
                </TableCell>
              </TableRow>
            ) : (
              transfers.map((tr) => (
                <TableRow
                  key={tr.id}
                  data-testid={`row-transfer-${tr.id}`}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => { saveScrollPos(); setLocation(`/transfers/${tr.id}`); }}
                >
                  <TableCell className="font-mono" onClick={(e) => { e.stopPropagation(); saveScrollPos(); }}>
                    <Link
                      href={`/transfers/${tr.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {tr.transferNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(tr.transferDate)}</TableCell>
                  <TableCell>{tr.fromWarehouseName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <ArrowRight className="h-4 w-4" />
                  </TableCell>
                  <TableCell>{tr.toWarehouseName}</TableCell>
                  <TableCell>
                    <StatusBadge status={tr.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between gap-2">
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-8 w-[105px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            itemLabel="transfers"
            className="border-0 pt-0 mt-0"
          />
        </div>
      )}

      <BulkImportStockTransferDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}
