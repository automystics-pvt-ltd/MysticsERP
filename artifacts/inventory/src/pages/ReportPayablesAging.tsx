import { useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import {
  useGetPayablesAgingReport,
  getGetPayablesAgingReportQueryKey,
} from "@/lib/queryKeys";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/TablePagination";
import { formatCurrency } from "@/lib/format";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ReportPayablesAging() {
  const { data, isLoading } = useGetPayablesAgingReport({
    query: { queryKey: getGetPayablesAgingReportQueryKey() },
  });

  const [supplierSearch, setSupplierSearch] = useState("");

  const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);

  const filteredRows = (data?.rows ?? []).filter((r) =>
    supplierSearch.trim() === "" ||
    r.supplierName.toLowerCase().includes(supplierSearch.trim().toLowerCase())
  );
  const total = filteredRows.length;
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const filteredTotals = filteredRows.reduce(
    (acc, r) => ({
      current: acc.current + Number(r.current),
      b30: acc.b30 + Number(r.b30),
      b60: acc.b60 + Number(r.b60),
      b90: acc.b90 + Number(r.b90),
      b90plus: acc.b90plus + Number(r.b90plus),
      total: acc.total + Number(r.total),
    }),
    { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0, total: 0 },
  );

  type Row = NonNullable<typeof data>["rows"][number];
  const exportColumns: ExportColumn<Row>[] = [
    { header: "Supplier", accessor: (r) => r.supplierName },
    { header: "Current", accessor: (r) => r.current },
    { header: "1-30", accessor: (r) => r.b30 },
    { header: "31-60", accessor: (r) => r.b60 },
    { header: "61-90", accessor: (r) => r.b90 },
    { header: "90+", accessor: (r) => r.b90plus },
    { header: "Total", accessor: (r) => r.total },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payables Aging"
        description="Outstanding supplier balances bucketed by age."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Payables Aging" }]}
        actions={
          <ReportExportButton
            filename="payables-aging"
            title="Payables Aging"
            columns={exportColumns}
            rows={filteredRows}
            disabled={isLoading}
            meta={
              data
                ? [{ label: "Grand Total Outstanding", value: formatCurrency(filteredTotals.total) }]
                : []
            }
          />
        }
      />

      <div className="flex flex-wrap items-end gap-4 bg-card border rounded-lg p-4">
        <div className="relative space-y-1 w-full sm:w-72">
          <Label>Search supplier</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by supplier name…"
              value={supplierSearch}
              onChange={(e) => { setSupplierSearch(e.target.value); setPage(1); }}
              className="pl-8"
              data-testid="filter-payables-aging-supplier"
            />
          </div>
        </div>
        {supplierSearch && (
          <div className="space-y-1">
            <Label className="invisible">Clear</Label>
            <Button variant="ghost" size="sm" onClick={() => { setSupplierSearch(""); setPage(1); }}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {supplierSearch ? "No suppliers match your search." : "No outstanding payables. Everything is current."}
            </p>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">1-30</TableHead>
                  <TableHead className="text-right">31-60</TableHead>
                  <TableHead className="text-right">61-90</TableHead>
                  <TableHead className="text-right">90+</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((r) => (
                  <TableRow
                    key={r.supplierId}
                    data-testid={`row-payables-aging-${r.supplierId}`}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/supplier-payments?supplierId=${r.supplierId}`}
                        className="text-primary hover:underline"
                      >
                        {r.supplierName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(r.current)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(r.b30)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(r.b60)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(r.b90)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">
                      {formatCurrency(r.b90plus)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(r.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Totals</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(filteredTotals.current)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(filteredTotals.b30)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(filteredTotals.b60)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(filteredTotals.b90)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(filteredTotals.b90plus)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(filteredTotals.total)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            <TablePagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} itemLabel="suppliers" pageSizeOptions={PAGE_SIZE_OPTIONS} onPageSizeChange={setPageSize} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
