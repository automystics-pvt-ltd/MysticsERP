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
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";
import { DateRangePicker } from "@/components/DateRangePicker";

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
  const { values, set, setMany, reset, activeCount, debouncedSearch } = useListFilters({
    search: "",
    wh: "all",
    type: "all",
    from: "",
    to: "",
  });
  const warehouseId = values.wh !== "all" ? Number(values.wh) : undefined;
  const movementType = values.type !== "all" ? values.type : "";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return; }
    setPage(1);
  }, [debouncedSearch, values.wh, values.type, values.from, values.to]);

  const queryParams = {
    page,
    pageSize,
    warehouseId,
    movementType: movementType || undefined,
    search: debouncedSearch || undefined,
    fromDate: values.from || undefined,
    toDate: values.to || undefined,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Movements"
        description="View the complete ledger of all inventory additions and deductions."
      />

      <FilterBar
        search={values.search}
        onSearchChange={(v) => { set("search", v); setPage(1); }}
        searchPlaceholder="Item name or SKU…"
        filterDefs={[
          {
            key: "wh", label: "Warehouse", type: "select",
            options: (warehouses ?? []).filter((w) => !w.isVirtual).map((w) => ({ value: String(w.id), label: w.name })),
          },
          {
            key: "type", label: "Movement type", type: "select",
            options: Object.entries(MOVEMENT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
          },
          { key: "date", label: "Date range", type: "daterange", fromKey: "from", toKey: "to" },
        ]}
        filterValues={values}
        onFilterChange={(k, v) => { set(k, v); setPage(1); }}
        onReset={() => { reset(); setPage(1); }}
      />

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
                  {activeCount > 0 || debouncedSearch ? "No movements match your filters." : "No movements found."}
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
