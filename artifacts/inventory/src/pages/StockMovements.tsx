import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { useListWarehouses, fetchStockMovementsPaginated } from "@/lib/queryKeys";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { format } from "date-fns";
import { Search, X } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100] as const;

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening: "Opening Stock",
  adjustment: "Adjustment",
  sale: "Sale",
  purchase: "Purchase",
  transfer_in: "Transfer In",
  transfer_out: "Transfer Out",
  transfer_cancelled: "Transfer Cancelled",
  sales_return: "Sales Return",
  purchase_return: "Purchase Return",
  shipment_cancelled: "Shipment Cancelled",
  goods_receipt_cancelled: "GRN Cancelled",
  job_work_issue: "Job Work Issue",
  job_work_receipt: "Job Work Receipt",
  job_work_receipt_cancel: "Job Work Receipt Cancel",
  job_work_scrap: "Job Work Scrap",
  damage: "Write-off (Damage)",
  expired: "Write-off (Expired)",
  lost: "Write-off (Lost)",
  theft: "Write-off (Theft)",
  shopify_order: "Shopify Order",
  shopify_sync: "Shopify Sync",
  shopify_webhook: "Shopify Update",
};

const MOVEMENT_TYPE_COLOR: Record<string, string> = {
  sale: "text-rose-700 border-rose-200 bg-rose-50 dark:text-rose-400 dark:border-rose-800/40 dark:bg-rose-900/20",
  shipment_cancelled: "text-rose-700 border-rose-200 bg-rose-50 dark:text-rose-400 dark:border-rose-800/40 dark:bg-rose-900/20",
  purchase: "text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20",
  sales_return: "text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20",
  goods_receipt_cancelled: "text-rose-700 border-rose-200 bg-rose-50 dark:text-rose-400 dark:border-rose-800/40 dark:bg-rose-900/20",
  transfer_in: "text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-800/40 dark:bg-blue-900/20",
  transfer_out: "text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-800/40 dark:bg-amber-900/20",
  transfer_cancelled: "text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20",
  opening: "text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-800/40 dark:bg-blue-900/20",
  adjustment: "text-violet-700 border-violet-200 bg-violet-50 dark:text-violet-400 dark:border-violet-800/40 dark:bg-violet-900/20",
  damage: "text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-800/40 dark:bg-orange-900/20",
  expired: "text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-800/40 dark:bg-orange-900/20",
  lost: "text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-800/40 dark:bg-orange-900/20",
  theft: "text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-400 dark:border-orange-800/40 dark:bg-orange-900/20",
};

export default function StockMovements() {
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [movementType, setMovementType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const debouncedSearch = useDebounce(search, 400);

  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return; }
    setPage(1);
  }, [debouncedSearch, warehouseId, movementType, fromDate, toDate]);

  const queryParams = {
    page,
    pageSize,
    warehouseId,
    movementType: movementType || undefined,
    search: debouncedSearch || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["stock-movements-paginated", queryParams],
    queryFn: () => fetchStockMovementsPaginated(queryParams),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: warehouses } = useListWarehouses();

  const movements = data?.movements ?? [];
  const total = data?.total ?? 0;

  const activeFilterCount = [
    !!debouncedSearch,
    !!warehouseId,
    !!movementType,
    !!fromDate,
    !!toDate,
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  function clearFilters() {
    setSearch("");
    setWarehouseId(undefined);
    setMovementType("");
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Movements"
        description="View the complete ledger of all inventory additions and deductions."
      />

      {/* Filter bar */}
      <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label className="text-xs font-medium">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder="Item name or SKU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-movements"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Warehouse */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Warehouse</Label>
            <Select
              value={warehouseId ? warehouseId.toString() : "all"}
              onValueChange={(val) => setWarehouseId(val === "all" ? undefined : parseInt(val))}
            >
              <SelectTrigger className="h-9 text-sm" data-testid="filter-warehouse">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouses?.map((w) => (
                  <SelectItem key={w.id} value={w.id.toString()}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Movement type */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Type</Label>
            <Select value={movementType || "all"} onValueChange={(val) => setMovementType(val === "all" ? "" : val)}>
              <SelectTrigger className="h-9 text-sm" data-testid="filter-movement-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(MOVEMENT_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* From date */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">From date</Label>
            <Input
              type="date"
              className="h-9 text-sm"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              data-testid="filter-from-date"
            />
          </div>

          {/* To date */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">To date</Label>
            <Input
              type="date"
              className="h-9 text-sm"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              data-testid="filter-to-date"
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">
              {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={clearFilters}>
              <X className="h-3 w-3" />
              Clear all
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Item</TableHead>
              <TableHead className="text-xs hidden md:table-cell">SKU</TableHead>
              <TableHead className="text-xs hidden lg:table-cell">Category</TableHead>
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs text-right">Qty</TableHead>
              <TableHead className="text-xs hidden sm:table-cell">Warehouse</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={10} cols={7} />
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  {hasActiveFilters ? "No movements match your filters." : "No movements found."}
                </TableCell>
              </TableRow>
            ) : (
              movements.map((movement) => (
                <TableRow key={movement.id} data-testid={`row-movement-${movement.id}`} className="hover:bg-muted/30">
                  <TableCell className="whitespace-nowrap py-2.5">
                    <span className="text-xs text-foreground font-medium">
                      {format(new Date(movement.createdAt), "dd MMM yyyy")}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {format(new Date(movement.createdAt), "h:mm a")}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <span className="text-sm font-medium leading-tight">{movement.itemName}</span>
                    {movement.itemBarcode && (
                      <span className="block text-[10px] font-mono text-muted-foreground">{movement.itemBarcode}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground py-2.5 hidden md:table-cell">
                    {movement.itemSku ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground py-2.5 hidden lg:table-cell">
                    {movement.itemCategory ?? "—"}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-medium whitespace-nowrap ${MOVEMENT_TYPE_COLOR[movement.movementType] ?? ""}`}
                    >
                      {MOVEMENT_TYPE_LABELS[movement.movementType] ?? movement.movementType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-sm py-2.5">
                    <span className={movement.quantity > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                      {movement.quantity > 0 ? "+" : ""}{movement.quantity}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground py-2.5 hidden sm:table-cell">
                    {movement.warehouseName}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS as unknown as number[]}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        itemLabel="movements"
      />
    </div>
  );
}
