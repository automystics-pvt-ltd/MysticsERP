import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Can } from "@/components/Can";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  useListCustomers,
  getListCustomerPaymentsQueryKey,
  fetchCustomerPaymentsPaginated,
  type CustomerPaymentsPage,
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
import { Plus } from "lucide-react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { RecordPaymentDialog } from "@/components/RecordPaymentDialog";
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

const MODE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "razorpay", label: "Razorpay" },
  { value: "other", label: "Other" },
];

export default function Payments() {
  const { values, set, reset, debouncedSearch } = useListFilters({
    search: "",
    customerId: "all",
    mode: "all",
    from: "",
    to: "",
  });

  const [recordOpen, setRecordOpen] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [debouncedSearch, values.customerId, values.mode, values.from, values.to]);

  const { data: customers } = useListCustomers({});
  const queryClient = useQueryClient();

  const customerIdNum = values.customerId !== "all" ? Number(values.customerId) : undefined;

  const queryParams = {
    page,
    pageSize,
    customerId: customerIdNum,
    mode: values.mode !== "all" ? values.mode : undefined,
    from: values.from || undefined,
    to: values.to || undefined,
    search: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery<CustomerPaymentsPage>({
    queryKey: [...getListCustomerPaymentsQueryKey({}), queryParams],
    queryFn: () => fetchCustomerPaymentsPaginated(queryParams),
    placeholderData: (prev) => prev,
  });

  const payments = data?.payments ?? [];
  const total = data?.total ?? 0;
  const selectedCustomer = customers?.find((c) => c.id === customerIdNum);
  const customerOptions = customers?.map((c) => ({ value: String(c.id), label: c.name })) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Payments"
        description="Record and review money received from customers."
        actions={
          <Can module="payments" action="create">
            <Button
              onClick={() => setRecordOpen(true)}
              disabled={!customerIdNum}
              data-testid="btn-record-payment"
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
        searchPlaceholder="Search customer or reference…"
        filterDefs={[
          {
            key: "customerId",
            label: "Customer",
            type: "select",
            options: customerOptions,
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
        data-testid="filter-bar-payments"
      />

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Mode</TableHead>
              <TableHead className="text-xs">Reference</TableHead>
              <TableHead className="text-xs text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={8} cols={5} />
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No payments match your filters.
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow
                  key={p.id}
                  data-testid={`row-payment-${p.id}`}
                  className="cursor-pointer hover:bg-muted/30"
                >
                  <TableCell>
                    <Link href={`/payments/${p.id}`} className="block text-sm">
                      {formatDate(p.paymentDate)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/payments/${p.id}`} className="block text-sm font-medium">
                      {p.customerName}
                    </Link>
                  </TableCell>
                  <TableCell className="capitalize">
                    <Link href={`/payments/${p.id}`} className="block text-sm">
                      {p.mode}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/payments/${p.id}`} className="block text-sm font-mono text-muted-foreground">
                      {p.referenceNumber || "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Link href={`/payments/${p.id}`} className="block">
                      {formatCurrency(p.amount)}
                    </Link>
                  </TableCell>
                </TableRow>
              ))
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

      {customerIdNum && (
        <RecordPaymentDialog
          open={recordOpen}
          onOpenChange={(open) => {
            setRecordOpen(open);
            if (!open) {
              queryClient.invalidateQueries({ queryKey: getListCustomerPaymentsQueryKey({}) });
            }
          }}
          customerId={customerIdNum}
          customerName={selectedCustomer?.name}
          customerPhone={selectedCustomer?.phone ?? undefined}
        />
      )}
    </div>
  );
}
