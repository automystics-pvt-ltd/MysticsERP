import { useParams, Link, useLocation } from "wouter";
import {
  useGetSupplierPayment,
  useDeleteSupplierPayment,
  getGetSupplierPaymentQueryKey,
  getListSupplierPaymentsQueryKey,
  getListSuppliersQueryKey,
  getListPurchaseOrdersQueryKey,
  getGetPayablesAgingReportQueryKey,
  getGetPurchaseOrderQueryKey,
  fetchPurchaseOrdersPaginated,
  applySupplierPaymentAllocation,
  type PurchaseOrder,
} from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/lib/format";
import { ArrowLeft, Trash2, FileDown, PlusCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { downloadSupplierPaymentVoucher } from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function SupplierPaymentDetail() {
  const { id } = useParams();
  const paymentId = parseInt(id || "0", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetSupplierPayment(paymentId, {
    query: {
      enabled: !!paymentId,
      queryKey: getGetSupplierPaymentQueryKey(paymentId),
    },
  });

  const [downloading, setDownloading] = useState(false);

  // ── Apply to PO state ────────────────────────────────────────────────────
  const [selectedPoId, setSelectedPoId] = useState<string>("");
  const [applyAmount, setApplyAmount] = useState<string>("");

  const { payment, allocations } = data ?? {};
  const allocatedTotal = (allocations ?? []).reduce(
    (s, a) => s + Number(a.amount),
    0,
  );
  const unallocated = Number(payment?.amount ?? 0) - allocatedTotal;

  // Fetch open POs for this supplier (only when there's unapplied balance)
  const { data: openPosData } = useQuery({
    queryKey: ["open-pos-for-supplier", payment?.supplierId],
    queryFn: () =>
      fetchPurchaseOrdersPaginated({
        supplierId: payment!.supplierId,
        pageSize: 200,
      }),
    enabled: !!payment?.supplierId && unallocated > 0.005,
    select: (d) =>
      d.orders.filter(
        (o: PurchaseOrder) =>
          ["ordered", "partially_received", "received", "billed"].includes(
            o.status,
          ) && o.balanceDue > 0.005,
      ),
  });
  const openPos = openPosData ?? [];

  // When the user picks a PO, default the amount to min(unallocated, PO balance)
  useEffect(() => {
    if (!selectedPoId) {
      setApplyAmount("");
      return;
    }
    const po = openPos.find((p: PurchaseOrder) => String(p.id) === selectedPoId);
    if (po) {
      const defaultAmt = Math.min(unallocated, po.balanceDue);
      setApplyAmount(defaultAmt.toFixed(2));
    }
  }, [selectedPoId, openPos, unallocated]);

  const applyMutation = useMutation({
    mutationFn: () =>
      applySupplierPaymentAllocation(paymentId, {
        purchaseOrderId: Number(selectedPoId),
        amount: Number(applyAmount),
      }),
    onSuccess: (detail) => {
      toast({ title: "Allocation applied" });
      // Update the payment detail cache directly so the page refreshes instantly
      queryClient.setQueryData(getGetSupplierPaymentQueryKey(paymentId), detail);
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: getListSupplierPaymentsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetPurchaseOrderQueryKey(Number(selectedPoId)),
      });
      queryClient.invalidateQueries({
        queryKey: getListPurchaseOrdersQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetPayablesAgingReportQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: ["open-pos-for-supplier", payment?.supplierId],
      });
      setSelectedPoId("");
      setApplyAmount("");
    },
    onError: (err: unknown) => {
      const e = err as { message?: string };
      toast({
        title: "Could not apply allocation",
        description: e.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleApply = () => {
    const amt = Number(applyAmount);
    if (!selectedPoId) {
      toast({ title: "Select a purchase order", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (amt - unallocated > 0.005) {
      toast({
        title: "Amount exceeds unapplied balance",
        variant: "destructive",
      });
      return;
    }
    applyMutation.mutate();
  };

  const handleDownloadVoucher = async () => {
    setDownloading(true);
    try {
      const blob = (await downloadSupplierPaymentVoucher(
        paymentId,
      )) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `voucher-PV-${String(paymentId).padStart(6, "0")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast({
        title: "Could not download voucher",
        description:
          e.response?.data?.error ?? "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const deleteMutation = useDeleteSupplierPayment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Payment deleted" });
        queryClient.invalidateQueries({
          queryKey: getListSupplierPaymentsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getListSuppliersQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getListPurchaseOrdersQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetPayablesAgingReportQueryKey(),
        });
        for (const a of data?.allocations ?? []) {
          queryClient.invalidateQueries({
            queryKey: getGetPurchaseOrderQueryKey(a.purchaseOrderId),
          });
        }
        navigate("/supplier-payments");
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not delete payment",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title={`Payment #${payment!.id}`}
        description={`To ${payment!.supplierName}`}
        backHref="/supplier-payments"
        breadcrumbs={[{ label: "Supplier Payments", href: "/supplier-payments" }, { label: `#${payment!.id}` }]}
        actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleDownloadVoucher}
                disabled={downloading}
                data-testid="btn-download-voucher"
              >
                <FileDown className="mr-2 h-4 w-4" />
                {downloading ? "Preparing..." : "Download voucher"}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" data-testid="btn-delete-payment">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Allocations will be reversed and the supplier's
                      outstanding payable will be restored.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate({ id: paymentId })}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="btn-confirm-delete-payment"
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          }
        />

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Payment details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span>{formatDate(payment!.paymentDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mode</span>
              <span className="capitalize">{payment!.mode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reference</span>
              <span>{payment!.referenceNumber || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bank / wallet</span>
              <span>{payment!.bankAccountLabel || "-"}</span>
            </div>
            {payment!.notes && (
              <div className="pt-2 border-t">
                <p className="text-muted-foreground mb-1">Notes</p>
                <p>{payment!.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Amount</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between text-lg font-semibold">
              <span>Paid</span>
              <span>{formatCurrency(payment!.amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Allocated</span>
              <span>{formatCurrency(allocatedTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Advance / unapplied</span>
              <span
                className={unallocated > 0.005 ? "text-orange-600" : ""}
              >
                {formatCurrency(unallocated)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Applied to bills</CardTitle>
        </CardHeader>
        <CardContent>
          {(allocations ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Recorded as a supplier advance — not applied to any bill.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead className="text-right">Order total</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(allocations ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/purchase-orders/${a.purchaseOrderId}`}
                        className="text-primary hover:underline"
                      >
                        {a.purchaseOrderNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(a.purchaseOrderTotal)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(a.purchaseOrderBalanceDue)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(a.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {unallocated > 0.005 && (
        <Card data-testid="card-apply-to-po">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" />
              Apply to purchase order
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {formatCurrency(unallocated)} is available to apply against open
              purchase orders from this supplier.
            </p>
            {openPos.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No open purchase orders with a balance due for this supplier.
              </p>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="po-select">Purchase order</Label>
                  <Select
                    value={selectedPoId}
                    onValueChange={setSelectedPoId}
                  >
                    <SelectTrigger id="po-select" data-testid="select-apply-po">
                      <SelectValue placeholder="Select a purchase order…" />
                    </SelectTrigger>
                    <SelectContent>
                      {openPos.map((po: PurchaseOrder) => (
                        <SelectItem key={po.id} value={String(po.id)}>
                          {po.orderNumber} — balance {formatCurrency(po.balanceDue)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-36 space-y-1">
                  <Label htmlFor="apply-amount">Amount (₹)</Label>
                  <Input
                    id="apply-amount"
                    data-testid="input-apply-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={applyAmount}
                    onChange={(e) => setApplyAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <Button
                  data-testid="btn-apply-allocation"
                  onClick={handleApply}
                  disabled={applyMutation.isPending || !selectedPoId || !applyAmount}
                >
                  {applyMutation.isPending ? "Applying…" : "Apply"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
