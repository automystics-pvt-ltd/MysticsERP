import { Link, useSearch, useLocation } from "wouter";
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
import { useDebounce } from "@/hooks/use-debounce";
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
  const [, setLocation] = useLocation();
  const _qs = useSearch();
  const hasMounted = useRef(false);

  const [search, setSearch] = useState<string>(() => new URLSearchParams(_qs).get("q") ?? "");
  const debouncedSearch = useDebounce(search, 400);
  const [statusFilter, setStatusFilter] = useState<string>(() => new URLSearchParams(_qs).get("status") ?? "all");
  const [warehouseFilter, setWarehouseFilter] = useState<string>(() => new URLSearchParams(_qs).get("wh") ?? "all");
  const [fromDate, setFromDate] = useState<string>(() => new URLSearchParams(_qs).get("from") ?? "");
  const [toDate, setToDate] = useState<string>(() => new URLSearchParams(_qs).get("to") ?? "");
  const [page, setPage] = useState(() => Number(new URLSearchParams(_qs).get("p") ?? "1"));
  const [pageSize, setPageSize] = useState<number>(() => Number(new URLSearchParams(_qs).get("ps") ?? "15"));
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

  useEffect(() => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (warehouseFilter !== "all") p.set("wh", warehouseFilter);
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    if (page > 1) p.set("p", String(page));
    if (pageSize !== 15) p.set("ps", String(pageSize));
    const qs = p.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [search, statusFilter, warehouseFilter, fromDate, toDate, page, pageSize]);

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
  const hasDateFilter = fromDate !== "" || toDate !== "";

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

      <div className="flex flex-col sm:flex-row sm:items-end gap-4 bg-card border rounded-lg p-4">
        <div className="space-y-1 w-full sm:w-64">
          <Label>Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 pr-8"
              placeholder="Transfer #, warehouse…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="filter-transfer-search"
            />
            {search && (
              <button
                type="button"
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1 w-full sm:w-56">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="filter-transfer-status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="in_transit">In transit</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 w-full sm:w-64">
          <Label>Warehouse (source or destination)</Label>
          <Select
            value={warehouseFilter}
            onValueChange={setWarehouseFilter}
          >
            <SelectTrigger data-testid="filter-transfer-warehouse">
              <SelectValue placeholder="All Warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {warehouses?.map((w) => (
                <SelectItem key={w.id} value={w.id.toString()}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 w-full sm:w-44">
          <Label>From date</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            data-testid="filter-transfer-from-date"
          />
        </div>
        <div className="space-y-1 w-full sm:w-44">
          <Label>To date</Label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            data-testid="filter-transfer-to-date"
          />
        </div>
        {hasDateFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            data-testid="btn-clear-transfer-dates"
          >
            Clear dates
          </Button>
        )}
      </div>

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
