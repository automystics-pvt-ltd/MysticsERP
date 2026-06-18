import { PageHeader } from "@/components/PageHeader";
import {
  useGetSalesOrder,
  useUpdateSalesOrder,
  useListCustomers,
  useListWarehouses,
  useListItems,
  getGetSalesOrderQueryKey,
  getListSalesOrdersQueryKey,
  getListSalesOrderShipmentsQueryKey,
  useGetCurrentOrganization,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { Trash2, Plus, ArrowLeft, AlertTriangle, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ItemPicker } from "@/components/ItemPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useMemo, useRef, useState } from "react";

const orderLineSchema = z.object({
  id: z.number().optional(),
  itemId: z.coerce.number().min(1, "Item required"),
  quantity: z.coerce.number().min(1, "Must be > 0"),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  discountAmount: z.coerce.number().min(0).optional().default(0),
  description: z.string().optional(),
});

const salesOrderSchema = z.object({
  customerId: z.coerce.number().min(1, "Customer is required"),
  warehouseId: z.coerce.number().min(1, "Warehouse is required"),
  orderDate: z.string().min(1, "Date is required"),
  expectedShipDate: z.string().optional().or(z.literal("")),
  notes: z.string().optional(),
  lines: z.array(orderLineSchema).min(1, "At least one item is required"),
});

type SalesOrderFormValues = z.infer<typeof salesOrderSchema>;

export default function SalesOrderEdit() {
  const { id } = useParams();
  const orderId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: orderDetail, isLoading } = useGetSalesOrder(orderId, {
    query: { enabled: !!orderId, queryKey: getGetSalesOrderQueryKey(orderId) },
  });
  const { data: customers } = useListCustomers();
  const { data: warehouses } = useListWarehouses();
  const { data: org } = useGetCurrentOrganization();
  const showOrderDiscount = (org as any)?.showOrderDiscount ?? true;

  const [parentByLine, setParentByLine] = useState<Record<string, number>>({});
  const prefilledRef = useRef(false);

  const [orderDiscountMode, setOrderDiscountMode] = useState<"percent" | "amount">("percent");
  const [orderDiscountValue, setOrderDiscountValue] = useState<number>(0);

  const updateMutation = useUpdateSalesOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalesOrderQueryKey(orderId) });
        queryClient.invalidateQueries({ queryKey: getListSalesOrdersQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getListSalesOrderShipmentsQueryKey(orderId),
        });
        toast({ title: "Sales order updated" });
        setLocation(`/sales-orders/${orderId}`);
      },
      onError: (err: unknown) => {
        const e = err as {
          data?: { error?: string };
          response?: { data?: { error?: string } };
          message?: string;
        };
        toast({
          title: "Could not update order",
          description:
            e.data?.error ?? e.response?.data?.error ?? e.message ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const form = useForm<SalesOrderFormValues>({
    resolver: zodResolver(salesOrderSchema),
    defaultValues: {
      customerId: 0,
      warehouseId: 0,
      orderDate: "",
      expectedShipDate: "",
      notes: "",
      lines: [
        { itemId: 0, quantity: 1, unitPrice: 0, taxRate: 18, discountPercent: 0, description: "" },
      ],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const watchWarehouseId = form.watch("warehouseId");
  const parsedWarehouseId = Number(watchWarehouseId);
  const warehouseIdNum =
    Number.isFinite(parsedWarehouseId) && parsedWarehouseId > 0
      ? parsedWarehouseId
      : undefined;

  const orderWarehouseId = orderDetail?.order.warehouseId ?? undefined;
  const { data: prefetchedItemsRaw } = useListItems(
    orderWarehouseId ? { warehouseId: orderWarehouseId } : undefined,
  );
  const { data: itemsRaw } = useListItems(
    warehouseIdNum ? { warehouseId: warehouseIdNum } : undefined,
  );
  const items = useMemo(
    () => itemsRaw ?? prefetchedItemsRaw ?? [],
    [itemsRaw, prefetchedItemsRaw],
  );

  // Only show in-stock items for sales orders
  const inStockItems = useMemo(() => {
    if (!warehouseIdNum) return items;
    return items.filter((i) => {
      if (i.parentItemId != null) return true;
      if (i.hasVariants) return true;
      return (i.stockAtWarehouse ?? 0) > 0;
    });
  }, [items, warehouseIdNum]);

  useEffect(() => {
    if (prefilledRef.current || !orderDetail || !customers || !warehouses || !prefetchedItemsRaw)
      return;
    const o = orderDetail.order;
    const existingDisc = Number(o.orderDiscountAmount ?? 0);
    if (existingDisc > 0) {
      setOrderDiscountMode("amount");
      setOrderDiscountValue(existingDisc);
    }
    form.reset({
      customerId: o.customerId,
      warehouseId: o.warehouseId,
      orderDate: o.orderDate,
      expectedShipDate: o.expectedShipDate ?? "",
      notes: o.notes ?? "",
      lines:
        orderDetail.lines.length > 0
          ? orderDetail.lines.map((l) => ({
              id: l.id,
              itemId: l.itemId,
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
              taxRate: Number(l.taxRate),
              discountPercent: Number(l.discountPercent ?? 0),
              discountAmount: Number(l.discountAmount ?? 0),
              description: l.description ?? "",
            }))
          : [{ itemId: 0, quantity: 1, unitPrice: 0, taxRate: 18, description: "" }],
    });
    prefilledRef.current = true;
  }, [orderDetail, form, customers, warehouses, prefetchedItemsRaw]);

  const previousWarehouseRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const prev = previousWarehouseRef.current;
    if (prefilledRef.current && prev !== undefined && prev !== warehouseIdNum) {
      replace([
        {
          itemId: 0,
          quantity: 1,
          unitPrice: 0,
          taxRate: 18,
          discountPercent: 0,
          discountAmount: 0,
          description: "",
        },
      ]);
      setParentByLine({});
    }
    previousWarehouseRef.current = warehouseIdNum;
  }, [warehouseIdNum, replace]);

  const watchLines = form.watch("lines");

  const resolveLineDiscount = (gross: number, pct: number, flat: number) => {
    if (pct > 0) return Math.min(gross, Math.round((gross * pct) / 100 * 100) / 100);
    if (flat > 0) return Math.min(gross, flat);
    return 0;
  };

  const taxMode = (org as any)?.taxMode ?? "exclusive";
  const { subtotal, taxTotal } = watchLines.reduce(
    (acc, line) => {
      const gross = line.quantity * line.unitPrice;
      const disc = resolveLineDiscount(
        gross,
        line.discountPercent || 0,
        line.discountAmount || 0,
      );
      if (taxMode === "inclusive") {
        const lineTotal = gross - disc;
        const lineTax =
          line.taxRate > 0 ? (lineTotal * line.taxRate) / (100 + line.taxRate) : 0;
        return {
          subtotal: acc.subtotal + lineTotal - lineTax,
          taxTotal: acc.taxTotal + lineTax,
        };
      }
      const lineSubtotal = gross - disc;
      return {
        subtotal: acc.subtotal + lineSubtotal,
        taxTotal: acc.taxTotal + lineSubtotal * (line.taxRate / 100),
      };
    },
    { subtotal: 0, taxTotal: 0 },
  );

  const orderDiscountComputed =
    orderDiscountMode === "percent"
      ? Math.min(
          subtotal + taxTotal,
          Math.round(((subtotal + taxTotal) * orderDiscountValue) / 100 * 100) / 100,
        )
      : Math.min(subtotal + taxTotal, orderDiscountValue);
  const total = subtotal + taxTotal - orderDiscountComputed;

  const totalQuantity = watchLines.reduce((sum, l) => sum + (l.quantity || 0), 0);

  const stockViolations = useMemo(() => {
    if (!items || !warehouseIdNum) return watchLines.map(() => false);
    return watchLines.map((line) => {
      if (!line.itemId) return false;
      const item = items.find((i) => i.id === line.itemId);
      if (!item || item.stockAtWarehouse == null) return false;
      return line.quantity > item.stockAtWarehouse;
    });
  }, [watchLines, items, warehouseIdNum]);
  const hasStockViolations = stockViolations.some(Boolean);

  const onSubmit = (data: SalesOrderFormValues) => {
    if (hasStockViolations) {
      toast({
        title: "Insufficient stock",
        description: "One or more items exceed available stock. Please reduce quantities.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      id: orderId,
      data: {
        ...data,
        expectedShipDate: data.expectedShipDate || null,
        notes: data.notes || null,
        orderDiscountAmount: orderDiscountComputed > 0 ? orderDiscountComputed : 0,
        lines: data.lines.map((l) => ({ ...l, description: l.description || null })),
      },
    });
  };

  const applyItemDefaults = (index: number, itemId: number) => {
    const selectedItem = items.find((i) => i.id === itemId);
    if (selectedItem) {
      form.setValue(`lines.${index}.unitPrice`, selectedItem.salePrice);
      form.setValue(`lines.${index}.taxRate`, selectedItem.taxRate);
      form.setValue(`lines.${index}.description`, selectedItem.description || "");
      if (selectedItem.stockAtWarehouse != null) {
        const currentQty = form.getValues(`lines.${index}.quantity`);
        if (currentQty > selectedItem.stockAtWarehouse) {
          form.setValue(
            `lines.${index}.quantity`,
            Math.max(1, selectedItem.stockAtWarehouse),
            { shouldValidate: true },
          );
        }
      }
    }
  };

  const handleParentChange = (index: number, fieldId: string, parentId: number) => {
    const picked = items.find((i) => i.id === parentId);
    if (!picked) return;
    if (picked.hasVariants) {
      setParentByLine((prev) => ({ ...prev, [fieldId]: parentId }));
      form.setValue(`lines.${index}.itemId`, 0);
    } else {
      setParentByLine((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
      form.setValue(`lines.${index}.itemId`, picked.id);
      applyItemDefaults(index, picked.id);
    }
  };

  const handleVariantChange = (index: number, fieldId: string, variantId: number) => {
    setParentByLine((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    form.setValue(`lines.${index}.itemId`, variantId);
    applyItemDefaults(index, variantId);
  };

  const handleQtyChange = (index: number, rawValue: string) => {
    const v = Number(rawValue);
    if (!Number.isFinite(v) || v < 0) return;
    const itemId = form.getValues(`lines.${index}.itemId`);
    const item = items.find((i) => i.id === itemId);
    const maxStock = item?.stockAtWarehouse ?? null;
    const capped = maxStock != null ? Math.min(v, maxStock) : v;
    form.setValue(`lines.${index}.quantity`, capped, { shouldValidate: true });
  };

  if (
    isLoading ||
    !orderDetail ||
    !customers ||
    !warehouses ||
    !prefetchedItemsRaw
  ) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!["draft", "confirmed", "invoiced", "paid"].includes(orderDetail.order.status)) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/sales-orders/${orderId}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <PageHeader
            title={`Edit ${orderDetail.order.orderNumber}`}
            className="mb-0"
          />
        </div>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm">
              This order is{" "}
              <span className="font-medium">
                {orderDetail.order.status.replace(/_/g, " ")}
              </span>{" "}
              and can no longer be edited. Only draft and confirmed orders (with no
              recorded shipments) can be edited.
            </p>
            <div>
              <Button asChild>
                <Link href={`/sales-orders/${orderId}`}>Back to order</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const emptyLineDefaults = () => ({
    itemId: 0,
    quantity: 1,
    unitPrice: 0,
    taxRate: 18,
    discountPercent: 0,
    discountAmount: 0,
    description: "",
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/sales-orders/${orderId}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader
          title={`Edit ${orderDetail.order.orderNumber}`}
          className="mb-0"
        />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Header details */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-xs font-medium text-muted-foreground">
                        Client name *
                      </Label>
                      <Select
                        key={field.value ? `c-${field.value}` : "c-empty"}
                        onValueChange={field.onChange}
                        value={field.value ? field.value.toString() : ""}
                      >
                        <FormControl>
                          <SelectTrigger className="mt-1" data-testid="select-customer">
                            <SelectValue placeholder="Select a customer" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customers?.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="warehouseId"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-xs font-medium text-muted-foreground">
                        Fulfill from Warehouse *
                      </Label>
                      <Select
                        key={field.value ? `w-${field.value}` : "w-empty"}
                        onValueChange={field.onChange}
                        value={field.value ? field.value.toString() : ""}
                      >
                        <FormControl>
                          <SelectTrigger className="mt-1" data-testid="select-warehouse">
                            <SelectValue placeholder="Select warehouse" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouses?.map((w) => (
                            <SelectItem key={w.id} value={w.id.toString()}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="orderDate"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-xs font-medium text-muted-foreground">
                        Order date *
                      </Label>
                      <FormControl>
                        <Input
                          type="date"
                          className="mt-1"
                          {...field}
                          data-testid="input-order-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expectedShipDate"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-xs font-medium text-muted-foreground">
                        Due date
                      </Label>
                      <FormControl>
                        <Input
                          type="date"
                          className="mt-1"
                          {...field}
                          data-testid="input-ship-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Invoice / Line items table */}
          <Card>
            <CardContent className="pt-6 px-0 pb-0">
              <div className="px-6 pb-3 flex items-center justify-between">
                <h3 className="font-semibold text-base">Invoice</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-y">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-8">
                        No
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground min-w-[200px]">
                        Item Name
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground min-w-[130px]">
                        Description
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[90px]">
                        HSN/SAC
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[70px]">
                        Unit
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[80px]">
                        QTY
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[100px]">
                        Price
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[90px]">
                        Disc%
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[70px]">
                        Tax%
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-[100px]">
                        Total
                      </th>
                      <th className="px-3 py-2 w-[100px] text-right">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => append(emptyLineDefaults())}
                          data-testid="btn-add-line"
                          className="h-7 px-2 text-xs"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add line
                        </Button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, index) => {
                      const lineItem = items.find(
                        (i) => i.id === watchLines[index]?.itemId,
                      );
                      const availableStock = lineItem?.stockAtWarehouse ?? null;
                      const gross =
                        watchLines[index].quantity * watchLines[index].unitPrice;
                      const disc = resolveLineDiscount(
                        gross,
                        watchLines[index].discountPercent || 0,
                        watchLines[index].discountAmount || 0,
                      );
                      const netAfterDisc = gross - disc;
                      const lineTotal =
                        taxMode === "inclusive"
                          ? netAfterDisc
                          : netAfterDisc * (1 + watchLines[index].taxRate / 100);

                      return (
                        <tr
                          key={field.id}
                          className="border-b align-top hover:bg-muted/20"
                        >
                          <td className="px-3 py-2 text-muted-foreground text-xs pt-3">
                            {index + 1}
                          </td>

                          <td className="px-3 py-2">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.itemId`}
                              render={({ field: selectField, fieldState }) => (
                                <ItemPicker
                                  items={inStockItems}
                                  selectedItemId={selectField.value || null}
                                  parentSelection={parentByLine[field.id] ?? null}
                                  onParentChange={(pid) =>
                                    pid != null &&
                                    handleParentChange(index, field.id, pid)
                                  }
                                  onVariantChange={(vid) =>
                                    handleVariantChange(index, field.id, vid)
                                  }
                                  testIdPrefix={`select-item-${index}`}
                                  errorMessage={fieldState.error?.message}
                                  disabled={!warehouseIdNum}
                                  disabledMessage="Pick a warehouse first"
                                  emptyMessage="No items in stock"
                                  showStockHint
                                  hideLabel
                                />
                              )}
                            />
                          </td>

                          <td className="px-3 py-2">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.description`}
                              render={({ field: inputField }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      {...inputField}
                                      placeholder="Description"
                                      className="h-9 text-sm"
                                      data-testid={`input-desc-${index}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </td>

                          <td className="px-3 py-2 pt-3">
                            <span className="text-xs text-muted-foreground font-mono">
                              {lineItem?.hsnCode ?? "—"}
                            </span>
                          </td>

                          <td className="px-3 py-2 pt-3">
                            <span className="text-xs text-muted-foreground">
                              {lineItem?.unit ?? "pcs"}
                            </span>
                          </td>

                          <td className="px-3 py-2">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.quantity`}
                              render={({ field: inputField }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      type="text"
                                      inputMode="numeric"
                                      {...inputField}
                                      onChange={(e) =>
                                        handleQtyChange(index, e.target.value)
                                      }
                                      className="h-9 text-sm w-full"
                                      data-testid={`input-qty-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                  {stockViolations[index] && (
                                    <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
                                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                      Max {availableStock ?? 0}
                                    </p>
                                  )}
                                  {!stockViolations[index] &&
                                    availableStock != null && (
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        Avail: {availableStock}
                                      </p>
                                    )}
                                </FormItem>
                              )}
                            />
                          </td>

                          <td className="px-3 py-2">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.unitPrice`}
                              render={({ field: inputField }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      {...inputField}
                                      placeholder="0.00"
                                      className="h-9 text-sm"
                                      data-testid={`input-price-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </td>

                          <td className="px-3 py-2">
                            <div className="relative">
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={watchLines[index].discountPercent || ""}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (!Number.isFinite(v) || v < 0) return;
                                  form.setValue(
                                    `lines.${index}.discountPercent`,
                                    Math.min(100, v),
                                    { shouldValidate: true },
                                  );
                                  form.setValue(`lines.${index}.discountAmount`, 0, {
                                    shouldValidate: true,
                                  });
                                }}
                                className="h-9 text-sm pr-5"
                                placeholder="0"
                                data-testid={`input-discount-${index}`}
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                                %
                              </span>
                            </div>
                          </td>

                          <td className="px-3 py-2">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.taxRate`}
                              render={({ field: inputField }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      {...inputField}
                                      className="h-9 text-sm"
                                      data-testid={`input-tax-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </td>

                          <td className="px-3 py-2 text-right pt-3">
                            <span className="font-medium text-sm">
                              {formatCurrency(lineTotal)}
                            </span>
                          </td>

                          <td className="px-3 py-2 text-right">
                            {fields.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => remove(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summary footer */}
              <div className="px-6 py-4 space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Total quantity:</span>
                  <span className="font-medium text-foreground">{totalQuantity}</span>
                </div>

                <div className="flex flex-col md:flex-row md:justify-end gap-4">
                  <div className="w-full md:w-72 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(taxTotal)}</span>
                    </div>
                    {showOrderDiscount && (
                      <div className="flex items-center justify-between text-sm gap-2">
                        <span className="text-muted-foreground whitespace-nowrap">
                          Order Discount
                        </span>
                        <div className="flex gap-1">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={orderDiscountValue || ""}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isFinite(v) || v < 0) return;
                              const cap =
                                orderDiscountMode === "percent"
                                  ? 100
                                  : subtotal + taxTotal;
                              setOrderDiscountValue(Math.min(cap, v));
                            }}
                            placeholder="0"
                            className="h-7 w-20 text-right text-sm"
                            data-testid="input-order-discount"
                          />
                          <Select
                            value={orderDiscountMode}
                            onValueChange={(v) => {
                              setOrderDiscountMode(v as "percent" | "amount");
                              setOrderDiscountValue(0);
                            }}
                          >
                            <SelectTrigger
                              className="h-7 w-14 px-2 text-sm"
                              data-testid="select-order-discount-mode"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percent">%</SelectItem>
                              <SelectItem value="amount">₹</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between font-bold text-base">
                      <span>Total</span>
                      <span>{formatCurrency(total)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <Label className="text-sm font-medium">
                  Private notes{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (not shown to client)
                  </span>
                </Label>
                <FormControl>
                  <Textarea
                    {...field}
                    className="h-24 mt-1"
                    placeholder="Internal notes..."
                    data-testid="input-notes"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={updateMutation.isPending || hasStockViolations}
              data-testid="btn-save-order"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
            <Button type="button" variant="ghost" asChild>
              <Link href={`/sales-orders/${orderId}`}>Cancel</Link>
            </Button>
          </div>

          {hasStockViolations && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Some items exceed available stock. Adjust quantities before saving.
            </p>
          )}
        </form>
      </Form>
    </div>
  );
}
