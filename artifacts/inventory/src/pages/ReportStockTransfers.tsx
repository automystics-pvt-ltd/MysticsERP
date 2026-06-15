import { useState, useEffect } from "react";
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
import { useGetStockTransfersReport, useListWarehouses } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { ArrowRight, CheckCircle2, Clock, FileX, Package, Truck } from "lucide-react";
import { Link } from "wouter";
import type { StockTransfersReportRow } from "@workspace/api-client-react";

const STATUS_META: Record<string, { label: string; colorCls: string; icon: React.ElementType }> = {
  completed:  { label: "Completed",  colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  in_transit: { label: "In Transit", colorCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",     icon: Truck },
  draft:      { label: "Draft",      colorCls: "bg-muted text-muted-foreground",                                          icon: Package },
  cancelled:  { label: "Cancelled",  colorCls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",           icon: FileX },
};

const PAGE_SIZES = [15, 25, 50];

export default function ReportStockTransfers() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => setPage(1), [from, to, warehouseId, statusFilter, search]);

  const { data: warehouses } = useListWarehouses();
  const { data: report, isLoading } = useGetStockTransfersReport({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
  });

  const hasFilters = !!(from || to || warehouseId || statusFilter !== "all" || search);
  const clearFilters = () => { setFrom(""); setTo(""); setWarehouseId(""); setStatusFilter("all"); setSearch(""); };

  const filtered = (report?.transfers ?? []).filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.transferNumber.toLowerCase().includes(q) &&
          !r.fromWarehouseName.toLowerCase().includes(q) &&
          !r.toWarehouseName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  type Row = StockTransfersReportRow;
  const exportCols: ExportColumn<Row>[] = [
    { header: "Transfer #",        accessor: (r) => r.transferNumber },
    { header: "Date",              accessor: (r) => r.transferDate },
    { header: "Status",            accessor: (r) => r.status },
    { header: "From",              accessor: (r) => r.fromWarehouseName },
    { header: "To",                accessor: (r) => r.toWarehouseName },
    { header: "Lines",             accessor: (r) => r.lineCount },
    { header: "Total Units",       accessor: (r) => r.totalUnits },
  ];

  const stats = [
    { label: "Total Transfers",   value: report?.totalTransfers ?? 0,     colorCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",       icon: Package },
    { label: "Completed",         value: report?.completedTransfers ?? 0,  colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
    { label: "In Transit",        value: report?.inTransitTransfers ?? 0,  colorCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",   icon: Truck },
    { label: "Draft",             value: report?.draftTransfers ?? 0,      colorCls: "bg-muted text-muted-foreground",                                          icon: Clock },
    { label: "Cancelled",         value: report?.cancelledTransfers ?? 0,  colorCls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",           icon: FileX },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Stock Transfers"
        description="History of warehouse-to-warehouse transfer movements."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Stock Transfers" }]}
        actions={
          <ReportExportButton
            filename="stock-transfers-report"
            title="Stock Transfers Report"
            columns={exportCols}
            rows={filtered}
          />
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="border-border/60">
              <CardContent className="p-4 flex flex-col gap-2">
                <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", s.colorCls)}>
                  <Icon className="h-4 w-4" />
                </div>
                {isLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className="text-2xl font-bold tabular-nums">{s.value.toLocaleString()}</p>
                )}
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 h-8 text-xs" />
          </div>
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
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="in_transit">In Transit</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <Input
              placeholder="Transfer # or warehouse…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-52 h-8 text-xs"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">Clear</Button>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Transfer #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-sm">
                    {hasFilters ? "No transfers match your filters." : "No stock transfers found."}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((r) => {
                  const meta = STATUS_META[r.status] ?? STATUS_META.draft;
                  const Icon = meta.icon;
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="py-3">
                        <Link href={`/stock-transfers/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                          {r.transferNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {format(parseISO(r.transferDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-medium">{r.fromWarehouseName}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="font-medium">{r.toWarehouseName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge variant="outline" className={cn("text-[10px] gap-1 inline-flex items-center", meta.colorCls)}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 text-right text-xs tabular-nums">{r.lineCount}</TableCell>
                      <TableCell className="py-3 text-right text-xs font-medium tabular-nums">{r.totalUnits.toLocaleString()}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {filtered.length > pageSize && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} pageSizeOptions={PAGE_SIZES} onPageSizeChange={setPageSize} itemLabel="transfers" />
      )}
    </div>
  );
}
