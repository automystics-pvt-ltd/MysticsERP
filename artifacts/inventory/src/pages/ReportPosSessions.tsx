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
import { useGetPosSessionsReport, useListWarehouses } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { CircleDot, CheckCircle2, ShoppingCart, IndianRupee, Users } from "lucide-react";
import { Link } from "wouter";
import type { PosSessionReportRow } from "@workspace/api-client-react";

const PAGE_SIZES = [15, 25, 50];
function fmtRupees(v: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v); }

const STATUS_META: Record<string, { label: string; colorCls: string }> = {
  open:     { label: "Open",     colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  closed:   { label: "Closed",   colorCls: "bg-muted text-muted-foreground" },
  approved: { label: "Approved", colorCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  rejected: { label: "Rejected", colorCls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export default function ReportPosSessions() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => setPage(1), [from, to, warehouseId, statusFilter, search]);

  const { data: warehouses } = useListWarehouses();
  const { data: report, isLoading } = useGetPosSessionsReport({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
  });

  const hasFilters = !!(from || to || warehouseId || statusFilter !== "all" || search);
  const clearFilters = () => { setFrom(""); setTo(""); setWarehouseId(""); setStatusFilter("all"); setSearch(""); };

  const filtered = (report?.sessions ?? []).filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.sessionNumber.toLowerCase().includes(q) &&
          !(r.cashierName ?? "").toLowerCase().includes(q) &&
          !(r.warehouseName ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  type Row = PosSessionReportRow;
  const exportCols: ExportColumn<Row>[] = [
    { header: "Session #",      accessor: (r) => r.sessionNumber },
    { header: "Status",         accessor: (r) => r.status },
    { header: "Warehouse",      accessor: (r) => r.warehouseName ?? "" },
    { header: "Cashier",        accessor: (r) => r.cashierName ?? "" },
    { header: "Opened",         accessor: (r) => r.openedAt },
    { header: "Closed",         accessor: (r) => r.closedAt ?? "" },
    { header: "Opening Cash",   accessor: (r) => r.openingCash },
    { header: "Closing Cash",   accessor: (r) => r.closingCash ?? "" },
    { header: "Orders",         accessor: (r) => r.orderCount },
    { header: "Sales Total",    accessor: (r) => r.salesTotal },
  ];

  const statCards = [
    { label: "Total Sessions",     value: report?.totalSessions ?? 0, isCurrency: false, colorCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",   icon: ShoppingCart },
    { label: "Open Sessions",      value: report?.openSessions ?? 0,  isCurrency: false, colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CircleDot },
    { label: "Closed Sessions",    value: report?.closedSessions ?? 0, isCurrency: false, colorCls: "bg-muted text-muted-foreground",                                     icon: CheckCircle2 },
    { label: "Total Sales",        value: report?.totalSales ?? 0,    isCurrency: true,  colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: IndianRupee },
    { label: "Avg Sales/Session",  value: report?.avgSalesPerSession ?? 0, isCurrency: true, colorCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400", icon: Users },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="POS Sessions"
        description="Point-of-sale session performance and cash reconciliation."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "POS Sessions" }]}
        actions={
          <ReportExportButton
            filename="pos-sessions-report"
            title="POS Sessions Report"
            columns={exportCols}
            rows={filtered}
            meta={[
              { label: "Total Sales", value: fmtRupees(report?.totalSales ?? 0) },
              { label: "Sessions", value: String(report?.totalSessions ?? 0) },
            ]}
          />
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="border-border/60">
              <CardContent className="p-4 flex flex-col gap-2">
                <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", s.colorCls)}>
                  <Icon className="h-4 w-4" />
                </div>
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <p className="text-xl font-bold tabular-nums">
                    {s.isCurrency ? fmtRupees(s.value) : s.value.toLocaleString()}
                  </p>
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
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <Input placeholder="Session # or cashier…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48 h-8 text-xs" />
          </div>
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">Clear</Button>}
        </CardContent>
      </Card>

      {/* Table */}
      <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Session #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Sales Total</TableHead>
                <TableHead className="text-right">Cash Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground text-sm">
                    {hasFilters ? "No sessions match your filters." : "No POS sessions found."}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((r) => {
                  const meta = STATUS_META[r.status] ?? STATUS_META.closed;
                  const cashVariance = r.closingCash != null
                    ? r.closingCash - r.openingCash - r.salesTotal
                    : null;
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="py-3">
                        <Link href={`/pos/sessions/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                          {r.sessionNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge variant="outline" className={cn("text-[10px]", meta.colorCls)}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="py-3 text-xs">{r.warehouseName ?? "—"}</TableCell>
                      <TableCell className="py-3 text-xs">{r.cashierName ?? "—"}</TableCell>
                      <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {format(parseISO(r.openedAt), "dd MMM, h:mm a")}
                      </TableCell>
                      <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {r.closedAt ? format(parseISO(r.closedAt), "dd MMM, h:mm a") : "—"}
                      </TableCell>
                      <TableCell className="py-3 text-right text-xs tabular-nums">{r.orderCount}</TableCell>
                      <TableCell className="py-3 text-right text-xs font-medium tabular-nums">{fmtRupees(r.salesTotal)}</TableCell>
                      <TableCell className="py-3 text-right">
                        {cashVariance == null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span className={cn("text-xs font-medium tabular-nums", Math.abs(cashVariance) < 1 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                            {cashVariance >= 0 ? "+" : ""}{fmtRupees(cashVariance)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {filtered.length > pageSize && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} pageSizeOptions={PAGE_SIZES} onPageSizeChange={setPageSize} itemLabel="sessions" />
      )}
    </div>
  );
}
