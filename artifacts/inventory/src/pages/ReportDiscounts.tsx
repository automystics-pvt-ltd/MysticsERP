import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useGetDiscountsReport, useListCustomers, useListWarehouses } from "@/lib/queryKeys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/TablePagination";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";
import { Tag } from "lucide-react";

export default function ReportDiscounts() {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data: customers } = useListCustomers();
  const { data: warehouses } = useListWarehouses();

  const { data: report, isLoading } = useGetDiscountsReport({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(customerId ? { customerId: Number(customerId) } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
  });

  const hasFilters = !!(from || to || customerId || warehouseId);
  const clearFilters = () => { setFrom(""); setTo(""); setCustomerId(""); setWarehouseId(""); };
  useEffect(() => setPage(1), [from, to, customerId, warehouseId]);

  const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];
  const [pageSize, setPageSize] = useState(15);
  const byItem = report?.byItem ?? [];
  const pagedItems = byItem.slice((page - 1) * pageSize, page * pageSize);

  type ItemRow = NonNullable<typeof byItem>[number];
  const exportColumns: ExportColumn<ItemRow>[] = [
    { header: "SKU", accessor: (r) => r.sku },
    { header: "Item Name", accessor: (r) => r.itemName },
    { header: "Units Discounted", accessor: (r) => r.unitsDiscounted },
    { header: "Total Discount Given", accessor: (r) => r.discountTotal },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Discounts Report"
        description="Discounts given across sales orders, broken down by item."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Discounts" }]}
        actions={
          <ReportExportButton
            filename="discounts-report"
            title="Discounts Report"
            columns={exportColumns}
            rows={byItem}
            disabled={isLoading}
            meta={[
              { label: "Total Discount Given", value: formatCurrency(report?.totalDiscount ?? 0) },
              { label: "Discounted Lines", value: String(report?.lineCount ?? 0) },
              { label: "Orders with Discounts", value: String(report?.orderCount ?? 0) },
            ]}
          />
        }
      />

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Customer</label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All customers" />
              </SelectTrigger>
              <SelectContent>
                {customers?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                {warehouses?.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
          )}
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Total Discounts Given</p>
            <p className="text-3xl font-bold text-amber-600">
              {isLoading ? "…" : formatCurrency(report?.totalDiscount ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Discounted Order Lines</p>
            <p className="text-3xl font-bold">{isLoading ? "…" : (report?.lineCount ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Orders with Discounts</p>
            <p className="text-3xl font-bold">{isLoading ? "…" : (report?.orderCount ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend chart */}
      {!isLoading && (report?.trend?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Discount Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={report!.trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorDiscount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => format(parseISO(v), "d MMM")}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label: string) => format(parseISO(label), "d MMM yyyy")}
                  />
                  <Area
                    type="monotone"
                    dataKey="discountTotal"
                    name="Discounts"
                    stroke="hsl(var(--primary))"
                    fillOpacity={1}
                    fill="url(#colorDiscount)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* By item table */}
      <Card>
        <CardHeader>
          <CardTitle>Discounts by Item</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : byItem.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Tag className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm">No discounted orders found{hasFilters ? " for the selected filters" : ""}.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead className="text-right">Units Discounted</TableHead>
                  <TableHead className="text-right font-bold">Total Discount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedItems.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.sku}</TableCell>
                    <TableCell className="font-medium">{r.itemName}</TableCell>
                    <TableCell className="text-right">{Number(r.unitsDiscounted).toFixed(0)}</TableCell>
                    <TableCell className="text-right font-semibold text-amber-600">
                      {formatCurrency(r.discountTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TablePagination
        total={byItem.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={setPageSize}
        itemLabel="items"
      />
    </div>
  );
}
