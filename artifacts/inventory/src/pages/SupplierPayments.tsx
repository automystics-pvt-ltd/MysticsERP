import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Can } from "@/components/Can";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  fetchSupplierPaymentsPaginated,
  useListSuppliers,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { Plus, Wallet } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { RecordSupplierPaymentDialog } from "@/components/RecordSupplierPaymentDialog";
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

const MODE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "razorpay", label: "Razorpay" },
  { value: "other", label: "Other" },
];

export default function SupplierPayments() {
  const { values, set, reset, debouncedSearch } = useListFilters({
    search: "",
    supplierId: "all",
    mode: "all",
    from: "",
    to: "",
  });

  const [recordOpen, setRecordOpen] = useState(false);
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [debouncedSearch, values.supplierId, values.mode, values.from, values.to]);

  const { data: suppliersData } = useListSuppliers({});
  const suppliers = suppliersData?.suppliers ?? [];

  const supplierIdNum = values.supplierId !== "all" ? Number(values.supplierId) : null;
  const selectedSupplier = suppliers.find((s) => s.id === supplierIdNum);
  const supplierOptions = suppliers.map((s) => ({ value: String(s.id), label: s.name }));

  const queryParams = {
    page,
    pageSize,
    supplierId: supplierIdNum ?? undefined,
    mode: values.mode !== "all" ? values.mode : undefined,
    from: values.from || undefined,
    to: values.to || undefined,
    search: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-payments-paginated", queryParams],
    queryFn: () => fetchSupplierPaymentsPaginated(queryParams),
    placeholderData: (prev) => prev,
  });

  const payments = data?.payments ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Payments"
        description="Record and review money paid to suppliers."
        actions={
          <Can module="supplier_payments" action="create">
            <Button
              onClick={() => setRecordOpen(true)}
              data-testid="btn-record-supplier-payment"
            >
              <Plus className="mr-2 h-4 w-4" />
              Record payment
            </Button>
          </Can>
        }
      />

      <FilterBar
        search={values.search}
        onSearchChange={(v) => set("search", v)}
        searchPlaceholder="Search supplier or reference…"
        filterDefs={[
          {
            key: "supplierId",
            label: "Supplier",
            type: "select",
            options: supplierOptions,
          },
          {
            key: "mode",
            label: "Mode",
            type: "select",
            options: MODE_OPTIONS,
          },
          {
            key: "paymentDate",
            label: "Payment Date",
            type: "daterange",
            fromKey: "from",
            toKey: "to",
          },
        ]}
        filterValues={values}
        onFilterChange={set}
        onReset={reset}
        data-testid="filter-bar-supplier-payments"
      />

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center justify-end gap-1 cursor-default">
                      Balance
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Amount applied to purchase orders</TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center justify-end gap-1 cursor-default">
                      <Wallet className="h-3.5 w-3.5" /> Advance
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Unapplied advance balance — amount not yet allocated to any purchase order</TooltipContent>
                </Tooltip>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} cols={7} />
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No payments match your filters.
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => {
                const applied = Math.max(0, p.amount - p.unapplied);
                return (
                  <TableRow
                    key={p.id}
                    data-testid={`row-supplier-payment-${p.id}`}
                    className="cursor-pointer hover:bg-muted/40"
                  >
                    <TableCell>
                      <Link href={`/supplier-payments/${p.id}`} className="block">
                        {formatDate(p.paymentDate)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/supplier-payments/${p.id}`} className="block">
                        {p.supplierName}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">
                      <Link href={`/supplier-payments/${p.id}`} className="block">
                        {p.mode}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/supplier-payments/${p.id}`} className="block">
                        {p.referenceNumber || "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Link href={`/supplier-payments/${p.id}`} className="block">
                        {formatCurrency(p.amount)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/supplier-payments/${p.id}`} className="block">
                        {applied > 0 ? (
                          <span className="font-medium">{formatCurrency(applied)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/supplier-payments/${p.id}`} className="block">
                        {p.unapplied > 0 ? (
                          <span className="text-amber-600 font-medium">{formatCurrency(p.unapplied)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        itemLabel="payments"
      />

      <RecordSupplierPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        supplierId={supplierIdNum ?? undefined}
        supplierName={selectedSupplier?.name}
      />
    </div>
  );
}
