import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/TablePagination";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";
import { useGetInventoryAgeingReport, useListWarehouses } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Clock, Package, Warehouse } from "lucide-react";
import { Link } from "wouter";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import type { InventoryAgeingItem } from "@workspace/api-client-react";

const PAGE_SIZES = [15, 25, 50, 100];
function fmtRupees(v: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v); }

const BUCKET_COLORS: Record<string, string> = {
  "0–30 days":   "#22c55e",
  "31–60 days":  "#f59e0b",
  "61–90 days":  "#f97316",
  "91–180 days": "#ef4444",
  "181+ days":   "#991b1b",
};
const BUCKET_BADGE: Record<string, string> = {
  "0–30 days":   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "31–60 days":  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "61–90 days":  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "91–180 days": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "181+ days":   "bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300",
};

export default function ReportInventoryAgeing() {
  const [warehouseId, setWarehouseId] = useState("");
  const [bucketFilter, setBucketFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => setPage(1), [warehouseId, bucketFilter, search]);

  const { data: warehouses } = useListWarehouses();
  const { data: report, isLoading } = useGetInventoryAgeingReport(
    warehouseId ? { warehouseId: Number(warehouseId) } : undefined,
  );

  const hasFilters = !!(warehouseId || bucketFilter !== "all" || search);
  const clearFilters = () => { setWarehouseId(""); setBucketFilter("all"); setSearch(""); };

  const filtered = useMemo(() =>
    (report?.items ?? []).filter((r) => {
      if (bucketFilter !== "all" && r.ageBucket !== bucketFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.itemName.toLowerCase().includes(q) &&
            !(r.sku ?? "").toLowerCase().includes(q) &&
            !r.warehouseName.toLowerCase().includes(q)) return false;
      }
      return true;
    }),
  [report?.items, bucketFilter, search]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  type Row = InventoryAgeingItem;
  const exportCols: ExportColumn<Row>[] = [
    { header: "Item",           accessor: (r) => r.itemName },
    { header: "SKU",            accessor: (r) => r.sku ?? "" },
    { header: "Warehouse",      accessor: (r) => r.warehouseName },
    { header: "Stock (units)",  accessor: (r) => r.currentStock },
    { header: "Stock Value",    accessor: (r) => r.stockValue },
    { header: "Last Receipt",   accessor: (r) => r.lastReceiptDate ?? "" },
    { header: "Age (days)",     accessor: (r) => r.ageDays },
    { header: "Age Bucket",     accessor: (r) => r.ageBucket },
  ];

  const pieData = (report?.summary ?? [])
    .filter((s) => s.itemCount > 0)
    .map((s) => ({ name: s.bucket, value: s.itemCount, stockValue: s.stockValue }));

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Inventory Ageing"
        description="How long your current stock has been sitting, based on last receipt date."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Inventory Ageing" }]}
        actions={
          <ReportExportButton
            filename="inventory-ageing-report"
            title="Inventory Ageing Report"
            columns={exportCols}
            rows={filtered}
          />
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="All warehouses" /></SelectTrigger>
              <SelectContent>
                {(warehouses ?? []).filter((w) => !w.isVirtual).map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Age Bucket</label>
            <Select value={bucketFilter} onValueChange={setBucketFilter}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All buckets</SelectItem>
                <SelectItem value="0–30 days">0–30 days</SelectItem>
                <SelectItem value="31–60 days">31–60 days</SelectItem>
                <SelectItem value="61–90 days">61–90 days</SelectItem>
                <SelectItem value="91–180 days">91–180 days</SelectItem>
                <SelectItem value="181+ days">181+ days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <Input placeholder="Item name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-52 h-8 text-xs" />
          </div>
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">Clear</Button>}
        </CardContent>
      </Card>

      {/* Summary grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Bucket summary cards */}
        <div className="grid grid-cols-1 gap-2">
          {(report?.summary ?? Array.from({ length: 5 })).map((s: any, i) => {
            const label = s?.bucket ?? "Loading…";
            const badgeCls = BUCKET_BADGE[label] ?? "bg-muted text-muted-foreground";
            return (
              <div key={i} className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3">
                {isLoading ? (
                  <Skeleton className="h-4 w-32" />
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ background: BUCKET_COLORS[label] }} />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <p className="text-xs text-muted-foreground">Items</p>
                        <p className="text-sm font-bold tabular-nums">{s.itemCount.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Value</p>
                        <p className="text-sm font-bold tabular-nums">{fmtRupees(s.stockValue)}</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Pie chart */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Item Distribution by Age</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Skeleton className="h-40 w-40 rounded-full" />
                </div>
              ) : pieData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      strokeWidth={1}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={BUCKET_COLORS[entry.name] ?? "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, _n: string, props: any) => [`${v} items · ${fmtRupees(props.payload?.stockValue ?? 0)}`, props.payload?.name]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Item</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Stock Value</TableHead>
                <TableHead>Last Receipt</TableHead>
                <TableHead className="text-right">Age (days)</TableHead>
                <TableHead>Bucket</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground text-sm">
                    {hasFilters ? "No items match your filters." : "No inventory data with stock > 0."}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((r, i) => (
                  <TableRow key={`${r.itemId}-${r.warehouseId}-${i}`} className="hover:bg-muted/30">
                    <TableCell className="py-3">
                      <Link href={`/items/${r.itemId}`} className="text-sm font-medium text-foreground hover:text-primary hover:underline">
                        {r.itemName}
                      </Link>
                      {r.sku && <p className="text-xs font-mono text-muted-foreground">{r.sku}</p>}
                    </TableCell>
                    <TableCell className="py-3 text-xs">
                      <div className="flex items-center gap-1">
                        <Warehouse className="h-3 w-3 text-muted-foreground" />
                        {r.warehouseName}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 text-right text-xs font-medium tabular-nums">{r.currentStock.toLocaleString()}</TableCell>
                    <TableCell className="py-3 text-right text-xs tabular-nums">{fmtRupees(r.stockValue)}</TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {r.lastReceiptDate
                        ? (() => { try { return format(parseISO(r.lastReceiptDate), "dd MMM yyyy"); } catch { return r.lastReceiptDate; } })()
                        : <span className="opacity-50">No receipt</span>}
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <span className={cn("text-xs font-bold tabular-nums", r.ageDays > 90 ? "text-red-600 dark:text-red-400" : r.ageDays > 30 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                        {r.ageDays}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge variant="outline" className={cn("text-[10px] whitespace-nowrap", BUCKET_BADGE[r.ageBucket] ?? "bg-muted text-muted-foreground")}>
                        {r.ageBucket}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {filtered.length > pageSize && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} pageSizeOptions={PAGE_SIZES} onPageSizeChange={setPageSize} itemLabel="items" />
      )}
    </div>
  );
}
