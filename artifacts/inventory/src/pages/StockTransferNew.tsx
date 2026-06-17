import { PageHeader } from "@/components/PageHeader";
import {
  useCreateStockTransfer,
  useListWarehouses,
  useListItems,
  getListStockTransfersQueryKey,
  lookupItemByCode,
} from "@/lib/queryKeys";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Trash2, Plus, ScanLine, AlertTriangle, Search, Layers } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ItemPicker } from "@/components/ItemPicker";
import { useEffect, useState, useMemo } from "react";
import { useCanI } from "@/hooks/usePermissions";
import type { Control } from "react-hook-form";
import type { Item } from "@workspace/api-client-react";

const lineSchema = z.object({
  itemId: z.coerce.number().min(1, "Item required"),
  quantity: z.coerce.number().gt(0, "Must be > 0"),
});

const schema = z
  .object({
    fromWarehouseId: z.coerce.number().min(1, "Source warehouse is required"),
    toWarehouseId: z.coerce
      .number()
      .min(1, "Destination warehouse is required"),
    transferDate: z.string().min(1, "Date is required"),
    notes: z.string().optional(),
    lines: z.array(lineSchema).min(1, "At least one item is required"),
  })
  .refine((d) => d.fromWarehouseId !== d.toWarehouseId, {
    message: "Source and destination must be different",
    path: ["toWarehouseId"],
  });

type FormValues = z.infer<typeof schema>;

interface StockWarningProps {
  index: number;
  control: Control<FormValues>;
  items: Item[] | undefined;
}

function LineStockWarning({ index, control, items }: StockWarningProps) {
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const quantity = useWatch({ control, name: `lines.${index}.quantity` });

  if (!itemId || !items) return null;
  const item = items.find((i) => i.id === Number(itemId));
  if (!item || item.stockAtWarehouse == null) return null;

  const qty = Number(quantity);
  const available = Number(item.stockAtWarehouse);
  if (!Number.isFinite(qty) || qty <= available) return null;

  return (
    <p className="text-xs text-destructive flex items-center gap-1 mt-1">
      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
      Only {available} available — reduce quantity to proceed
    </p>
  );
}

export default function StockTransferNew() {
  const [, setLocation] = useLocation();
  const canCreate = useCanI("stock_transfers", "create");
  useEffect(() => {
    if (!canCreate) setLocation("/transfers");
  }, [canCreate, setLocation]);
  const search = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const fromId = Number(new URLSearchParams(search).get("from") || "0");

  const { data: warehouses } = useListWarehouses();
  const fromWarehouseName = warehouses?.find((w) => w.id === fromId)?.name;
  const backHref = fromId > 0 ? `/warehouses/${fromId}?tab=transfers` : "/warehouses";

  const createMutation = useCreateStockTransfer({
    mutation: {
      onSuccess: (detail) => {
        queryClient.invalidateQueries({
          queryKey: getListStockTransfersQueryKey(),
        });
        toast({ title: "Transfer created" });
        setLocation(`/transfers/${detail.transfer.id}`);
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string }; message?: string };
        toast({
          title: "Could not create transfer",
          description: e.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fromWarehouseId: fromId || 0,
      toWarehouseId: 0,
      transferDate: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      lines: [{ itemId: 0, quantity: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const fromWarehouseId = form.watch("fromWarehouseId");

  const { data: items } = useListItems(
    fromWarehouseId ? { warehouseId: Number(fromWarehouseId) } : {},
  );
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const hasStockViolations = useMemo(() => {
    if (!items) return false;
    return (watchedLines ?? []).some((line) => {
      if (!line?.itemId) return false;
      const item = items.find((i) => i.id === Number(line.itemId));
      if (!item || item.stockAtWarehouse == null) return false;
      return Number(line.quantity) > Number(item.stockAtWarehouse);
    });
  }, [watchedLines, items]);
  const [parentByLine, setParentByLine] = useState<Record<string, number>>({});
  const [scannerOpen, setScannerOpen] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkSelections, setBulkSelections] = useState<Record<number, string>>({});

  useEffect(() => {
    const toId = form.getValues("toWarehouseId");
    if (toId && toId === Number(fromWarehouseId)) {
      form.setValue("toWarehouseId", 0);
    }
  }, [fromWarehouseId, form]);

  const bulkLeafItems = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return (items ?? [])
      .filter((i) => !i.hasVariants)
      .filter(
        (i) =>
          !q ||
          i.name.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q),
      );
  }, [items, bulkSearch]);

  const bulkSelectedCount = useMemo(
    () =>
      Object.values(bulkSelections).filter((q) => Number(q) > 0).length,
    [bulkSelections],
  );

  const toggleBulkItem = (itemId: number, checked: boolean) => {
    if (checked) {
      const item = items?.find((i) => i.id === itemId);
      const defaultQty = item?.stockAtWarehouse != null
        ? Math.min(1, Number(item.stockAtWarehouse))
        : 1;
      setBulkSelections((prev) => ({ ...prev, [itemId]: String(defaultQty || 1) }));
    } else {
      setBulkSelections((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  };

  const handleBulkAdd = () => {
    const currentLines = [...form.getValues("lines")];
    const toAppend: { itemId: number; quantity: number }[] = [];

    for (const [itemIdStr, qtyStr] of Object.entries(bulkSelections)) {
      const itemId = Number(itemIdStr);
      const qty = Number(qtyStr);
      if (!itemId || !qty || qty <= 0) continue;

      const existingIdx = currentLines.findIndex((l) => l.itemId === itemId);
      if (existingIdx >= 0) {
        const cur = Number(currentLines[existingIdx].quantity) || 0;
        form.setValue(`lines.${existingIdx}.quantity`, cur + qty, { shouldDirty: true });
        currentLines[existingIdx] = { ...currentLines[existingIdx], quantity: cur + qty };
      } else {
        const blankIdx = currentLines.findIndex((l) => !l.itemId);
        if (blankIdx >= 0) {
          form.setValue(`lines.${blankIdx}.itemId`, itemId, { shouldDirty: true });
          form.setValue(`lines.${blankIdx}.quantity`, qty, { shouldDirty: true });
          currentLines[blankIdx] = { itemId, quantity: qty };
        } else {
          toAppend.push({ itemId, quantity: qty });
          currentLines.push({ itemId, quantity: qty });
        }
      }
    }

    for (const line of toAppend) {
      append(line);
    }

    setBulkOpen(false);
    setBulkSelections({});
    setBulkSearch("");
    toast({ title: `${bulkSelectedCount} item${bulkSelectedCount !== 1 ? "s" : ""} added to transfer` });
  };

  const handleScannedCode = async (code: string) => {
    setScannerOpen(false);
    if (!fromWarehouseId) {
      toast({
        title: "Pick a source warehouse first",
        variant: "destructive",
      });
      return;
    }
    let lookedUp;
    try {
      lookedUp = await lookupItemByCode({ code });
    } catch {
      toast({
        title: "No item found for that code",
        description: `Tried "${code}". Check the barcode is registered on an item.`,
        variant: "destructive",
      });
      return;
    }
    const stockItem = items?.find((i) => i.id === lookedUp.id);
    if (!stockItem) {
      toast({
        title: "Item not in source warehouse",
        description: `${lookedUp.name} (${lookedUp.sku}) has no stock at the picked source.`,
        variant: "destructive",
      });
      return;
    }
    if (stockItem.hasVariants) {
      toast({
        title: "Variant item — pick manually",
        description: `${stockItem.name} has variants; choose the specific one in the line.`,
      });
      return;
    }
    const lines = form.getValues("lines");
    const idx = lines.findIndex((l) => l.itemId === stockItem.id);
    if (idx >= 0) {
      const cur = Number(lines[idx]?.quantity) || 0;
      form.setValue(`lines.${idx}.quantity`, cur + 1, { shouldDirty: true });
    } else {
      const blankIdx = lines.findIndex((l) => !l.itemId);
      if (blankIdx >= 0) {
        form.setValue(`lines.${blankIdx}.itemId`, stockItem.id, {
          shouldDirty: true,
        });
        form.setValue(`lines.${blankIdx}.quantity`, 1, { shouldDirty: true });
      } else {
        append({ itemId: stockItem.id, quantity: 1 });
      }
    }
    toast({ title: `Added ${stockItem.name}` });
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
    }
  };

  const handleVariantChange = (index: number, fieldId: string, variantId: number) => {
    setParentByLine((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    form.setValue(`lines.${index}.itemId`, variantId);
  };

  const onSubmit = (data: FormValues) => {
    createMutation.mutate({
      data: {
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        transferDate: data.transferDate,
        notes: data.notes || null,
        lines: data.lines,
      },
    });
  };

  const breadcrumbs = fromId > 0
    ? [
        { label: "Warehouses", href: "/warehouses" },
        { label: fromWarehouseName ?? "Warehouse", href: `/warehouses/${fromId}?tab=transfers` },
        { label: "New Transfer" },
      ]
    : [{ label: "Stock Transfers", href: "/transfers" }, { label: "New Transfer" }];

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="New Stock Transfer"
        breadcrumbs={breadcrumbs}
        onBack={() => setLocation(backHref)}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="fromWarehouseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From Warehouse *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ? field.value.toString() : ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-from-warehouse">
                            <SelectValue placeholder="Source warehouse" />
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
                  name="toWarehouseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>To Warehouse *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ? field.value.toString() : ""}
                        disabled={!fromWarehouseId}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-to-warehouse">
                            <SelectValue placeholder={fromWarehouseId ? "Destination warehouse" : "Pick source first"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouses
                            ?.filter((w) => w.id !== Number(fromWarehouseId))
                            .map((w) => (
                              <SelectItem key={w.id} value={w.id.toString()}>
                                {w.name}
                              </SelectItem>
                            ))}
                          {fromWarehouseId && warehouses?.filter((w) => w.id !== Number(fromWarehouseId)).length === 0 && (
                            <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                              No other warehouses available
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transferDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Transfer Date *</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          data-testid="input-transfer-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="font-medium text-lg mb-4">Items to transfer</h3>

              <div className="space-y-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex gap-3 items-start border p-4 rounded-lg bg-muted/20 relative"
                  >
                    <div className="grid grid-cols-12 gap-3 w-full">
                      <div className="col-span-12 md:col-span-8">
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
                              disabled={!fromWarehouseId}
                              disabledMessage="Pick a source warehouse first"
                              emptyMessage="No items in stock at the source warehouse"
                              showStockHint
                            />
                          )}
                        />
                      </div>
                      <div className="col-span-12 md:col-span-4">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.quantity`}
                          render={({ field: inputField }) => (
                            <FormItem>
                              <FormLabel className="text-xs">
                                Quantity
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  {...inputField}
                                  data-testid={`input-qty-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <LineStockWarning
                          index={index}
                          control={form.control}
                          items={items}
                        />
                      </div>
                    </div>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive h-9 w-9 mt-6"
                        onClick={() => remove(index)}
                        data-testid={`btn-remove-line-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ itemId: 0, quantity: 1 })}
                  data-testid="btn-add-line"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Line Item
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setBulkSelections({});
                    setBulkSearch("");
                    setBulkOpen(true);
                  }}
                  disabled={!fromWarehouseId}
                  data-testid="btn-bulk-add"
                >
                  <Layers className="mr-2 h-4 w-4" />
                  Bulk Add Items
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScannerOpen(true)}
                  disabled={!fromWarehouseId}
                  data-testid="btn-scan-line"
                >
                  <ScanLine className="mr-2 h-4 w-4" />
                  Scan barcode
                </Button>
              </div>

              <Separator className="my-6" />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        className="h-24"
                        placeholder="Reason for the transfer, courier details, etc."
                        data-testid="input-notes"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => setLocation(backHref)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || hasStockViolations}
              data-testid="btn-submit-transfer"
            >
              {createMutation.isPending ? "Creating..." : "Create transfer"}
            </Button>
          </div>
        </form>
      </Form>

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onDetected={handleScannedCode}
        title="Scan item barcode"
        description="Point your camera at the item's barcode to add it to this transfer."
      />

      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBulkOpen(false);
            setBulkSelections({});
            setBulkSearch("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk Add Items</DialogTitle>
            <DialogDescription>
              Select items to add to this transfer from{" "}
              {warehouses?.find((w) => w.id === Number(fromWarehouseId))?.name ?? "the source warehouse"}.
              Set the quantity for each item you want to include.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8"
              placeholder="Search items by name or SKU…"
              value={bulkSearch}
              onChange={(e) => setBulkSearch(e.target.value)}
              data-testid="input-bulk-search"
            />
          </div>

          <ScrollArea className="h-[360px] rounded-md border">
            {bulkLeafItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {bulkSearch
                  ? "No items match your search."
                  : "No items with stock at the source warehouse."}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <tr className="border-b">
                    <th className="w-8 px-3 py-2 text-left" />
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">SKU</th>
                    <th className="px-3 py-2 text-right font-medium">In stock</th>
                    <th className="px-3 py-2 text-right font-medium w-24">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkLeafItems.map((item) => {
                    const isSelected = item.id in bulkSelections;
                    const stock = item.stockAtWarehouse != null ? Number(item.stockAtWarehouse) : null;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b last:border-0 transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/40"}`}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => toggleBulkItem(item.id, !!checked)}
                            data-testid={`bulk-check-${item.id}`}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium max-w-[200px]">
                          <span className="line-clamp-1">{item.name}</span>
                          {item.variantOptions && Object.keys(item.variantOptions as object).length > 0 && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {Object.entries(item.variantOptions as Record<string, string>)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {item.sku}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {stock != null ? (
                            <Badge
                              variant={stock > 0 ? "secondary" : "outline"}
                              className={stock === 0 ? "text-muted-foreground" : ""}
                            >
                              {stock}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isSelected ? (
                            <Input
                              type="text"
                              inputMode="decimal"
                              className="h-7 w-20 text-right text-sm"
                              value={bulkSelections[item.id] ?? ""}
                              onChange={(e) =>
                                setBulkSelections((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              onClick={(e) => e.currentTarget.select()}
                              data-testid={`bulk-qty-${item.id}`}
                            />
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </ScrollArea>

          {bulkSelectedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {bulkSelectedCount} item{bulkSelectedCount !== 1 ? "s" : ""} selected
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBulkOpen(false);
                setBulkSelections({});
                setBulkSearch("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkAdd}
              disabled={bulkSelectedCount === 0}
              data-testid="btn-bulk-add-confirm"
            >
              Add {bulkSelectedCount > 0 ? `${bulkSelectedCount} item${bulkSelectedCount !== 1 ? "s" : ""}` : "items"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
