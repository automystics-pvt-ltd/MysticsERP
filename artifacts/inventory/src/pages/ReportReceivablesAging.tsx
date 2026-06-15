import { useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import {
  useGetReceivablesAgingReport,
  getGetReceivablesAgingReportQueryKey,
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

export default function ReportReceivablesAging() {
  const { data, isLoading } = useGetReceivablesAgingReport({
    query: { queryKey: getGetReceivablesAgingReportQueryKey() },
  });

  const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
  const total = data?.rows.length ?? 0;
  const pagedRows = (data?.rows ?? []).slice((page - 1) * pageSize, page * pageSize);

  type Row = NonNullable<typeof data>["rows"][number];
  const exportColumns: ExportColumn<Row>[] = [
    { header: "Customer", accessor: (r) => r.customerName },
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
        title="Receivables Aging"
        description="Outstanding customer balances bucketed by age."
        backHref="/reports"
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Receivables Aging" }]}
        actions={
          <ReportExportButton
            filename="receivables-aging"
            title="Receivables Aging"
            columns={exportColumns}
            rows={data?.rows ?? []}
            disabled={isLoading}
            meta={
              data
                ? [{ label: "Grand Total Outstanding", value: formatCurrency(data.totals.total) }]
                : []
            }
          />
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No outstanding balances. Everything is current.
            </p>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
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
                    key={r.customerId}
                    data-testid={`row-aging-${r.customerId}`}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/payments?customerId=${r.customerId}`}
                        className="text-primary hover:underline"
                      >
                        {r.customerName}
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
                    {formatCurrency(data.totals.current)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(data.totals.b30)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(data.totals.b60)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(data.totals.b90)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(data.totals.b90plus)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(data.totals.total)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            <TablePagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} itemLabel="customers" pageSizeOptions={PAGE_SIZE_OPTIONS} onPageSizeChange={setPageSize} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
