import { useParams, Link, useLocation } from "wouter";
import { useImageSrc } from "@/hooks/use-image-src";
import { PageHeader } from "@/components/PageHeader";
import {
  useGetSalesOrder,
  useUpdateSalesOrderStatus,
  useReturnSalesOrder,
  useCancelShipment,
  useListStockMovements,
  useListSalesOrderEmailLog,
  downloadSalesOrderInvoice,
  downloadSalesOrderAck,
  getGetSalesOrderQueryKey,
  getListSalesOrdersQueryKey,
  getListStockMovementsQueryKey,
  getListSalesOrderShipmentsQueryKey,
  getListSalesOrderEmailLogQueryKey,
  getListItemsQueryKey,
  useGetCurrentOrganization,
  useGetMe,
  useRecordPrint,
} from "@/lib/queryKeys";
import {
  useDeleteSalesOrder,
  getListCustomerPaymentsQueryKey,
  useListCustomerPayments,
  useDeleteCustomerPayment,
  useResendShippingConfirmation,
  useUpdateShipment,
  useUpdateSalesOrderPaymentMeta,
  useListSalesOrderRefunds,
  useCreateSalesOrderRefund,
  getListSalesOrderRefundsQueryKey,
  useListWarehouses,
  getListWarehousesQueryKey,
} from "@workspace/api-client-react";
import { normalizeRole } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Truck,
  Package,
  XCircle,
  Undo2,
  IndianRupee,
  FileDown,
  Mail,
  Pencil,
  Printer,
  Receipt,
  Trash2,
  ExternalLink,
  CreditCard,
  ClipboardList,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Fragment, useState } from "react";
import { RecordPaymentDialog } from "@/components/RecordPaymentDialog";
import { EwbPanel } from "@/components/EwbPanel";
import { EinvoicePanel } from "@/components/EinvoicePanel";
import { NewShipmentDialog } from "@/components/NewShipmentDialog";
import { BookShiprocketDialog } from "@/components/BookShiprocketDialog";
import { Badge } from "@/components/ui/badge";
import { SendInvoiceDialog } from "@/components/SendInvoiceDialog";
import { PaymentLinkCard } from "@/components/PaymentLinkCard";
import { Can } from "@/components/Can";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge } from "@/components/StatusBadge";
import { Separator } from "@/components/ui/separator";
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useMemo } from "react";
import { useRecordVisit } from "@/lib/recentRecords";

const PAYABLE_SALES_STATUSES = ["confirmed", "shipped", "delivered", "invoiced"];

const RETURNABLE_SALES_STATUSES = ["shipped", "delivered", "invoiced", "paid"];

const INVOICEABLE_STATUSES = new Set([
  "shipped",
  "partially_shipped",
  "delivered",
  "invoiced",
  "paid",
  "returned",
]);

export default function SalesOrderDetail() {
  const { id } = useParams();
  const orderId = parseInt(id || "0", 10);
  
  const { data: orderDetail, isLoading } = useGetSalesOrder(orderId, {
    query: { enabled: !!orderId, queryKey: getGetSalesOrderQueryKey(orderId) }
  });

  useRecordVisit(
    useMemo(
      () =>
        orderDetail?.order
          ? {
              kind: "sales_order" as const,
              id: orderDetail.order.id,
              title: orderDetail.order.orderNumber,
              subtitle: orderDetail.order.customerName,
              href: `/sales-orders/${orderDetail.order.id}`,
            }
          : null,
      [orderDetail?.order],
    ),
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const movementsQuery = useListStockMovements(
    { salesOrderId: orderId },
    {
      query: {
        enabled: !!orderId,
        queryKey: getListStockMovementsQueryKey({
          salesOrderId: orderId,
        }),
      },
    },
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetSalesOrderQueryKey(orderId) });
    queryClient.invalidateQueries({ queryKey: getListSalesOrdersQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListStockMovementsQueryKey({ salesOrderId: orderId }),
    });
    queryClient.invalidateQueries({ queryKey: getListStockMovementsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListSalesOrderShipmentsQueryKey(orderId),
    });
    queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
    queryClient.invalidateQueries({
      queryKey: getListCustomerPaymentsQueryKey({ salesOrderId: orderId }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
  };

  const updateStatusMutation = useUpdateSalesOrderStatus({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Status updated successfully" });
      },
    },
  });

  const returnMutation = useReturnSalesOrder({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Return processed", description: "Stock has been added back to the warehouse." });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not process return",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const cancelShipmentMutation = useCancelShipment({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Shipment cancelled", description: "Stock has been added back to the warehouse." });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not cancel shipment",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const deleteMutation = useDeleteSalesOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSalesOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
        toast({ title: "Bill deleted" });
        setLocation("/sales-orders");
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not delete",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const resendShippingMutation = useResendShippingConfirmation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSalesOrderEmailLogQueryKey(orderId) });
        toast({ title: "Shipping confirmation sent", description: "The customer has been emailed." });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not send email",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const deletePaymentMutation = useDeleteCustomerPayment({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Payment deleted" });
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

  const handleUpdateStatus = (status: string) => {
    updateStatusMutation.mutate({
      id: orderId,
      data: { status },
    });
  };

  const [returnReason, setReturnReason] = useState("");
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleReturn = () => {
    returnMutation.mutate({ id: orderId, data: { notes: returnReason.trim() || null } });
  };

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [bookShipmentId, setBookShipmentId] = useState<number | null>(null);
  const [sendInvoiceOpen, setSendInvoiceOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingOrder, setDownloadingOrder] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [thermalPrinting, setThermalPrinting] = useState(false);

  // Edit tracking dialog state
  const [editTrackingId, setEditTrackingId] = useState<number | null>(null);
  const [trackingForm, setTrackingForm] = useState({ awb: "", courierName: "", trackingUrl: "" });

  // Edit payment terms dialog state
  const [editPaymentDetailsOpen, setEditPaymentDetailsOpen] = useState(false);
  const [paymentDetailsForm, setPaymentDetailsForm] = useState({
    paymentStatus: "" as string,
    paymentMethod: "",
    paymentReference: "",
    paymentTerms: "",
  });

  // Refund dialog state
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundMode, setRefundMode] = useState<"full" | "partial" | "item_wise">("full");
  const [refundForm, setRefundForm] = useState({
    refundDate: new Date().toISOString().slice(0, 10),
    refundAmount: "",
    reason: "",
    notes: "",
    restockItems: false,
    warehouseId: "",
    lines: [] as Array<{
      salesOrderLineId: number;
      itemId: number;
      itemName: string;
      sku: string;
      maxQty: number;
      unitPrice: number;
      quantity: string;
      refundAmount: string;
      include: boolean;
      restock: boolean;
      lineWarehouseId: string;
    }>,
  });

  const updateShipmentMutation = useUpdateShipment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalesOrderQueryKey(orderId) });
        queryClient.invalidateQueries({ queryKey: getListSalesOrderShipmentsQueryKey(orderId) });
        queryClient.invalidateQueries({ queryKey: getListSalesOrdersQueryKey() });
        setEditTrackingId(null);
        toast({ title: "Tracking info updated" });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not update tracking",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updatePaymentMetaMutation = useUpdateSalesOrderPaymentMeta({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalesOrderQueryKey(orderId) });
        queryClient.invalidateQueries({ queryKey: getListSalesOrdersQueryKey() });
        setEditPaymentDetailsOpen(false);
        toast({ title: "Payment details updated" });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not update payment details",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });
  const createRefundMutation = useCreateSalesOrderRefund({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSalesOrderRefundsQueryKey(orderId) });
        queryClient.invalidateQueries({ queryKey: getGetSalesOrderQueryKey(orderId) });
        queryClient.invalidateQueries({ queryKey: getListSalesOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListStockMovementsQueryKey({ salesOrderId: orderId }) });
        setRefundDialogOpen(false);
        toast({ title: "Refund recorded" });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          title: "Could not create refund",
          description: e.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const refundsQuery = useListSalesOrderRefunds(orderId, {
    query: { enabled: !!orderId, queryKey: getListSalesOrderRefundsQueryKey(orderId) },
  });

  const warehousesQuery = useListWarehouses(undefined, {
    // Fetch whenever the dialog is open and either:
    // (a) global restock is toggled on (full/partial mode), or
    // (b) item-wise mode is active — per-line restock checkboxes need options immediately
    query: {
      enabled: refundDialogOpen && (refundForm.restockItems || refundMode === "item_wise"),
      queryKey: getListWarehousesQueryKey(),
    },
  });

  // Per-shipment cancel-reason form state. Keyed by shipment id so two
  // cancel dialogs on the same page can't trample each other.
  const [cancelReason, setCancelReason] = useState<
    Record<number, { code: string; notes: string }>
  >({});
  const getReason = (id: number) =>
    cancelReason[id] ?? { code: "", notes: "" };
  const setReason = (
    id: number,
    patch: Partial<{ code: string; notes: string }>,
  ) =>
    setCancelReason((prev) => ({
      ...prev,
      [id]: { ...getReason(id), ...patch },
    }));

  // Open the order PDF inline in a new tab so the user can use the
  // browser's built-in print dialog. We can't `window.open` the API
  // URL directly because it requires the bearer token, so we fetch
  // the blob first and then open the resulting object URL.
  const handlePrintOrder = async () => {
    if (!orderDetail) return;
    setPrinting(true);
    try {
      const blob = (await downloadSalesOrderAck(orderId)) as unknown as Blob;
      const pdfBlob = blob.type === "application/pdf"
        ? blob
        : new Blob([blob], { type: "application/pdf" });
      const url = URL.createObjectURL(pdfBlob);
      const win = window.open(url, "_blank");
      if (!win) {
        // Popup blocked — fall back to a download so the user still
        // gets the file and can print from their PDF viewer.
        const a = document.createElement("a");
        a.href = url;
        a.download = `order-${orderDetail.order.orderNumber}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast({
          title: "Popup blocked",
          description:
            "We saved the PDF instead — open it and press Ctrl+P to print.",
        });
      }
      // Revoke after a short delay so the new tab has time to load.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("printSalesOrderAck failed", err);
      const e = err as {
        data?: { error?: string };
        response?: { data?: { error?: string } };
        message?: string;
      };
      toast({
        title: "Could not open order for printing",
        description:
          e.data?.error ??
          e.response?.data?.error ??
          e.message ??
          "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  const handleDownloadOrder = async () => {
    if (!orderDetail) return;
    setDownloadingOrder(true);
    try {
      const blob = (await downloadSalesOrderAck(orderId)) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `order-${orderDetail.order.orderNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      // ApiError exposes the parsed body on `.data` (not `.response.data`),
      // so we read from both shapes to surface a useful message.
      // eslint-disable-next-line no-console
      console.error("downloadSalesOrderAck failed", err);
      const e = err as {
        data?: { error?: string };
        response?: { data?: { error?: string } };
        message?: string;
      };
      toast({
        title: "Could not download order",
        description:
          e.data?.error ??
          e.response?.data?.error ??
          e.message ??
          "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setDownloadingOrder(false);
    }
  };

  const canInvoice = orderDetail
    ? INVOICEABLE_STATUSES.has(orderDetail.order.status)
    : false;

  const emailLogQuery = useListSalesOrderEmailLog(orderId, {
    query: {
      enabled: !!orderId && canInvoice,
      queryKey: getListSalesOrderEmailLogQueryKey(orderId),
    },
  });

  const { data: org } = useGetCurrentOrganization();
  const { data: me } = useGetMe();

  const recordPrintMutation = useRecordPrint();

  const checkAndRecordPrint = async (documentType: string, documentId: number): Promise<boolean> => {
    try {
      const result = await recordPrintMutation.mutateAsync({ data: { documentType, documentId } });
      if (!result.allowed) {
        toast({
          title: "Print limit reached",
          description: "You've reached the 2-print limit for this document. Contact your admin for additional copies.",
          variant: "destructive",
        });
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const myRole = normalizeRole(me?.role);
  // owner / admin always have edit+delete access.
  // For every other role (manager, salesman, accountant, viewer) the
  // per-member "canEditBills" toggle is the sole gate — if it is off
  // those users must not see or be able to use Edit / Delete Bill.
  const canEditBillsForUser =
    (me?.user?.isSuperAdmin ?? false) ||
    (["owner", "admin"] as const).some((r) => r === myRole) ||
    (me?.canEditBills ?? false);

  const handleDownloadInvoice = async () => {
    if (!orderDetail) return;
    const allowed = await checkAndRecordPrint("sales_order_invoice", orderId);
    if (!allowed) return;
    setDownloading(true);
    try {
      const blob = (await downloadSalesOrderInvoice(orderId)) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${orderDetail.order.orderNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("downloadSalesOrderInvoice failed", err);
      const e = err as {
        data?: { error?: string };
        response?: { data?: { error?: string } };
        message?: string;
      };
      toast({
        title: "Could not download invoice",
        description:
          e.data?.error ??
          e.response?.data?.error ??
          e.message ??
          "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleThermalPrint = async () => {
    if (!orderDetail) return;
    setThermalPrinting(true);
    try {
      const allowed = await checkAndRecordPrint("sales_order_thermal", orderId);
      if (!allowed) return;
      window.print();
    } finally {
      setThermalPrinting(false);
    }
  };

  if (isLoading || !orderDetail) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { order, lines, shipments } = orderDetail;
  const canShip = order.status === "confirmed" || order.status === "partially_shipped";
  const canCancelShipments = order.status === "shipped" || order.status === "partially_shipped";
  const allFullyShipped = lines.every(
    (l) => Number(l.quantity) - Number(l.quantityShipped) <= 1e-6,
  );

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader
        title={`Order ${order.orderNumber}`}
        backHref="/sales-orders"
        breadcrumbs={[{ label: "Orders", href: "/sales-orders" }, { label: order.orderNumber }]}
        badge={
          <div className="flex items-center gap-1.5">
            <StatusBadge status={order.status} />
            <Badge
              variant="outline"
              className={
                order.paymentStatus === "paid"
                  ? "text-[10px] font-medium bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40"
                  : order.paymentStatus === "partially_paid"
                    ? "text-[10px] font-medium bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40"
                    : order.paymentStatus === "refunded"
                      ? "text-[10px] font-medium bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/40"
                      : "text-[10px] font-medium bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/40"
              }
              data-testid="badge-payment-status-header"
            >
              {order.paymentStatus === "paid"
                ? "Paid"
                : order.paymentStatus === "partially_paid"
                  ? "Partially Paid"
                  : order.paymentStatus === "refunded"
                    ? "Refunded"
                    : "Unpaid"}
            </Badge>
            {order.shopifyOrderId && (
              <Badge
                variant="outline"
                className="font-sans text-[10px] uppercase tracking-wide border-green-600 text-green-700 dark:border-green-500 dark:text-green-400"
                data-testid="badge-shopify-order"
              >
                Shopify
              </Badge>
            )}
            {order.shopifyFulfillmentStatus && (
              <Badge
                variant="outline"
                className={
                  order.shopifyFulfillmentStatus === "fulfilled"
                    ? "text-[10px] font-medium bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40"
                    : order.shopifyFulfillmentStatus === "partial"
                      ? "text-[10px] font-medium bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40"
                      : order.shopifyFulfillmentStatus === "in_progress"
                        ? "text-[10px] font-medium bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/40"
                        : order.shopifyFulfillmentStatus === "on_hold"
                          ? "text-[10px] font-medium bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800/40"
                          : order.shopifyFulfillmentStatus === "scheduled"
                            ? "text-[10px] font-medium bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800/40"
                            : "text-[10px] font-medium bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700"
                }
                data-testid="badge-shopify-fulfillment-status"
              >
                {order.shopifyFulfillmentStatus === "fulfilled"
                  ? "Fulfilled"
                  : order.shopifyFulfillmentStatus === "partial"
                    ? "Partially Fulfilled"
                    : order.shopifyFulfillmentStatus === "in_progress"
                      ? "In Progress"
                      : order.shopifyFulfillmentStatus === "on_hold"
                        ? "On Hold"
                        : order.shopifyFulfillmentStatus === "scheduled"
                          ? "Scheduled"
                          : "Unfulfilled"}
              </Badge>
            )}
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <Can module="sales_orders" action="approve">
              {order.status === "draft" && (
                <Button
                  size="sm"
                  onClick={() => handleUpdateStatus("confirmed")}
                  disabled={updateStatusMutation.isPending}
                  data-testid="btn-status-confirm"
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Confirm Order
                </Button>
              )}
            </Can>
            <Can module="sales_orders" action="approve">
              {canShip && !allFullyShipped && (
                <Button
                  size="sm"
                  onClick={() => setShipmentOpen(true)}
                  data-testid="btn-new-shipment"
                >
                  <Truck className="mr-1.5 h-4 w-4" /> New Shipment
                </Button>
              )}
            </Can>
            <Can module="sales_orders" action="approve">
              {order.status === "shipped" && (
                <Button
                  size="sm"
                  onClick={() => handleUpdateStatus("delivered")}
                  disabled={updateStatusMutation.isPending}
                  data-testid="btn-status-deliver"
                >
                  <Package className="mr-1.5 h-4 w-4" /> Mark Delivered
                </Button>
              )}
            </Can>
            <Can module="payments" action="create">
              {Number(order.balanceDue) > 0 && PAYABLE_SALES_STATUSES.includes(order.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPaymentOpen(true)}
                  data-testid="btn-record-payment"
                >
                  <IndianRupee className="mr-1.5 h-4 w-4" /> Record Payment
                </Button>
              )}
            </Can>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="btn-more-actions">
                  More Actions <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {["draft", "confirmed", "invoiced", "paid"].includes(order.status) && canEditBillsForUser && (
                  <DropdownMenuItem asChild data-testid="btn-edit-order">
                    <Link href={`/sales-orders/${order.id}/edit`}>
                      <Pencil className="mr-2 h-4 w-4" /> Edit Order
                    </Link>
                  </DropdownMenuItem>
                )}
                {["confirmed", "partially_shipped", "shipped", "delivered"].includes(order.status) && (
                  <DropdownMenuItem
                    data-testid="btn-print-packing-slip"
                    onClick={() => window.open(`/sales-orders/${order.id}/packing-slip`, "_blank")}
                  >
                    <ClipboardList className="mr-2 h-4 w-4" /> Print Packing Slip
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <Can module="sales_orders" action="print">
                  <DropdownMenuItem onClick={handlePrintOrder} disabled={printing} data-testid="btn-print-order">
                    <Printer className="mr-2 h-4 w-4" /> {printing ? "Opening…" : "Print"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleThermalPrint} disabled={thermalPrinting} data-testid="btn-thermal-print">
                    <Receipt className="mr-2 h-4 w-4" /> {thermalPrinting ? "Printing…" : "Thermal Receipt"}
                  </DropdownMenuItem>
                  {canInvoice && (
                    <>
                      <DropdownMenuItem onClick={handleDownloadInvoice} disabled={downloading} data-testid="btn-download-invoice">
                        <FileDown className="mr-2 h-4 w-4" /> {downloading ? "Preparing…" : "Download Invoice"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSendInvoiceOpen(true)} data-testid="btn-send-invoice">
                        <Mail className="mr-2 h-4 w-4" /> Send to Customer
                      </DropdownMenuItem>
                    </>
                  )}
                  {shipments.some((s) => s.status !== "cancelled") && order.status !== "returned" && (
                    <DropdownMenuItem
                      onClick={() => resendShippingMutation.mutate({ id: orderId })}
                      disabled={resendShippingMutation.isPending}
                      data-testid="btn-resend-shipping-confirmation"
                    >
                      <Truck className="mr-2 h-4 w-4" /> {resendShippingMutation.isPending ? "Sending…" : "Resend Shipping Confirmation"}
                    </DropdownMenuItem>
                  )}
                </Can>
                {(RETURNABLE_SALES_STATUSES.includes(order.status) ||
                  (["draft", "confirmed"].includes(order.status) && canEditBillsForUser)) && (
                  <DropdownMenuSeparator />
                )}
                {RETURNABLE_SALES_STATUSES.includes(order.status) && (
                  <DropdownMenuItem onClick={() => setReturnDialogOpen(true)} data-testid="btn-status-return">
                    <Undo2 className="mr-2 h-4 w-4" /> Return / Reverse
                  </DropdownMenuItem>
                )}
                {["draft", "confirmed"].includes(order.status) && canEditBillsForUser && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => handleUpdateStatus("cancelled")}
                    disabled={updateStatusMutation.isPending}
                    data-testid="btn-status-cancel"
                  >
                    <XCircle className="mr-2 h-4 w-4" /> Cancel Order
                  </DropdownMenuItem>
                )}
                {canEditBillsForUser && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                      data-testid="btn-delete-order"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Order
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{order.orderNumber}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate({ id: order.id })}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {RETURNABLE_SALES_STATUSES.includes(order.status) && (
        <AlertDialog
          open={returnDialogOpen}
          onOpenChange={(open) => {
            setReturnDialogOpen(open);
            if (!open) setReturnReason("");
          }}
        >
          <AlertDialogTrigger asChild>
            <span />
          </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Return this shipment?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will add the order quantities back to {order.warehouseName} and mark the order as returned. The original shipment record will be kept for audit.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 px-0 py-2">
                <p className="text-sm font-medium">Reason for return <span className="text-destructive">*</span></p>
                <Textarea
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="e.g. Customer refused delivery, item defective..."
                  className="h-24 resize-none"
                  data-testid="input-return-reason"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReturn}
                  disabled={!returnReason.trim()}
                  data-testid="btn-confirm-return"
                >
                  Confirm Return
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle>Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Order Date</p>
                <p>{formatDate(order.orderDate)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Expected Ship Date</p>
                <p>{formatDate(order.expectedShipDate) || "-"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Warehouse</p>
                <p>{order.warehouseName}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Customer</p>
                <Link href="/customers" className="text-primary hover:underline">{order.walkinName || order.customerName}</Link>
              </div>
            </div>
            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Payment Details</p>
                <Can module="sales_orders" action="approve">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-muted-foreground"
                    data-testid="btn-edit-payment-details"
                    onClick={() => {
                      const o = order as typeof order & { paymentMethod?: string | null; paymentReference?: string | null; paymentTerms?: string | null; paymentStatus?: string | null };
                      const stored = o.paymentStatus;
                      const uiStatus = stored === "paid" ? "paid" : stored === "partially_paid" ? "partially_paid" : stored ? stored : "unpaid";
                      setPaymentDetailsForm({
                        paymentStatus: uiStatus,
                        paymentMethod: o.paymentMethod ?? "",
                        paymentReference: o.paymentReference ?? "",
                        paymentTerms: o.paymentTerms ?? "",
                      });
                      setEditPaymentDetailsOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </Can>
              </div>
              <div className="grid grid-cols-2 gap-y-2 gap-x-8">
                <div>
                  <p className="text-xs text-muted-foreground">Method</p>
                  <p className="text-sm" data-testid="text-payment-method">
                    {(order as typeof order & { paymentMethod?: string | null }).paymentMethod || <span className="italic text-muted-foreground">—</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reference</p>
                  <p className="text-sm" data-testid="text-payment-reference">
                    {(order as typeof order & { paymentReference?: string | null }).paymentReference || <span className="italic text-muted-foreground">—</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Terms</p>
                  <p className="text-sm" data-testid="text-payment-terms">
                    {(order as typeof order & { paymentTerms?: string | null }).paymentTerms || <span className="italic text-muted-foreground">—</span>}
                  </p>
                </div>
              </div>
            </div>
            {order.notes && (
              <div className="pt-4 border-t">
                <p className="text-sm font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{order.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            {Number(order.discountTotal ?? 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground pl-3 italic">Includes {formatCurrency(order.discountTotal)} discount</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(order.taxTotal)}</span>
            </div>
            {order.shopifyTaxLines && order.shopifyTaxLines.length > 0 && (
              <div className="space-y-1 pl-3 border-l-2 border-muted">
                {order.shopifyTaxLines.map((tl, i) => (
                  <div key={i} className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {tl.title} {Math.round(tl.rate * 100)}%
                      {tl.channel_liable === false && (
                        <span className="ml-1 text-[10px] italic">(Included)</span>
                      )}
                    </span>
                    <span>{formatCurrency(Number(tl.price))}</span>
                  </div>
                ))}
              </div>
            )}
            {order.deliveryMethod && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Delivery</span>
                <span className="text-right">{order.deliveryMethod}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>{formatCurrency(order.total)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount paid</span>
              <span data-testid="text-amount-paid">
                {formatCurrency(order.amountPaid)}
              </span>
            </div>
            <div className="flex justify-between text-sm font-medium">
              <span>Balance due</span>
              <span
                className={
                  Number(order.balanceDue) > 0 ? "text-orange-600" : ""
                }
                data-testid="text-balance-due"
              >
                {formatCurrency(order.balanceDue)}
              </span>
            </div>
            {order.paymentStatus && (
              <>
                <Separator />
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Payment status</span>
                  <Badge
                    variant="outline"
                    className={
                      order.paymentStatus === "paid"
                        ? "font-medium bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40"
                        : order.paymentStatus === "partially_paid"
                          ? "font-medium bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/40"
                          : order.paymentStatus === "refunded"
                            ? "font-medium bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/40"
                            : order.paymentStatus === "void"
                              ? "font-medium bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700"
                              : "font-medium bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800/40"
                    }
                    data-testid="badge-payment-status"
                  >
                    {order.paymentStatus === "paid"
                      ? "Paid"
                      : order.paymentStatus === "partially_paid"
                        ? "Partially Paid"
                        : order.paymentStatus === "refunded"
                          ? "Refunded"
                          : order.paymentStatus === "void"
                            ? "Void"
                            : "Payment Pending"}
                  </Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {(() => {
        const MANUAL_MODES = new Set(["cash", "upi", "bank"]);

        type PaymentEntry = {
          kind: "payment";
          date: string;
          paymentId: number;
          mode: string;
          referenceNumber: string | null;
          amount: number;
        };
        type ReversalEntry = {
          kind: "reversal";
          date: string;
          shipmentNumber: string;
          warehouseName: string;
          items: Array<{ itemName: string; sku: string; quantity: number }>;
        };
        type RefundEntry = {
          kind: "refund";
          date: string;
          refundId: number;
          refundNumber: string;
          refundType: "full" | "partial" | "item_wise";
          amount: number;
          reason: string | null;
          restockItems: boolean;
        };
        type TimelineEntry = PaymentEntry | ReversalEntry | RefundEntry;

        const paymentEntries: PaymentEntry[] = orderDetail.paymentBreakdown.map((p) => ({
          kind: "payment" as const,
          date: p.paymentDate ?? p.paymentDate ?? "",
          paymentId: p.paymentId,
          mode: p.mode,
          referenceNumber: p.referenceNumber,
          amount: p.amount,
        }));

        const reversalEntries: ReversalEntry[] = shipments
          .filter((s) => s.status === "cancelled" && s.cancelledAt)
          .map((s) => ({
            kind: "reversal" as const,
            date: s.cancelledAt!,
            shipmentNumber: s.shipmentNumber,
            warehouseName: order.warehouseName,
            items: s.lines.map((l) => ({
              itemName: l.itemName,
              sku: l.sku,
              quantity: l.quantity,
            })),
          }));

        const refundEntries: RefundEntry[] = (refundsQuery.data ?? []).map((r) => ({
          kind: "refund" as const,
          date: r.createdAt,
          refundId: r.id,
          refundNumber: r.refundNumber,
          refundType: r.refundType,
          amount: r.refundAmount,
          reason: r.reason,
          restockItems: r.restockItems,
        }));

        const timelineEntries: TimelineEntry[] = [...paymentEntries, ...reversalEntries, ...refundEntries].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );

        if (timelineEntries.length === 0) return null;

        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> Payment & Fulfilment History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border" />
                <div className="space-y-4">
                  {timelineEntries.map((entry, idx) => {
                    if (entry.kind === "payment") {
                      const modeLabel =
                        entry.mode === "upi" ? "UPI" :
                        entry.mode === "cash" ? "Cash" :
                        entry.mode === "card" ? "Card" :
                        entry.mode === "bank" ? "Bank Transfer" :
                        entry.mode === "razorpay" ? "Razorpay" :
                        (entry.mode ?? "").charAt(0).toUpperCase() + (entry.mode ?? "").slice(1);
                      const isManual = MANUAL_MODES.has(entry.mode ?? "");
                      return (
                        <div key={`payment-${entry.paymentId}`} className="relative flex items-start gap-3 pl-7">
                          <div className="absolute left-0 top-1 h-[22px] w-[22px] rounded-full bg-primary/10 border-2 border-background ring-1 ring-primary/30 flex items-center justify-center">
                            <IndianRupee className="h-2.5 w-2.5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{modeLabel}</span>
                                {entry.referenceNumber && (
                                  <span className="text-xs text-muted-foreground">#{entry.referenceNumber}</span>
                                )}
                              </div>
                              <span className="font-semibold text-sm tabular-nums">{formatCurrency(entry.amount)}</span>
                            </div>
                            {entry.date && (
                              <p className="text-xs text-muted-foreground mt-0.5">{formatDate(entry.date)}</p>
                            )}
                          </div>
                          {isManual && (
                            <Can module="payments" action="delete">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                                    data-testid={`btn-delete-payment-${entry.paymentId}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently remove the {modeLabel} payment of {formatCurrency(entry.amount)}. Stock and order status will not be affected.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() => deletePaymentMutation.mutate({ id: entry.paymentId })}
                                      disabled={deletePaymentMutation.isPending}
                                      data-testid={`btn-confirm-delete-payment-${entry.paymentId}`}
                                    >
                                      Delete payment
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </Can>
                          )}
                        </div>
                      );
                    } else if (entry.kind === "reversal") {
                      return (
                        <div key={`reversal-${idx}`} className="relative flex items-start gap-3 pl-7">
                          <div className="absolute left-0 top-1 h-[22px] w-[22px] rounded-full bg-orange-100 dark:bg-orange-900/20 border-2 border-background ring-1 ring-orange-300 dark:ring-orange-800/40 flex items-center justify-center">
                            <Undo2 className="h-2.5 w-2.5 text-orange-600 dark:text-orange-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm text-orange-700 dark:text-orange-400">
                                Stock returned · {entry.shipmentNumber}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(entry.date)} · Back to {entry.warehouseName}
                            </p>
                            <div className="mt-1.5 space-y-0.5">
                              {entry.items.map((item, i) => (
                                <p key={i} className="text-xs text-muted-foreground">
                                  {item.itemName} <span className="font-mono">({item.sku})</span> ×{item.quantity}
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    } else if (entry.kind === "refund") {
                      const refundTypeLabel =
                        entry.refundType === "full" ? "Full Refund" :
                        entry.refundType === "partial" ? "Partial Refund" : "Item-wise Refund";
                      return (
                        <div key={`refund-${entry.refundId}`} className="relative flex items-start gap-3 pl-7">
                          <div className="absolute left-0 top-1 h-[22px] w-[22px] rounded-full bg-red-100 dark:bg-red-900/20 border-2 border-background ring-1 ring-red-300 dark:ring-red-800/40 flex items-center justify-center">
                            <RotateCcw className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm text-red-700 dark:text-red-400">{refundTypeLabel}</span>
                                <span className="text-xs text-muted-foreground">#{entry.refundNumber}</span>
                                {entry.restockItems && (
                                  <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                                    Restocked
                                  </span>
                                )}
                              </div>
                              <span className="font-semibold text-sm tabular-nums text-red-700 dark:text-red-400">
                                -{formatCurrency(entry.amount)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(entry.date)}{entry.reason ? ` · ${entry.reason}` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <PaymentLinkCard
        salesOrderId={order.id}
        balanceDue={Number(order.balanceDue)}
        orderStatus={order.status}
      />

      <RecordPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        customerId={order.customerId}
        customerName={order.customerName}
        presetSalesOrderId={order.id}
        presetSalesOrderBalance={Number(order.balanceDue)}
      />

      {/* ── Issue Refund dialog ──────────────────────────────────────────── */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue Refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Mode tabs */}
            <div className="flex rounded-md border overflow-hidden text-sm">
              {(["full", "partial", "item_wise"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    const amtPaid = Math.max(0, Number(order.amountPaid));
                    setRefundMode(m);
                    if (m === "full") {
                      setRefundForm((f) => ({
                        ...f,
                        refundAmount: String(amtPaid.toFixed(2)),
                      }));
                    } else if (m === "item_wise") {
                      const itemTotal = refundForm.lines
                        .filter((l) => l.include)
                        .reduce((s, l) => s + Number(l.quantity) * l.unitPrice, 0);
                      setRefundForm((f) => ({
                        ...f,
                        refundAmount: String(Math.min(amtPaid, itemTotal).toFixed(2)),
                      }));
                    }
                  }}
                  className={`flex-1 py-2 px-3 font-medium transition-colors ${
                    refundMode === m
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted/60 text-muted-foreground"
                  }`}
                  data-testid={`tab-refund-${m}`}
                >
                  {m === "full" ? "Full Refund" : m === "partial" ? "Partial Refund" : "Item-wise"}
                </button>
              ))}
            </div>

            {/* Date + Amount row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="refund-date">Refund date</Label>
                <Input
                  id="refund-date"
                  type="date"
                  value={refundForm.refundDate}
                  onChange={(e) => setRefundForm((f) => ({ ...f, refundDate: e.target.value }))}
                  data-testid="input-refund-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-amount">
                  {refundMode === "full" ? "Refund amount (₹)" : refundMode === "partial" ? "Amount to refund (₹)" : "Total refund (₹)"}
                </Label>
                <Input
                  id="refund-amount"
                  type="number"
                  min={0}
                  max={Number(order.amountPaid)}
                  step="0.01"
                  value={refundForm.refundAmount}
                  readOnly={refundMode === "full"}
                  onChange={(e) => {
                    if (refundMode !== "full")
                      setRefundForm((f) => ({ ...f, refundAmount: e.target.value }));
                  }}
                  placeholder="0.00"
                  className={refundMode === "full" ? "bg-muted/30 cursor-not-allowed" : ""}
                  data-testid="input-refund-amount"
                />
                <p className="text-xs text-muted-foreground">
                  Max: {formatCurrency(Number(order.amountPaid))} collected
                </p>
              </div>
            </div>

            {/* Item-wise breakdown with per-line restock controls */}
            {refundMode === "item_wise" && refundForm.lines.length > 0 && (
              <div className="space-y-2">
                <Label>Items to refund</Label>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        <th className="px-3 py-2 w-8"></th>
                        <th className="text-left px-3 py-2 font-medium">Item</th>
                        <th className="text-right px-3 py-2 font-medium w-24">Qty (max shipped)</th>
                        <th className="text-right px-3 py-2 font-medium w-28">Amount (₹)</th>
                        <th className="text-center px-3 py-2 font-medium w-10" title="Restock this line">⟳</th>
                        <th className="text-left px-3 py-2 font-medium">Restock warehouse</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {refundForm.lines.map((l, idx) => (
                        <tr key={l.salesOrderLineId} className={l.include ? "" : "opacity-40"}>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={l.include}
                              onChange={(e) => {
                                const amtPaid = Math.max(0, Number(order.amountPaid));
                                setRefundForm((f) => {
                                  const updated = f.lines.map((x, i) =>
                                    i === idx ? { ...x, include: e.target.checked } : x,
                                  );
                                  const itemTotal = updated
                                    .filter((x) => x.include)
                                    .reduce((s, x) => s + Number(x.quantity) * x.unitPrice, 0);
                                  return {
                                    ...f,
                                    lines: updated,
                                    refundAmount: String(Math.min(amtPaid, itemTotal).toFixed(2)),
                                  };
                                });
                              }}
                              className="h-4 w-4 rounded border-input"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{l.itemName}</div>
                            <div className="text-xs text-muted-foreground">{l.sku} · ₹{l.unitPrice.toFixed(2)}/unit</div>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              max={l.maxQty}
                              step="1"
                              value={l.quantity}
                              disabled={!l.include}
                              onChange={(e) => {
                                const amtPaid = Math.max(0, Number(order.amountPaid));
                                setRefundForm((f) => {
                                  const updated = f.lines.map((x, i) =>
                                    i === idx
                                      ? {
                                          ...x,
                                          quantity: e.target.value,
                                          refundAmount: String((Number(e.target.value) * x.unitPrice).toFixed(2)),
                                        }
                                      : x,
                                  );
                                  const itemTotal = updated
                                    .filter((x) => x.include)
                                    .reduce((s, x) => s + Number(x.quantity) * x.unitPrice, 0);
                                  return {
                                    ...f,
                                    lines: updated,
                                    refundAmount: String(Math.min(amtPaid, itemTotal).toFixed(2)),
                                  };
                                });
                              }}
                              className="h-7 text-right text-sm w-20 ml-auto"
                            />
                            <div className="text-xs text-right text-muted-foreground mt-0.5">max {l.maxQty}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={l.refundAmount}
                              disabled={!l.include}
                              onChange={(e) => {
                                const amtPaid = Math.max(0, Number(order.amountPaid));
                                setRefundForm((f) => {
                                  const updated = f.lines.map((x, i) =>
                                    i === idx ? { ...x, refundAmount: e.target.value } : x,
                                  );
                                  const itemTotal = updated
                                    .filter((x) => x.include)
                                    .reduce((s, x) => s + Number(x.refundAmount), 0);
                                  return {
                                    ...f,
                                    lines: updated,
                                    refundAmount: String(Math.min(amtPaid, itemTotal).toFixed(2)),
                                  };
                                });
                              }}
                              className="h-7 text-right text-sm w-24 ml-auto"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={l.restock}
                              disabled={!l.include}
                              onChange={(e) => setRefundForm((f) => ({
                                ...f,
                                lines: f.lines.map((x, i) =>
                                  i === idx ? { ...x, restock: e.target.checked } : x,
                                ),
                              }))}
                              className="h-4 w-4 rounded border-input"
                              title="Restock this line"
                            />
                          </td>
                          <td className="px-3 py-2">
                            {l.restock && l.include && (
                              <select
                                className="flex h-7 w-full rounded-md border border-input bg-transparent px-2 py-0 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                                value={l.lineWarehouseId}
                                onChange={(e) => setRefundForm((f) => ({
                                  ...f,
                                  lines: f.lines.map((x, i) =>
                                    i === idx ? { ...x, lineWarehouseId: e.target.value } : x,
                                  ),
                                }))}
                              >
                                <option value="">Select...</option>
                                {(warehousesQuery.data ?? []).map((w) => (
                                  <option key={w.id} value={String(w.id)}>{w.name}</option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="refund-reason">Reason</Label>
              <Input
                id="refund-reason"
                value={refundForm.reason}
                onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. Damaged goods, Customer changed mind"
                data-testid="input-refund-reason"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-notes">Internal notes (optional)</Label>
              <Textarea
                id="refund-notes"
                rows={2}
                value={refundForm.notes}
                onChange={(e) => setRefundForm((f) => ({ ...f, notes: e.target.value }))}
                data-testid="textarea-refund-notes"
              />
            </div>

            {/* Restock toggle — available for full/partial; item_wise uses per-line restock controls */}
            {refundMode !== "item_wise" && (
              <>
                <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/20">
                  <input
                    type="checkbox"
                    id="refund-restock"
                    checked={refundForm.restockItems}
                    onChange={(e) => setRefundForm((f) => ({ ...f, restockItems: e.target.checked }))}
                    className="h-4 w-4 rounded border-input"
                    data-testid="checkbox-refund-restock"
                  />
                  <div>
                    <label htmlFor="refund-restock" className="text-sm font-medium cursor-pointer">
                      Restock returned items
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Credit all shipped quantities back into warehouse stock.
                    </p>
                  </div>
                </div>
                {refundForm.restockItems && (
                  <div className="space-y-1.5">
                    <Label htmlFor="refund-warehouse">Restock to warehouse</Label>
                    <select
                      id="refund-warehouse"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={refundForm.warehouseId}
                      onChange={(e) => setRefundForm((f) => ({ ...f, warehouseId: e.target.value }))}
                      data-testid="select-refund-warehouse"
                    >
                      <option value="">Select warehouse...</option>
                      {(warehousesQuery.data ?? []).map((w) => (
                        <option key={w.id} value={String(w.id)}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const amount = Number(refundForm.refundAmount);
                if (!refundForm.refundDate || isNaN(amount) || amount <= 0) return;
                const activeLines =
                  refundMode === "item_wise"
                    ? refundForm.lines
                        .filter((l) => l.include && Number(l.quantity) > 0)
                        .map((l) => ({
                            salesOrderLineId: l.salesOrderLineId,
                            quantity: Number(l.quantity),
                            refundAmount: Number(l.refundAmount) || 0,
                            warehouseId: l.restock && l.lineWarehouseId ? Number(l.lineWarehouseId) : null,
                          }))
                    : [];
                createRefundMutation.mutate({
                  id: orderId,
                  data: {
                    refundDate: refundForm.refundDate,
                    refundAmount: amount,
                    reason: refundForm.reason.trim() || null,
                    notes: refundForm.notes.trim() || null,
                    restockItems: refundForm.restockItems,
                    warehouseId:
                      refundForm.restockItems && refundForm.warehouseId
                        ? Number(refundForm.warehouseId)
                        : null,
                    lines: activeLines,
                  },
                });
              }}
              disabled={
                createRefundMutation.isPending ||
                !refundForm.refundDate ||
                !refundForm.refundAmount ||
                Number(refundForm.refundAmount) <= 0
              }
              data-testid="btn-confirm-refund"
            >
              {createRefundMutation.isPending ? "Saving..." : "Record Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SendInvoiceDialog
        open={sendInvoiceOpen}
        onOpenChange={setSendInvoiceOpen}
        salesOrderId={order.id}
        orderNumber={order.orderNumber}
        customerId={order.customerId}
        customerName={order.customerName}
        paymentTerms={(order as typeof order & { paymentTerms?: string | null }).paymentTerms}
      />

      <NewShipmentDialog
        open={shipmentOpen}
        onOpenChange={setShipmentOpen}
        salesOrderId={order.id}
        warehouseId={order.warehouseId}
        lines={lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          itemName: l.itemName,
          sku: l.sku,
          quantity: Number(l.quantity),
          quantityShipped: Number(l.quantityShipped),
          trackBatches: !!l.trackBatches,
        }))}
      />

      {bookShipmentId !== null && (() => {
        const target = shipments.find((s) => s.id === bookShipmentId);
        if (!target) return null;
        return (
          <BookShiprocketDialog
            open={true}
            onOpenChange={(open) => {
              if (!open) setBookShipmentId(null);
            }}
            shipmentId={target.id}
            shipmentNumber={target.shipmentNumber}
            salesOrderId={order.id}
            customerName={order.customerName}
          />
        );
      })()}

      {/* Edit Tracking Dialog */}
      <Dialog
        open={editTrackingId !== null}
        onOpenChange={(open) => { if (!open) setEditTrackingId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Tracking Info</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-tracking-awb">AWB / Tracking Number</Label>
              <Input
                id="edit-tracking-awb"
                value={trackingForm.awb}
                onChange={(e) => setTrackingForm((f) => ({ ...f, awb: e.target.value }))}
                placeholder="e.g. 1234567890"
                data-testid="input-tracking-awb"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-tracking-courier">Courier / Carrier</Label>
              <Input
                id="edit-tracking-courier"
                value={trackingForm.courierName}
                onChange={(e) => setTrackingForm((f) => ({ ...f, courierName: e.target.value }))}
                placeholder="e.g. Delhivery, BlueDart, DTDC"
                data-testid="input-tracking-courier"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-tracking-url">Tracking URL</Label>
              <Input
                id="edit-tracking-url"
                value={trackingForm.trackingUrl}
                onChange={(e) => setTrackingForm((f) => ({ ...f, trackingUrl: e.target.value }))}
                placeholder="https://..."
                data-testid="input-tracking-url"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTrackingId(null)}>Cancel</Button>
            <Button
              disabled={updateShipmentMutation.isPending}
              data-testid="btn-save-tracking"
              onClick={() => {
                if (editTrackingId === null) return;
                updateShipmentMutation.mutate({
                  id: editTrackingId,
                  data: {
                    awb: trackingForm.awb || null,
                    courierName: trackingForm.courierName || null,
                    trackingUrl: trackingForm.trackingUrl || null,
                  },
                });
              }}
            >
              {updateShipmentMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Payment Details Dialog */}
      <Dialog open={editPaymentDetailsOpen} onOpenChange={setEditPaymentDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-payment-status">Payment Status</Label>
              <select
                id="edit-payment-status"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={paymentDetailsForm.paymentStatus}
                onChange={(e) => setPaymentDetailsForm((f) => ({ ...f, paymentStatus: e.target.value }))}
                data-testid="select-payment-status"
              >
                <option value="unpaid">Unpaid</option>
                <option value="pending">Pending</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option>
                <option value="refunded">Refunded</option>
                <option value="void">Void</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payment-method">Payment Method</Label>
              <select
                id="edit-payment-method"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={paymentDetailsForm.paymentMethod}
                onChange={(e) => setPaymentDetailsForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                data-testid="select-payment-method"
              >
                <option value="">— Select —</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="razorpay">Razorpay</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payment-reference">Reference / Transaction ID</Label>
              <Input
                id="edit-payment-reference"
                value={paymentDetailsForm.paymentReference}
                onChange={(e) => setPaymentDetailsForm((f) => ({ ...f, paymentReference: e.target.value }))}
                placeholder="e.g. UTR number, cheque number, UPI ref"
                data-testid="input-payment-reference"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-payment-terms">Payment Terms</Label>
              <Input
                id="edit-payment-terms"
                value={paymentDetailsForm.paymentTerms}
                onChange={(e) => setPaymentDetailsForm((f) => ({ ...f, paymentTerms: e.target.value }))}
                placeholder="e.g. Net 30, Cash on Delivery, Advance"
                data-testid="input-payment-terms"
              />
            </div>
            <p className="text-xs text-muted-foreground">These fields are informational and do not affect automated payment tracking.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPaymentDetailsOpen(false)}>Cancel</Button>
            <Button
              disabled={updatePaymentMetaMutation.isPending}
              data-testid="btn-save-payment-details"
              onClick={() => {
                updatePaymentMetaMutation.mutate({
                  id: orderId,
                  data: {
                    paymentStatus: (paymentDetailsForm.paymentStatus || null) as import("@workspace/api-client-react").UpdateSalesOrderPaymentMetaPayloadPaymentStatus,
                    paymentMethod: (paymentDetailsForm.paymentMethod.trim() || null) as import("@workspace/api-client-react").UpdateSalesOrderPaymentMetaPayloadPaymentMethod,
                    paymentReference: paymentDetailsForm.paymentReference.trim() || null,
                    paymentTerms: paymentDetailsForm.paymentTerms.trim() || null,
                  },
                });
              }}
            >
              {updatePaymentMetaMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EwbPanel
        orderId={order.id}
        orderNumber={order.orderNumber}
        orderStatus={order.status}
        ewb={order.ewb ?? null}
      />

      <EinvoicePanel
        orderId={order.id}
        orderNumber={order.orderNumber}
        orderStatus={order.status}
        customerId={order.customerId}
        customerName={order.customerName}
        customerHasGstin={!!order.customerGstNumber}
        einvoice={order.einvoice ?? null}
      />

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Shipped</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const ordered = Number(line.quantity);
                const shipped = Number(line.quantityShipped);
                const remaining = Math.max(0, ordered - shipped);
                const discAmt = Number(line.discountAmount ?? 0);
                const discPct = Number(line.discountPercent ?? 0);
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="font-medium">{line.itemName}</div>
                      <div className="text-xs text-muted-foreground">{line.sku}</div>
                      {line.description && <div className="text-xs text-muted-foreground mt-1">{line.description}</div>}
                    </TableCell>
                    <TableCell className="text-right">{ordered}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          shipped > 0 && shipped < ordered
                            ? "text-blue-600 dark:text-blue-400"
                            : ""
                        }
                        data-testid={`text-shipped-${line.id}`}
                      >
                        {shipped}
                      </span>
                      {remaining > 0 && shipped > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({remaining} pending)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
                    <TableCell className="text-right">
                      {discAmt > 0 ? (
                        <span className="text-green-600 dark:text-green-400">
                          -{formatCurrency(discAmt)}
                          {discPct > 0 && <span className="text-xs text-muted-foreground ml-1">({discPct}%)</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(line.lineTax)} <span className="text-xs text-muted-foreground">({line.taxRate}%)</span></TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(line.lineTotal)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="card-shipments">
        <CardHeader>
          <CardTitle>Fulfillments</CardTitle>
        </CardHeader>
        <CardContent>
          {shipments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shipments yet. Use "New shipment" to record what you've sent out.
            </p>
          ) : (
            <div className="space-y-4">
              {shipments.map((s) => {
                const enriched = s as typeof s & { fulfillmentId?: number | null };
                return (
                  <div
                    key={s.id}
                    className="border rounded-lg overflow-hidden"
                    data-testid={`shipment-${s.id}`}
                  >
                    {/* Card header stripe */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <Package className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{s.shipmentNumber}</span>
                            <StatusBadge status={s.status} />
                            {s.trackingStatus && (
                              <Badge variant="outline" className="text-[10px]" data-testid={`shipment-tracking-status-${s.id}`}>
                                {s.trackingStatus.replace(/_/g, " ")}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Shipped {formatDate(s.shipDate)}
                            {s.courierName && ` · ${s.courierName}`}
                            {s.awb && ` · AWB ${s.awb}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {enriched.fulfillmentId && (
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                            data-testid={`btn-view-fulfillment-${s.id}`}
                          >
                            <Link href={`/fulfillments/${enriched.fulfillmentId}`}>
                              <ExternalLink className="mr-1.5 h-3 w-3" /> Fulfillment
                            </Link>
                          </Button>
                        )}
                        {s.labelUrl && (
                          <Button size="sm" variant="outline" asChild data-testid={`btn-print-label-${s.id}`}>
                            <a href={s.labelUrl} target="_blank" rel="noopener noreferrer">
                              <FileDown className="mr-1.5 h-3 w-3" /> Label
                            </a>
                          </Button>
                        )}
                        {s.trackingUrl && (
                          <Button size="sm" variant="outline" asChild data-testid={`btn-track-shipment-${s.id}`}>
                            <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">
                              <Truck className="mr-1.5 h-3 w-3" /> Track
                            </a>
                          </Button>
                        )}
                        {s.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTrackingForm({
                                awb: s.awb ?? "",
                                courierName: s.courierName ?? "",
                                trackingUrl: s.trackingUrl ?? "",
                              });
                              setEditTrackingId(s.id);
                            }}
                            data-testid={`btn-edit-tracking-${s.id}`}
                          >
                            <Pencil className="mr-1.5 h-3 w-3" /> Edit Tracking
                          </Button>
                        )}
                        {s.status !== "cancelled" && !s.awb && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setBookShipmentId(s.id)}
                            data-testid={`btn-book-shiprocket-${s.id}`}
                          >
                            <Truck className="mr-1.5 h-3 w-3" /> Book on Shiprocket
                          </Button>
                        )}
                        {s.status !== "cancelled" && canCancelShipments && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive"
                                disabled={cancelShipmentMutation.isPending}
                                data-testid={`btn-cancel-shipment-${s.id}`}
                              >
                                Cancel
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Cancel this shipment?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Stock will be added back to {order.warehouseName} and the line quantities will be available to ship again.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <div className="space-y-2 py-2">
                                <label
                                  htmlFor={`cancel-reason-${s.id}`}
                                  className="text-sm font-medium"
                                >
                                  Reason
                                </label>
                                <select
                                  id={`cancel-reason-${s.id}`}
                                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                  value={getReason(s.id).code}
                                  onChange={(e) => setReason(s.id, { code: e.target.value })}
                                  data-testid={`select-cancel-reason-${s.id}`}
                                >
                                  <option value="">(not specified)</option>
                                  <option value="customer_changed_mind">Customer changed mind</option>
                                  <option value="damaged">Damaged</option>
                                  <option value="wrong_item">Wrong item</option>
                                  <option value="defective">Defective</option>
                                  <option value="pricing_error">Pricing error</option>
                                  <option value="duplicate">Duplicate</option>
                                  <option value="other">Other</option>
                                </select>
                                <label
                                  htmlFor={`cancel-notes-${s.id}`}
                                  className="text-sm font-medium block pt-2"
                                >
                                  Notes (optional)
                                </label>
                                <textarea
                                  id={`cancel-notes-${s.id}`}
                                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                  rows={2}
                                  maxLength={1000}
                                  value={getReason(s.id).notes}
                                  onChange={(e) => setReason(s.id, { notes: e.target.value })}
                                  data-testid={`textarea-cancel-notes-${s.id}`}
                                />
                              </div>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Keep shipment</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => {
                                    const r = getReason(s.id);
                                    cancelShipmentMutation.mutate({
                                      shipmentId: s.id,
                                      data: {
                                        ...(r.code ? { reasonCode: r.code as never } : {}),
                                        ...(r.notes.trim() ? { reasonNotes: r.notes.trim() } : {}),
                                      },
                                    });
                                  }}
                                  data-testid={`btn-confirm-cancel-shipment-${s.id}`}
                                  disabled={cancelShipmentMutation.isPending}
                                >
                                  Cancel shipment
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                    {/* Items list */}
                    <div className="divide-y">
                      {s.lines.map((sl) => (
                        <div key={sl.id} className="flex items-center justify-between px-4 py-2.5">
                          <div>
                            <div className="text-sm font-medium">{sl.itemName}</div>
                            <div className="text-xs text-muted-foreground">{sl.sku}</div>
                          </div>
                          <div className="text-sm font-medium tabular-nums">×{sl.quantity}</div>
                        </div>
                      ))}
                    </div>
                    {s.notes && (
                      <div className="px-4 py-2.5 border-t bg-muted/20">
                        <p className="text-xs text-muted-foreground">{s.notes}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Refunds ─────────────────────────────────────────────────────── */}
      {((["confirmed","partially_shipped","shipped","delivered","invoiced","paid","returned"] as string[]).includes(order.status) || Number(order.amountPaid) > 0) && (
        <Card data-testid="card-refunds">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle>Refunds</CardTitle>
            <Can module="sales_orders" action="edit">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const amtPaid = Math.max(0, Number(order.amountPaid));
                  const defaultLines = lines
                    .filter((l) => Number(l.quantityShipped) > 0)
                    .map((l) => ({
                      salesOrderLineId: l.id,
                      itemId: l.itemId,
                      itemName: l.itemName,
                      sku: l.sku,
                      maxQty: Number(l.quantityShipped),
                      unitPrice: Number(l.unitPrice),
                      quantity: "0",
                      refundAmount: "0.00",
                      include: false,
                      restock: false,
                      lineWarehouseId: String(order.warehouseId),
                    }));
                  setRefundMode("full");
                  setRefundForm({
                    refundDate: new Date().toISOString().slice(0, 10),
                    refundAmount: String(amtPaid.toFixed(2)),
                    reason: "",
                    notes: "",
                    restockItems: false,
                    warehouseId: String(order.warehouseId),
                    lines: defaultLines,
                  });
                  setRefundDialogOpen(true);
                }}
                data-testid="btn-new-refund"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Issue Refund
              </Button>
            </Can>
          </CardHeader>
          <CardContent>
            {refundsQuery.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : refundsQuery.data && refundsQuery.data.length > 0 ? (
              <div className="space-y-3">
                {refundsQuery.data.map((r) => (
                  <div key={r.id} className="border rounded-lg overflow-hidden" data-testid={`refund-${r.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center shrink-0">
                          <RotateCcw className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                          <div className="font-semibold text-sm">{r.refundNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(r.refundDate)}
                            {r.reason && ` · ${r.reason}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm text-orange-700 dark:text-orange-400">
                          -{formatCurrency(r.refundAmount)}
                        </div>
                        {r.restockItems && (
                          <div className="text-xs text-muted-foreground">Items restocked</div>
                        )}
                      </div>
                    </div>
                    {r.lines.length > 0 && (
                      <div className="divide-y">
                        {r.lines.map((l) => (
                          <div key={l.id} className="flex items-center justify-between px-4 py-2.5">
                            <div>
                              <div className="text-sm font-medium">{l.itemName}</div>
                              <div className="text-xs text-muted-foreground">{l.sku}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm tabular-nums">×{l.quantity}</div>
                              {l.refundAmount > 0 && (
                                <div className="text-xs text-muted-foreground">{formatCurrency(l.refundAmount)}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {r.notes && (
                      <div className="px-4 py-2.5 border-t bg-muted/20">
                        <p className="text-xs text-muted-foreground">{r.notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No refunds recorded for this order.</p>
            )}
          </CardContent>
        </Card>
      )}

      {canInvoice && (
        <Card data-testid="card-email-log">
          <CardHeader>
            <CardTitle>Email history</CardTitle>
          </CardHeader>
          <CardContent>
            {emailLogQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : emailLogQuery.data && emailLogQuery.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sent</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emailLogQuery.data.map((e) => (
                    <TableRow key={e.id} data-testid={`email-log-${e.id}`}>
                      <TableCell>{formatDate(e.sentAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {e.kind === "shipping_confirmation"
                          ? "Shipping confirmation"
                          : "Invoice"}
                      </TableCell>
                      <TableCell>{e.recipient}</TableCell>
                      <TableCell className="text-sm">{e.subject}</TableCell>
                      <TableCell>
                        <span
                          className={
                            e.status === "sent"
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400"
                          }
                        >
                          {e.status === "sent" ? "Sent" : "Failed"}
                        </span>
                        {e.errorMessage && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {e.errorMessage}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                No emails sent yet for this order.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-stock-history">
        <CardHeader>
          <CardTitle>Stock History</CardTitle>
        </CardHeader>
        <CardContent>
          {movementsQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : movementsQuery.data && movementsQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movementsQuery.data.map((m) => {
                  const qty = Number(m.quantity);
                  const isReturn = m.movementType === "sales_return";
                  return (
                    <TableRow key={m.id}>
                      <TableCell>{formatDate(m.createdAt)}</TableCell>
                      <TableCell>
                        <span
                          className={
                            isReturn
                              ? "text-green-600 dark:text-green-400"
                              : "text-muted-foreground"
                          }
                        >
                          {isReturn ? "Return" : "Sale"}
                        </span>
                      </TableCell>
                      <TableCell>{m.itemName}</TableCell>
                      <TableCell className="text-right font-medium">
                        {qty > 0 ? `+${qty}` : qty}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.notes || "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No stock movements yet. They will appear here once the order ships.
            </p>
          )}
        </CardContent>
      </Card>
      {/* Hidden thermal receipt — only revealed by @media print */}
      <SalesOrderThermalReceipt orderDetail={orderDetail as unknown as Parameters<typeof SalesOrderThermalReceipt>[0]["orderDetail"]} />
    </div>
  );
}

function formatSOReceiptDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  let h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(h)}.${pad(d.getMinutes())} ${ampm}`;
}

const SO_CHANNEL_LABELS: Record<string, string> = {
  pos: "POS",
  walkin: "Walk-in",
  website: "Website",
  store: "Store",
  whatsapp: "WhatsApp",
  phone: "Phone",
  instagram: "Instagram",
  other: "Other",
};
const SO_PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank Transfer",
  razorpay: "Razorpay",
};

function SalesOrderThermalReceipt({
  orderDetail,
}: {
  orderDetail: {
    order: Record<string, unknown>;
    customerPhone?: string | null;
    lines: Record<string, unknown>[];
    paymentBreakdown?: Array<{ mode: string; referenceNumber?: string | null; amount: number }>;
  } | null | undefined;
}) {
  const { data: org } = useGetCurrentOrganization();
  const { data: me } = useGetMe();
  const orgAny = org as unknown as Record<string, string | null | undefined> | undefined;
  const { src: logoSrc } = useImageSrc(orgAny?.thermalLogoUrl ?? org?.logoUrl);
  if (!orderDetail) return null;

  const paymentBreakdown = orderDetail.paymentBreakdown ?? [];

  const { order, lines, customerPhone } = orderDetail as {
    order: {
      id: number;
      orderNumber: string;
      customerName?: string | null;
      walkinName?: string | null;
      saleChannel?: string | null;
      taxTotal: string | number;
      total: string | number;
      subtotal: string | number;
      discountTotal?: string | number | null;
    };
    customerPhone?: string | null;
    lines: {
      itemName: string;
      sku: string;
      quantity: string | number;
      unitPrice: string | number;
      discountAmount?: string | number | null;
    }[];
  };

  const cashier = me?.user?.name || me?.user?.email || "";
  const addressParts = [
    org?.addressLine1,
    org?.addressLine2,
    [org?.city, org?.state, org?.postalCode].filter(Boolean).join(" "),
    org?.country,
  ].filter((p): p is string => !!p && p.trim().length > 0);

  const totalQty = lines.reduce((s, l) => s + Number(l.quantity), 0);
  const lineData = lines.map((l) => {
    const qty = Number(l.quantity);
    const price = Number(l.unitPrice);
    const gross = qty * price;
    const disc = Number(l.discountAmount ?? 0);
    return { ...l, qty, price, gross, disc };
  });

  const tax = Number(order.taxTotal);
  const total = Number(order.total);
  const subtotal = Number(order.subtotal);
  const discTotal = Number(order.discountTotal ?? 0);
  const totalPaid = paymentBreakdown.reduce((s, p) => s + Number(p.amount), 0);
  const balanceDue = Math.max(0, total - totalPaid);

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #_so_thermal_, #_so_thermal_ * { visibility: visible !important; }
          #_so_thermal_ {
            display: block !important;
            position: absolute !important;
            left: 0; top: 0;
            width: 72mm;
            padding: 3mm 4mm;
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 9pt;
            line-height: 1.35;
            color: #000;
            background: #fff;
          }
          @page { size: 72mm auto; margin: 0; }
        }
        #_so_thermal_ { display: none; }
        #_so_thermal_ .center { text-align: center; }
        #_so_thermal_ .bold { font-weight: 700; }
        #_so_thermal_ .small { font-size: 8pt; }
        #_so_thermal_ .xs { font-size: 7pt; }
        #_so_thermal_ .logo {
          max-width: 38mm; max-height: 20mm; object-fit: contain;
          display: inline-block; margin-bottom: 1mm;
        }
        #_so_thermal_ .biz-name {
          font-size: 15pt; font-weight: 700; letter-spacing: 0.3px; margin-top: 1mm;
        }
        #_so_thermal_ .title {
          font-size: 11pt; font-weight: 700; margin: 1.5mm 0 0.5mm;
        }
        #_so_thermal_ .sep { border-top: 1px dashed #000; margin: 1.5mm 0; }
        #_so_thermal_ .kv { display: flex; gap: 2mm; }
        #_so_thermal_ .kv > span:first-child { width: 28mm; flex-shrink: 0; }
        #_so_thermal_ table { width: 100%; border-collapse: collapse; }
        #_so_thermal_ th, #_so_thermal_ td {
          text-align: left; padding: 0.6mm 0; vertical-align: top;
        }
        #_so_thermal_ th.r, #_so_thermal_ td.r { text-align: right; padding-left: 3mm; }
        #_so_thermal_ thead th { border-bottom: 1px solid #000; }
        #_so_thermal_ tfoot td { padding-top: 1mm; }
        #_so_thermal_ .total-row td {
          border-top: 1px solid #000; font-size: 11.5pt; font-weight: 700; padding-top: 1mm;
        }
        #_so_thermal_ .disc-row td { font-size: 8pt; color: #444; }
        #_so_thermal_ .footer-web {
          font-weight: 700; font-size: 11pt; margin-top: 1mm;
        }
      `}</style>
      <div id="_so_thermal_" style={{ display: "none" }}>
        {logoSrc && (
          <div className="center">
            <img src={logoSrc} alt="" className="logo" />
          </div>
        )}
        {org?.name && <div className="center biz-name">{org.name}</div>}
        {addressParts.map((p, i) => (
          <div className="center small" key={i}>{p}</div>
        ))}
        {org?.gstNumber && (
          <div className="center small">GSTIN : {org.gstNumber}</div>
        )}
        <div className="center title">Retail Invoice</div>
        <div className="sep" />
        <div className="kv">
          <span>Date</span>
          <span>: {formatSOReceiptDateTime(new Date())}</span>
        </div>
        <div className="kv">
          <span>Bill No</span>
          <span>: {order.orderNumber}</span>
        </div>
        {cashier && (
          <div className="kv">
            <span>Cashier</span>
            <span>: {cashier}</span>
          </div>
        )}
        {(order.walkinName || (order.customerName && order.customerName !== "Walk-in Customer")) && (
          <div className="kv bold">
            <span>Customer</span>
            <span>: {order.walkinName || order.customerName}</span>
          </div>
        )}
        {customerPhone && (
          <div className="kv bold">
            <span>Phone</span>
            <span>: {customerPhone}</span>
          </div>
        )}
        {order.saleChannel && order.saleChannel !== "pos" && (
          <div className="kv small">
            <span>Channel</span>
            <span>: {SO_CHANNEL_LABELS[order.saleChannel] ?? order.saleChannel}</span>
          </div>
        )}
        <div className="sep" />
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Qty</th>
              <th className="r">Price</th>
              <th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lineData.map((l, i) => (
              <Fragment key={i}>
                <tr>
                  <td>
                    {l.itemName}
                    <div className="xs">{l.sku}</div>
                  </td>
                  <td className="r">{l.qty}</td>
                  <td className="r">{l.price.toFixed(2)}</td>
                  <td className="r">{l.gross.toFixed(2)}</td>
                </tr>
                {l.disc > 0 && (
                  <tr className="disc-row">
                    <td colSpan={3} style={{ paddingLeft: "3mm" }}>(-) Item Discount</td>
                    <td className="r">-{l.disc.toFixed(2)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="bold">Sub Total</td>
              <td className="r bold">{totalQty}</td>
              <td />
              <td className="r bold">{subtotal.toFixed(2)}</td>
            </tr>
            {discTotal > 0 && (
              <tr>
                <td colSpan={3}>(-) Order Discount</td>
                <td className="r">-{discTotal.toFixed(2)}</td>
              </tr>
            )}
            {tax > 0 && (
              <tr>
                <td colSpan={3}>Tax</td>
                <td className="r">{tax.toFixed(2)}</td>
              </tr>
            )}
            <tr className="total-row">
              <td colSpan={3}>TOTAL</td>
              <td className="r">RS {total.toFixed(2)}</td>
            </tr>
            {paymentBreakdown.length > 0 && paymentBreakdown.map((p, i) => (
              <tr key={i}>
                <td colSpan={3}>{SO_PAYMENT_LABELS[p.mode ?? ""] ?? (p.mode ?? "Payment")}</td>
                <td className="r">{Number(p.amount).toFixed(2)}</td>
              </tr>
            ))}
            {balanceDue > 0 && (
              <tr>
                <td colSpan={3}>Balance Due</td>
                <td className="r">{balanceDue.toFixed(2)}</td>
              </tr>
            )}
          </tfoot>
        </table>
        <div className="sep" />
        {org?.invoiceFooter && (
          <div className="center footer-web">{org.invoiceFooter}</div>
        )}
        <div className="center small">Thank you for your purchase</div>
        <div className="center xs">This is a Computer Generated Invoice</div>
      </div>
    </>
  );
}
