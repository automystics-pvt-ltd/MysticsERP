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
import { useGetShopifyOrdersReport, useListWarehouses } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { ShoppingBag, IndianRupee, TrendingUp, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ShopifyOrderReportRow } from "@workspace/api-client-react";

const PAGE_SIZES = [15, 25, 50];
function fmtRupees(v: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v); }

const ORDER_STATUS_COLORS: Record<string, string> = {
  draft:             "bg-muted text-muted-foreground",
  confirmed:         "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  partially_shipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  shipped:           "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:         "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function ReportShopifyOrders() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => setPage(1), [from, to, warehouseId, statusFilter, search]);

  const { data: warehouses } = useListWarehouses();
  const { data: report, isLoading } = useGetShopifyOrdersReport({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
  });

  const hasFilters = !!(from || to || warehouseId || statusFilter !== "all" || search);
  const clearFilters = () => { setFrom(""); setTo(""); setWarehouseId(""); setStatusFilter("all"); setSearch(""); };

  const filtered = (report?.orders ?? []).filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.orderNumber.toLowerCase().includes(q) &&
          !(r.customerName ?? "").toLowerCase().includes(q) &&
          !(r.shopifyOrderId ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  type Row = ShopifyOrderReportRow;
  const exportCols: ExportColumn<Row>[] = [
    { header: "Order #",       accessor: (r) => r.orderNumber },
    { header: "Shopify ID",    accessor: (r) => r.shopifyOrderId ?? "" },
    { header: "Date",          accessor: (r) => r.orderDate },
    { header: "Status",        accessor: (r) => r.status },
    { header: "Customer",      accessor: (r) => r.customerName ?? "" },
    { header: "Warehouse",     accessor: (r) => r.warehouseName ?? "" },
    { header: "Total (₹)",     accessor: (r) => r.total },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Shopify Orders"
        description="Sales orders imported from your Shopify store."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Shopify Orders" }]}
        actions={
          <ReportExportButton
            filename="shopify-orders-report"
            title="Shopify Orders Report"
            columns={exportCols}
            rows={filtered}
            meta={[
              { label: "Total Orders", value: String(report?.totalOrders ?? 0) },
              { label: "Total Revenue", value: fmtRupees(report?.totalRevenue ?? 0) },
              { label: "Avg Order Value", value: fmtRupees(report?.avgOrderValue ?? 0) },
            ]}
          />
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Total Orders",     value: report?.totalOrders ?? 0,    isCurrency: false, colorCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400", icon: ShoppingBag },
          { label: "Total Revenue",    value: report?.totalRevenue ?? 0,   isCurrency: true,  colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: IndianRupee },
          { label: "Avg Order Value",  value: report?.avgOrderValue ?? 0,  isCurrency: true,  colorCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",   icon: TrendingUp },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="border-border/60">
              <CardContent className="p-5 flex flex-col gap-2">
                <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", s.colorCls)}>
                  <Icon className="h-4 w-4" />
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  <p className="text-2xl font-bold tabular-nums">
                    {s.isCurrency ? fmtRupees(s.value) : s.value.toLocaleString()}
                  </p>
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
          <CardTitle className="text-sm font-semibold">Revenue Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[240px] w-full">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={report?.trend ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="shopifyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => { try { return format(parseISO(v), "d MMM"); } catch { return v; } }}
                    stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    formatter={(v: number) => [fmtRupees(v), "Revenue"]}
                    labelFormatter={(l: string) => { try { return format(parseISO(l), "d MMM yyyy"); } catch { return l; } }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#shopifyGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

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
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="partially_shipped">Partially Shipped</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <Input placeholder="Order # or customer…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48 h-8 text-xs" />
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
                <TableHead>Order #</TableHead>
                <TableHead>Shopify ID</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground text-sm">
                    {hasFilters ? "No orders match your filters." : "No Shopify orders found."}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell className="py-3">
                      <Link href={`/sales-orders/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                        {r.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                        {r.shopifyOrderId ?? "—"}
                        {r.shopifyOrderId && <ExternalLink className="h-3 w-3 shrink-0" />}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {format(parseISO(r.orderDate), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="py-3 text-xs">{r.customerName ?? "—"}</TableCell>
                    <TableCell className="py-3 text-xs">{r.warehouseName ?? "—"}</TableCell>
                    <TableCell className="py-3">
                      <Badge variant="outline" className={cn("text-[10px] capitalize", ORDER_STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground")}>
                        {r.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-right text-xs font-medium tabular-nums">{fmtRupees(r.total)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {filtered.length > pageSize && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} pageSizeOptions={PAGE_SIZES} onPageSizeChange={setPageSize} itemLabel="orders" />
      )}
    </div>
  );
}
