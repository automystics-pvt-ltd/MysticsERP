import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useGetReturnsReport, useListWarehouses } from "@/lib/queryKeys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/TablePagination";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";
import { Link } from "wouter";
import { RotateCcw } from "lucide-react";

const REASON_LABELS: Record<string, string> = {
  customer_request: "Customer Request",
  damaged: "Damaged / Defective",
  wrong_item: "Wrong Item Sent",
  quality: "Quality Issue",
  other: "Other",
};

export default function ReportReturns() {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data: warehouses } = useListWarehouses();

  const { data: report, isLoading } = useGetReturnsReport({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  });

  const hasFilters = !!(from || to || warehouseId || reasonCode);
  const clearFilters = () => { setFrom(""); setTo(""); setWarehouseId(""); setReasonCode(""); };
  useEffect(() => setPage(1), [from, to, warehouseId, reasonCode]);

  const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];
  const [pageSize, setPageSize] = useState(15);
  const rows = report?.rows ?? [];
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  type Row = NonNullable<typeof rows>[number];
  const exportColumns: ExportColumn<Row>[] = [
    { header: "Shipment #", accessor: (r) => r.shipmentNumber ?? "" },
    { header: "Order #", accessor: (r) => r.orderNumber },
    { header: "Customer", accessor: (r) => r.customerName },
    { header: "Warehouse", accessor: (r) => r.warehouseName },
    { header: "Reason", accessor: (r) => r.cancelReasonCode ? (REASON_LABELS[r.cancelReasonCode] ?? r.cancelReasonCode) : "—" },
    { header: "Notes", accessor: (r) => r.cancelReasonNotes ?? "" },
    { header: "Units Returned", accessor: (r) => r.unitsReturned },
    { header: "Cancelled At", accessor: (r) => r.cancelledAt ? formatDate(r.cancelledAt) : "" },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Returns Report"
        description="Cancelled shipments and returned units by reason."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Returns" }]}
        actions={
          <ReportExportButton
            filename="returns-report"
            title="Returns Report"
            columns={exportColumns}
            rows={rows}
            disabled={isLoading}
            meta={[
              { label: "Total Cancelled Shipments", value: String(report?.totalShipments ?? 0) },
              { label: "Total Units Returned", value: String(report?.totalUnits ?? 0) },
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
            <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                {warehouses?.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All reasons" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
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
            <p className="text-sm font-medium text-muted-foreground mb-1">Cancelled Shipments</p>
            <p className="text-3xl font-bold">{isLoading ? "…" : (report?.totalShipments ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Units Returned</p>
            <p className="text-3xl font-bold">{isLoading ? "…" : (report?.totalUnits ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Return Reasons</p>
            <p className="text-3xl font-bold">{isLoading ? "…" : (report?.byReason?.length ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown by reason */}
      {!isLoading && (report?.byReason?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By Return Reason</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Shipments</TableHead>
                  <TableHead className="text-right">Units Returned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report!.byReason.map((r) => (
                  <TableRow key={r.reasonCode ?? "unknown"}>
                    <TableCell>
                      <Badge variant="secondary">
                        {r.reasonCode ? (REASON_LABELS[r.reasonCode] ?? r.reasonCode) : "Unknown / Not specified"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{r.shipmentCount}</TableCell>
                    <TableCell className="text-right font-medium">{r.unitsReturned}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detailed rows */}
      <Card>
        <CardHeader>
          <CardTitle>Cancelled Shipments Detail</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <RotateCcw className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm">No cancelled shipments found{hasFilters ? " for the selected filters" : ""}.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipment #</TableHead>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead>Cancelled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((r) => (
                  <TableRow key={r.shipmentId}>
                    <TableCell className="font-mono text-xs">{r.shipmentNumber ?? `#${r.shipmentId}`}</TableCell>
                    <TableCell>
                      <Link href={`/sales-orders/${r.salesOrderId}`} className="font-mono text-primary hover:underline text-sm">
                        {r.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>{r.warehouseName}</TableCell>
                    <TableCell>
                      {r.cancelReasonCode ? (
                        <Badge variant="outline" className="text-xs">
                          {REASON_LABELS[r.cancelReasonCode] ?? r.cancelReasonCode}
                        </Badge>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {r.cancelReasonNotes ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">{r.unitsReturned}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.cancelledAt ? formatDate(r.cancelledAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TablePagination pageSizeOptions={PAGE_SIZE_OPTIONS} onPageSizeChange={setPageSize}
        total={rows.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        itemLabel="shipments"
      />
    </div>
  );
}
