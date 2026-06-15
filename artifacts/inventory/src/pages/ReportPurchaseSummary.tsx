import { PageHeader } from "@/components/PageHeader";
import {
  useGetPurchaseSummaryReport,
  useListSuppliers,
  useListWarehouses,
  type PurchaseBySupplier,
  type PurchaseTopItem,
} from "@/lib/queryKeys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { TablePagination } from "@/components/TablePagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";

export default function ReportPurchaseSummary() {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");

  const { data: suppliers } = useListSuppliers();
  const { data: warehouses } = useListWarehouses();

  const { data: report, isLoading } = useGetPurchaseSummaryReport({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(supplierId ? { supplierId: Number(supplierId) } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
  });

  const hasFilters = !!(from || to || supplierId || warehouseId);
  const clearFilters = () => {
    setFrom("");
    setTo("");
    setSupplierId("");
    setWarehouseId("");
  };

  const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [from, to, supplierId, warehouseId]);

  if (isLoading || !report) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const months = report.months;
  const bySupplier = report.bySupplier;
  const topItems = report.topItems;

  const exportSupplierCols: ExportColumn<PurchaseBySupplier>[] = [
    { header: "Supplier", accessor: (r) => r.supplierName },
    { header: "Orders", accessor: (r) => r.orderCount },
    ...months.map((m) => ({
      header: format(parseISO(`${m}-01`), "MMM yyyy"),
      accessor: (r: PurchaseBySupplier) =>
        r.monthlyBreakdown.find((x) => x.month === m)?.total ?? 0,
    })),
    { header: "Total Spend (₹)", accessor: (r) => r.total },
  ];

  const exportItemCols: ExportColumn<PurchaseTopItem>[] = [
    { header: "Item", accessor: (r) => r.itemName },
    { header: "SKU", accessor: (r) => r.sku },
    { header: "POs", accessor: (r) => r.orderCount },
    { header: "Qty Ordered", accessor: (r) => r.totalQty },
    { header: "Total Spend (₹)", accessor: (r) => r.totalSpend },
  ];

  const pagedSuppliers = bySupplier.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader
        title="Purchase Summary"
        description="Procurement expenses and supplier performance."
        backHref="/reports"
        breadcrumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Purchase Summary" },
        ]}
        actions={
          <ReportExportButton
            filename="purchase-summary"
            title="Purchase Summary — by Supplier"
            columns={exportSupplierCols}
            rows={bySupplier}
            meta={[
              { label: "Total Purchases", value: formatCurrency(report.totalPurchases) },
              { label: "Order Count", value: String(report.orderCount) },
              { label: "Average Order Value", value: formatCurrency(report.averageOrderValue) },
            ]}
          />
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="purchase-from">
              From
            </label>
            <Input
              id="purchase-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-report-from"
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="purchase-to">
              To
            </label>
            <Input
              id="purchase-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-report-to"
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Supplier</label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-48" data-testid="select-report-supplier">
                <SelectValue placeholder="All suppliers" />
              </SelectTrigger>
              <SelectContent>
                {suppliers?.suppliers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-48" data-testid="select-report-warehouse">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                {warehouses?.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              data-testid="button-report-clear"
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p
              className="text-sm font-medium text-muted-foreground mb-1"
              data-testid="text-stat-title-total-purchases"
            >
              Total Purchases
            </p>
            <p
              className="text-3xl font-bold text-orange-600"
              data-testid="text-stat-value-total-purchases"
            >
              {formatCurrency(report.totalPurchases)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p
              className="text-sm font-medium text-muted-foreground mb-1"
              data-testid="text-stat-title-order-count"
            >
              Orders Count
            </p>
            <p className="text-3xl font-bold" data-testid="text-stat-value-order-count">
              {report.orderCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p
              className="text-sm font-medium text-muted-foreground mb-1"
              data-testid="text-stat-title-avg-order"
            >
              Average Order Value
            </p>
            <p className="text-3xl font-bold" data-testid="text-stat-value-avg-order">
              {formatCurrency(report.averageOrderValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Purchase Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={report.trend}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(var(--destructive))"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(var(--destructive))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickFormatter={(val) => format(parseISO(val), "d MMM")}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label: string) =>
                    format(parseISO(label), "d MMM yyyy")
                  }
                />
                <Area
                  type="monotone"
                  dataKey="purchases"
                  name="Purchases"
                  stroke="hsl(var(--destructive))"
                  fillOpacity={1}
                  fill="url(#colorPurchases)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Drill-down tabs */}
      <Tabs defaultValue="by-supplier">
        <TabsList>
          <TabsTrigger value="by-supplier" data-testid="tab-by-supplier">
            By Supplier
          </TabsTrigger>
          <TabsTrigger value="top-items" data-testid="tab-top-items">
            Top Items
            {topItems.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {topItems.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Supplier pivot table */}
        <TabsContent value="by-supplier" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Purchases by Supplier</CardTitle>
              {months.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Monthly breakdown · {months.length} month
                  {months.length !== 1 ? "s" : ""}
                </p>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 min-w-[180px]">Supplier</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    {months.map((m) => (
                      <TableHead key={m} className="text-right min-w-[110px]">
                        {format(parseISO(`${m}-01`), "MMM yy")}
                      </TableHead>
                    ))}
                    <TableHead className="text-right font-bold pr-6 min-w-[120px]">
                      Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedSuppliers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3 + months.length}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No purchase data for the selected filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedSuppliers.map((row) => {
                      const mbMap = new Map(
                        row.monthlyBreakdown.map((x) => [x.month, x.total]),
                      );
                      return (
                        <TableRow key={row.supplierId}>
                          <TableCell className="pl-6 font-medium">
                            {row.supplierName}
                          </TableCell>
                          <TableCell className="text-right">{row.orderCount}</TableCell>
                          {months.map((m) => {
                            const v = mbMap.get(m) ?? 0;
                            return (
                              <TableCell key={m} className="text-right text-muted-foreground">
                                {v > 0 ? (
                                  formatCurrency(v)
                                ) : (
                                  <span className="opacity-30">—</span>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right font-semibold pr-6">
                            {formatCurrency(row.total)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="mt-2">
            <TablePagination
              total={bySupplier.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              itemLabel="suppliers"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={setPageSize}
            />
          </div>
        </TabsContent>

        {/* Top 10 items */}
        <TabsContent value="top-items" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Top Purchased Items</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  By total spend for the selected period
                </p>
              </div>
              <ReportExportButton
                filename="purchase-top-items"
                title="Top Purchased Items"
                columns={exportItemCols}
                rows={topItems}
                meta={[
                  {
                    label: "Total Purchases",
                    value: formatCurrency(report.totalPurchases),
                  },
                ]}
              />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 w-10">#</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                    <TableHead className="text-right">Qty Ordered</TableHead>
                    <TableHead className="text-right font-bold pr-6">Total Spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topItems.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No item-level purchase data for the selected filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    topItems.map((item, i) => (
                      <TableRow key={item.itemId}>
                        <TableCell className="pl-6 text-muted-foreground text-sm font-mono">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">{item.itemName}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-sm">
                          {item.sku}
                        </TableCell>
                        <TableCell className="text-right">{item.orderCount}</TableCell>
                        <TableCell className="text-right">
                          {item.totalQty.toLocaleString("en-IN", {
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-semibold pr-6">
                          {formatCurrency(item.totalSpend)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
