import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Can } from "@/components/Can";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  fetchSupplierPaymentsPaginated,
  useListSuppliers,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

function useQueryString() {
  const [location] = useLocation();
  return useMemo(() => {
    const idx = location.indexOf("?");
    return new URLSearchParams(idx >= 0 ? location.slice(idx + 1) : "");
  }, [location]);
}

export default function SupplierPayments() {
  const qs = useQueryString();
  const initialSupplierId = qs.get("supplierId");

  const [supplierFilter, setSupplierFilter] = useState<string>(
    initialSupplierId ?? "all",
  );
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [supplierFilter, modeFilter, from, to]);

  useEffect(() => {
    if (initialSupplierId) setSupplierFilter(initialSupplierId);
  }, [initialSupplierId]);

  const { data: suppliers } = useListSuppliers({});

  const { data, isLoading } = useQuery({
    queryKey: [
      "supplier-payments-paginated",
      { page, pageSize, supplierFilter, modeFilter, from, to },
    ],
    queryFn: () =>
      fetchSupplierPaymentsPaginated({
        page,
        pageSize,
        supplierId: supplierFilter !== "all" ? Number(supplierFilter) : undefined,
        mode: modeFilter !== "all" ? modeFilter : undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const payments = data?.payments ?? [];
  const total = data?.total ?? 0;

  const supplierIdNum =
    supplierFilter !== "all" ? Number(supplierFilter) : null;
  const selectedSupplier = suppliers?.suppliers.find((s) => s.id === supplierIdNum);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Payments"
        description="Record and review money paid to suppliers."
        actions={
          <Can module="supplier_payments" action="create">
            <Button
              onClick={() => setRecordOpen(true)}
              disabled={!supplierIdNum}
              data-testid="btn-record-supplier-payment"
            >
              <Plus className="mr-2 h-4 w-4" />
              Record payment
            </Button>
          </Can>
        }
      />

      <div className="bg-card border rounded-lg p-4 grid gap-4 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Supplier</Label>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger data-testid="select-payments-supplier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All suppliers</SelectItem>
              {suppliers?.suppliers.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger data-testid="select-payments-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="bank">Bank</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
              <SelectItem value="razorpay">Razorpay</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>From</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            data-testid="input-payments-from"
          />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            data-testid="input-payments-to"
          />
        </div>
      </div>

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
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  No payments yet.
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
                      {p.referenceNumber || "-"}
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

      {supplierIdNum && (
        <RecordSupplierPaymentDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          supplierId={supplierIdNum}
          supplierName={selectedSupplier?.name}
        />
      )}
    </div>
  );
}
