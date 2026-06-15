import { useState, useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/TablePagination";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";
import { useGetProfitLossReport, useListWarehouses } from "@/lib/queryKeys";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, IndianRupee } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import type { ProfitLossReportItemRow } from "@workspace/api-client-react";

const PAGE_SIZES = [15, 25, 50];

function fmtRupees(v: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v); }

export default function ReportProfitLoss() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => setPage(1), [from, to, warehouseId, search]);

  const { data: warehouses } = useListWarehouses();
  const { data: report, isLoading } = useGetProfitLossReport({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
  });

  const hasFilters = !!(from || to || warehouseId || search);
  const clearFilters = () => { setFrom(""); setTo(""); setWarehouseId(""); setSearch(""); };

  const filteredItems = (report?.byItem ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.itemName.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q);
  });
  const paged = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  type Row = ProfitLossReportItemRow;
  const exportCols: ExportColumn<Row>[] = [
    { header: "Item",          accessor: (r) => r.itemName },
    { header: "SKU",           accessor: (r) => r.sku ?? "" },
    { header: "Units",         accessor: (r) => r.units },
    { header: "Revenue (₹)",   accessor: (r) => r.revenue },
    { header: "COGS (₹)",      accessor: (r) => r.cogs },
    { header: "Gross Profit",  accessor: (r) => r.grossProfit },
    { header: "Margin %",      accessor: (r) => r.grossMarginPct },
  ];

  const summaryStats = [
    {
      label: "Revenue",
      value: report?.revenue ?? 0,
      colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      icon: TrendingUp,
    },
    {
      label: "Cost of Goods Sold",
      value: report?.cogs ?? 0,
      colorCls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
      icon: TrendingDown,
    },
    {
      label: "Gross Profit",
      value: report?.grossProfit ?? 0,
      colorCls: (report?.grossProfit ?? 0) >= 0
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      icon: IndianRupee,
    },
    {
      label: "Gross Margin",
      value: null,
      pct: report?.grossMarginPct ?? 0,
      colorCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
      icon: BarChart3,
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Profit & Loss"
        description="Revenue vs cost of goods sold with gross margin analysis."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Profit & Loss" }]}
        actions={
          <ReportExportButton
            filename="profit-loss-report"
            title="Profit & Loss Report"
            columns={exportCols}
            rows={filteredItems}
            meta={[
              { label: "Revenue", value: fmtRupees(report?.revenue ?? 0) },
              { label: "COGS", value: fmtRupees(report?.cogs ?? 0) },
              { label: "Gross Profit", value: fmtRupees(report?.grossProfit ?? 0) },
              { label: "Gross Margin", value: `${report?.grossMarginPct ?? 0}%` },
            ]}
          />
        }
      />

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
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">Clear</Button>}
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryStats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="border-border/60">
              <CardContent className="p-5 flex flex-col gap-2">
                <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", s.colorCls)}>
                  <Icon className="h-4 w-4" />
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : s.pct !== undefined ? (
                  <p className="text-2xl font-bold tabular-nums">{s.pct.toFixed(1)}%</p>
                ) : (
                  <p className="text-xl font-bold tabular-nums">{fmtRupees(s.value!)}</p>
                )}
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Revenue vs COGS Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report?.trend ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => {
                      try { return format(parseISO(v), "d MMM"); } catch { return v; }
                    }}
                    stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    formatter={(v: number, name: string) => [fmtRupees(v), name]}
                    labelFormatter={(l: string) => { try { return format(parseISO(l), "d MMM yyyy"); } catch { return l; } }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="cogs" name="COGS" fill="hsl(var(--muted-foreground))" radius={[2, 2, 0, 0]} opacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-item table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">Profit by Item</CardTitle>
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-52 h-8 text-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Gross Profit</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}</TableRow>
                  ))
                ) : paged.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-sm">
                      No data found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map((r) => (
                    <TableRow key={r.itemId} className="hover:bg-muted/30">
                      <TableCell className="py-3">
                        <p className="text-sm font-medium">{r.itemName}</p>
                        {r.sku && <p className="text-xs text-muted-foreground font-mono">{r.sku}</p>}
                      </TableCell>
                      <TableCell className="py-3 text-right text-xs tabular-nums">{r.units.toLocaleString()}</TableCell>
                      <TableCell className="py-3 text-right text-xs tabular-nums">{fmtRupees(r.revenue)}</TableCell>
                      <TableCell className="py-3 text-right text-xs tabular-nums text-muted-foreground">{fmtRupees(r.cogs)}</TableCell>
                      <TableCell className={cn("py-3 text-right text-xs font-medium tabular-nums", r.grossProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                        {fmtRupees(r.grossProfit)}
                      </TableCell>
                      <TableCell className="py-3 text-right">
                        <span className={cn("text-xs font-medium tabular-nums px-1.5 py-0.5 rounded", r.grossMarginPct >= 20 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : r.grossMarginPct >= 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400")}>
                          {r.grossMarginPct.toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {filteredItems.length > pageSize && (
        <TablePagination total={filteredItems.length} page={page} pageSize={pageSize} onPageChange={setPage} pageSizeOptions={PAGE_SIZES} onPageSizeChange={setPageSize} itemLabel="items" />
      )}
    </div>
  );
}
