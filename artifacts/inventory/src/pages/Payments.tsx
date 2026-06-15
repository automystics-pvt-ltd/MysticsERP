import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { Plus, Search, X } from "lucide-react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { RecordPaymentDialog } from "@/components/RecordPaymentDialog";
import { useMemo } from "react";
import { useDebounce } from "@/hooks/use-debounce";

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

function useQueryString() {
  const [location] = useLocation();
  return useMemo(() => {
    const idx = location.indexOf("?");
    return new URLSearchParams(idx >= 0 ? location.slice(idx + 1) : "");
  }, [location]);
}

export default function Payments() {
  const qs = useQueryString();
  const initialCustomerId = qs.get("customerId");

  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState<string>(
    initialCustomerId ?? "all",
  );
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    if (initialCustomerId) setCustomerFilter(initialCustomerId);
  }, [initialCustomerId]);

  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return; }
    setPage(1);
  }, [debouncedSearch, customerFilter, modeFilter, from, to]);

  const { data: customers } = useListCustomers({});

  const customerIdNum =
    customerFilter !== "all" ? Number(customerFilter) : undefined;

  const queryParams = {
    page,
    pageSize,
    customerId: customerIdNum,
    mode: modeFilter !== "all" ? modeFilter : undefined,
    from: from || undefined,
    to: to || undefined,
    search: debouncedSearch || undefined,
  };

  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<CustomerPaymentsPage>({
    queryKey: [...getListCustomerPaymentsQueryKey({}), queryParams],
    queryFn: () => fetchCustomerPaymentsPaginated(queryParams),
    placeholderData: (prev) => prev,
  });

  const payments = data?.payments ?? [];
  const total = data?.total ?? 0;

  const selectedCustomer = customers?.find((c) => c.id === customerIdNum);

  const hasActiveFilters = !!(debouncedSearch || customerFilter !== "all" || modeFilter !== "all" || from || to);

  function clearFilters() {
    setSearch("");
    setCustomerFilter("all");
    setModeFilter("all");
    setFrom("");
    setTo("");
    setPage(1);
  }

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

      <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label className="text-xs font-medium">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder="Customer or reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-payments"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Customer */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Customer</Label>
            <Select value={customerFilter} onValueChange={(v) => { setCustomerFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-payments-customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                {customers?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mode */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Mode</Label>
            <Select value={modeFilter} onValueChange={(v) => { setModeFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-payments-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modes</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank">Bank</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date from */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">From</Label>
            <Input
              type="date"
              className="h-9 text-sm"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              data-testid="input-payments-from"
            />
          </div>

          {/* Date to */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">To</Label>
            <Input
              type="date"
              className="h-9 text-sm"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(1); }}
              data-testid="input-payments-to"
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Filters active</span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={clearFilters}>
              <X className="h-3 w-3" />
              Clear all
            </Button>
          </div>
        )}
      </div>

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
                <TableCell
                  colSpan={5}
                  className="h-32 text-center text-muted-foreground"
                >
                  {hasActiveFilters ? "No payments match your filters." : "No payments yet."}
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
