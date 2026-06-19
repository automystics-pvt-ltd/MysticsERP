import { PageHeader } from "@/components/PageHeader";
import {
  useGetPurchaseOrder,
  useUpdatePurchaseOrder,
  useListSuppliers,
  useListWarehouses,
  useListItems,
  getGetPurchaseOrderQueryKey,
  getListPurchaseOrdersQueryKey,
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
import { useLocation, useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { Trash2, Plus, ArrowLeft, Building2, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ItemPicker } from "@/components/ItemPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState, useMemo, useRef } from "react";

const orderLineSchema = z.object({
  id: z.number().optional(),
  itemId: z.coerce.number().min(1, "Item required"),
  quantity: z.coerce.number().min(1, "Must be > 0"),
  unitPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  description: z.string().optional(),
});

const purchaseOrderSchema = z.object({
  supplierId: z.coerce.number().min(1, "Supplier is required"),
  warehouseId: z.coerce.number().min(1, "Warehouse is required"),
  orderDate: z.string().min(1, "Date is required"),
  expectedDeliveryDate: z.string().optional().or(z.literal("")),
  notes: z.string().optional(),
  lines: z.array(orderLineSchema).min(1, "At least one item is required"),
});

type PurchaseOrderFormValues = z.infer<typeof purchaseOrderSchema>;

export default function PurchaseOrderEdit() {
  const { id } = useParams();
  const orderId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const prefilledRef = useRef(false);

  const { data: orderDetail, isLoading } = useGetPurchaseOrder(orderId, {
    query: { enabled: !!orderId, queryKey: getGetPurchaseOrderQueryKey(orderId) },
  });

  const { data: org } = useGetCurrentOrganization();
  const { data: suppliers } = useListSuppliers();
  const { data: warehouses } = useListWarehouses();
  const { data: items } = useListItems();
  const [parentByLine, setParentByLine] = useState<Record<string, number>>({});

  const updateMutation = useUpdatePurchaseOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPurchaseOrderQueryKey(orderId) });
        queryClient.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
        toast({ title: "Purchase order updated" });
        setLocation(`/purchase-orders/${orderId}`);
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string }; message?: string };
        toast({
          title: "Could not update order",
          description: e.data?.error ?? e.message ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const form = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      orderDate: "",
      expectedDeliveryDate: "",
      notes: "",
      lines: [
        { itemId: 0, quantity: 1, unitPrice: 0, taxRate: 0, discountPercent: 0, description: "" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  useEffect(() => {
    if (prefilledRef.current || !orderDetail || !suppliers || !warehouses) return;
    const o = orderDetail.order;
    form.reset({
      supplierId: o.supplierId,
      warehouseId: o.warehouseId,
      orderDate: o.orderDate,
      expectedDeliveryDate: o.expectedDeliveryDate ?? "",
      notes: o.notes ?? "",
      lines:
        orderDetail.lines.length > 0
          ? orderDetail.lines.map((l) => ({
              id: l.id,
              itemId: l.itemId,
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
              taxRate: Number(l.taxRate),
              discountPercent: Number((l as any).discountPercent ?? 0),
              description: l.description ?? "",
            }))
          : [{ itemId: 0, quantity: 1, unitPrice: 0, taxRate: 0, discountPercent: 0, description: "" }],
    });
    prefilledRef.current = true;
  }, [orderDetail, suppliers, warehouses, form]);

  const watchSupplierId = form.watch("supplierId");
  const watchLines = form.watch("lines");

  const selectedSupplier = useMemo(
    () => suppliers?.suppliers.find((s) => s.id === Number(watchSupplierId)) ?? null,
    [suppliers, watchSupplierId],
  );

  const taxMode = (org as any)?.taxMode ?? "exclusive";
  const { subtotal, taxTotal } = watchLines.reduce(
    (acc, line) => {
      const gross = line.quantity * line.unitPrice;
      const lineAfterDisc = gross * (1 - (line.discountPercent || 0) / 100);
      if (taxMode === "inclusive") {
        const lineTax =
          line.taxRate > 0
            ? (lineAfterDisc * line.taxRate) / (100 + line.taxRate)
            : 0;
        return {
          subtotal: acc.subtotal + lineAfterDisc - lineTax,
          taxTotal: acc.taxTotal + lineTax,
        };
      }
      return {
        subtotal: acc.subtotal + lineAfterDisc,
        taxTotal: acc.taxTotal + lineAfterDisc * (line.taxRate / 100),
      };
    },
    { subtotal: 0, taxTotal: 0 },
  );
  const total = subtotal + taxTotal;
  const totalQuantity = watchLines.reduce((sum, l) => sum + (l.quantity || 0), 0);

  const applyItemDefaults = (index: number, itemId: number) => {
    const selectedItem = items?.find((i) => i.id === itemId);
    if (selectedItem) {
      form.setValue(`lines.${index}.unitPrice`, selectedItem.purchasePrice ?? 0);
      form.setValue(`lines.${index}.taxRate`, selectedItem.taxRate ?? 0);
      form.setValue(`lines.${index}.description`, selectedItem.description || "");
    }
  };

  const handleParentChange = (index: number, fieldId: string, parentId: number) => {
    const picked = items?.find((i) => i.id === parentId);
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

  const emptyLineDefaults = () => ({
    itemId: 0,
    quantity: 1,
    unitPrice: 0,
    taxRate: 0,
    discountPercent: 0,
    description: "",
  });

  const onSubmit = (data: PurchaseOrderFormValues) => {
    updateMutation.mutate({
      id: orderId,
      data: {
        ...data,
        expectedDeliveryDate: data.expectedDeliveryDate || null,
        notes: data.notes || null,
        lines: data.lines.map((l) => ({ ...l, description: l.description || null })),
      },
    });
  };

  if (isLoading || !orderDetail || !suppliers || !warehouses) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (orderDetail.order.status !== "draft") {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/purchase-orders/${orderId}`}>
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
              and can no longer be edited. Only draft purchase orders can be edited.
            </p>
            <div>
              <Button asChild>
                <Link href={`/purchase-orders/${orderId}`}>Back to order</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/purchase-orders/${orderId}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader title={`Edit ${orderDetail.order.orderNumber}`} className="mb-0" />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-xs font-medium text-muted-foreground">
                        Supplier *
                      </Label>
                      <Select
                        key={field.value ? `s-${field.value}` : "s-empty"}
                        onValueChange={field.onChange}
                        value={field.value ? field.value.toString() : ""}
                      >
                        <FormControl>
                          <SelectTrigger className="mt-1" data-testid="select-supplier">
                            <SelectValue placeholder="Select a supplier" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers?.suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id.toString()}>
                              {s.name}
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
                        Deliver to Warehouse *
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
                  name="expectedDeliveryDate"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-xs font-medium text-muted-foreground">
                        Expected delivery date
                      </Label>
                      <FormControl>
                        <Input
                          type="date"
                          className="mt-1"
                          {...field}
                          data-testid="input-delivery-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {selectedSupplier && (
                <div className="mt-4 border rounded-lg p-4 bg-muted/30 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    Supplier Details
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                    {selectedSupplier.company && (
                      <div>
                        <p className="text-xs text-muted-foreground">Company</p>
                        <p>{selectedSupplier.company}</p>
                      </div>
                    )}
                    {selectedSupplier.phone && (
                      <div>
                        <p className="text-xs text-muted-foreground">Phone</p>
                        <p>{selectedSupplier.phone}</p>
                      </div>
                    )}
                    {selectedSupplier.email && (
                      <div>
                        <p className="text-xs text-muted-foreground">Email</p>
                        <p>{selectedSupplier.email}</p>
                      </div>
                    )}
                    {selectedSupplier.gstNumber && (
                      <div>
                        <p className="text-xs text-muted-foreground">GST Number</p>
                        <p className="font-mono">{selectedSupplier.gstNumber}</p>
                      </div>
                    )}
                    {selectedSupplier.address && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">Address</p>
                        <p className="whitespace-pre-line">{selectedSupplier.address}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 px-0 pb-0">
              <div className="px-6 pb-3 flex items-center justify-between">
                <h3 className="font-semibold text-base">Line Items</h3>
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
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[90px]">
                        HSN/SAC
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
                      const lineItem = items?.find(
                        (i) => i.id === watchLines[index]?.itemId,
                      );
                      const gross =
                        watchLines[index].quantity * watchLines[index].unitPrice;
                      const lineAfterDisc =
                        gross * (1 - (watchLines[index].discountPercent || 0) / 100);
                      const lineTotal =
                        taxMode === "inclusive"
                          ? lineAfterDisc
                          : lineAfterDisc * (1 + watchLines[index].taxRate / 100);

                      return (
                        <tr
                          key={field.id}
                          className="border-b align-middle hover:bg-muted/20"
                        >
                          <td className="px-3 py-2 text-muted-foreground text-xs">
                            {index + 1}
                          </td>

                          <td className="px-3 py-2">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.itemId`}
                              render={({ field: selectField, fieldState }) => (
                                <ItemPicker
                                  items={items ?? []}
                                  selectedItemId={selectField.value || null}
                                  parentSelection={parentByLine[field.id] ?? null}
                                  onParentChange={(pid) =>
                                    pid != null && handleParentChange(index, field.id, pid)
                                  }
                                  onVariantChange={(vid) =>
                                    handleVariantChange(index, field.id, vid)
                                  }
                                  testIdPrefix={`select-item-${index}`}
                                  errorMessage={fieldState.error?.message}
                                  hideLabel
                                />
                              )}
                            />
                          </td>

                          <td className="px-3 py-2">
                            <span className="text-xs text-muted-foreground font-mono">
                              {lineItem?.hsnCode ?? "—"}
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
                                      className="h-9 text-sm w-full"
                                      data-testid={`input-qty-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
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
                            <FormField
                              control={form.control}
                              name={`lines.${index}.discountPercent`}
                              render={({ field: inputField }) => (
                                <FormItem>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        type="text"
                                        inputMode="decimal"
                                        {...inputField}
                                        className="h-9 text-sm pr-5"
                                        placeholder="0"
                                        data-testid={`input-discount-${index}`}
                                      />
                                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                                        %
                                      </span>
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
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

                          <td className="px-3 py-2 text-right">
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

              <div className="px-6 py-4 space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Total quantity:</span>
                  <span className="font-medium text-foreground">{totalQuantity}</span>
                </div>

                <div className="flex flex-col md:flex-row md:justify-end gap-4">
                  <div className="w-full md:w-64 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(taxTotal)}</span>
                    </div>
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

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <Label className="text-sm font-medium">Notes</Label>
                <FormControl>
                  <Textarea
                    {...field}
                    className="h-24 mt-1"
                    placeholder="Add any notes for the supplier here..."
                    data-testid="input-notes"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              data-testid="btn-submit-order"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            <Button type="button" variant="ghost" asChild>
              <Link href={`/purchase-orders/${orderId}`}>Cancel</Link>
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
