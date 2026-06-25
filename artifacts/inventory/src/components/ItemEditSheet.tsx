import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem as SelectItemUI,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, RefreshCw, Wand2, ScanLine } from "lucide-react";
import { CreatableCombobox } from "@/components/CreatableCombobox";
import { ImageUploader } from "@/components/ImageUploader";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { useToast } from "@/hooks/use-toast";
import {
  useListItems,
  useListWarehouses,
  useCreateItem,
  useUpdateItem,
  useAdjustItemStock,
  getListItemsQueryKey,
  getGetItemQueryKey,
  getItem,
  Item,
  bulkMoveWarehouse,
  useGetCurrentOrganization,
} from "@/lib/queryKeys";
import { customFetch } from "@workspace/api-client-react";

const COMMON_UNITS = [
  "pcs", "box", "pack", "set", "pair", "dozen",
  "kg", "g", "mg", "lb", "l", "ml",
  "m", "cm", "mm", "ft", "in",
  "sqft", "sqm", "roll", "bottle", "can", "bag", "carton", "unit",
];

const componentRowSchema = z.object({
  componentItemId: z.coerce.number().int().min(1),
  quantityPerBundle: z.coerce.number().positive(),
});

const itemEditSchema = z
  .object({
    sku: z.string(),
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    category: z.string().optional(),
    brand: z.string().optional(),
    unit: z.string().min(1, "Unit is required"),
    salePrice: z.coerce.number().min(0),
    purchasePrice: z.coerce.number().min(0),
    hsnCode: z.string().optional(),
    barcode: z.string().max(64, "Barcode must be 64 characters or fewer").optional(),
    taxRate: z.coerce.number().min(0).max(100),
    reorderLevel: z.coerce.number().min(0),
    openingStock: z.coerce.number().min(0).optional(),
    imageUrl: z.string().max(2048).optional().or(z.literal("")),
    hasVariants: z.boolean().default(false),
    axes: z.string().optional(),
    isBundle: z.boolean().default(false),
    components: z.array(componentRowSchema).default([]),
    trackBatches: z.boolean().default(false),
    allowBackorder: z.boolean().default(false),
    maxDiscountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
    weight: z.coerce.number().min(0).optional().nullable(),
    weightUnit: z.string().default("g"),
    dimensionLength: z.coerce.number().min(0).optional().nullable(),
    dimensionWidth: z.coerce.number().min(0).optional().nullable(),
    dimensionHeight: z.coerce.number().min(0).optional().nullable(),
    dimensionUnit: z.string().default("cm"),
    adjustQty: z.coerce.number().optional(),
    adjustWarehouseId: z.coerce.number().optional(),
    adjustReason: z.string().default("manual_adjustment"),
  })
  .refine(
    (v) => {
      if (!v.hasVariants) return true;
      const list = (v.axes ?? "").split(",").map((a) => a.trim()).filter(Boolean);
      return list.length >= 1 && list.length <= 3;
    },
    { path: ["axes"], message: "Provide 1-3 comma-separated axis names (e.g. Size, Color)" }
  )
  .refine((v) => !(v.isBundle && v.hasVariants), {
    path: ["isBundle"],
    message: "An item cannot be both a bundle and a variant parent",
  })
  .refine(
    (v) => {
      if (!v.isBundle) return true;
      if (v.components.length === 0) return false;
      const ids = v.components.map((c) => c.componentItemId);
      return new Set(ids).size === ids.length;
    },
    { path: ["components"], message: "A bundle needs at least one component and component items cannot repeat" }
  )
  .refine(
    (v) =>
      v.salePrice == null || v.purchasePrice == null || v.purchasePrice <= 0 || v.salePrice <= v.purchasePrice,
    { path: ["salePrice"], message: "Sale price must not exceed MRP" }
  );

type ItemEditFormValues = z.infer<typeof itemEditSchema>;

function axesString(opts: Item["variantOptions"]): string {
  if (!opts || typeof opts !== "object") return "";
  const axes = (opts as { axes?: unknown }).axes;
  if (!Array.isArray(axes)) return "";
  return axes.filter((a) => typeof a === "string").join(", ");
}

export interface ItemEditSheetProps {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ItemEditSheet({ item, open, onClose, onSuccess }: ItemEditSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allItems } = useListItems({ includeWarehouseBreakdown: true });
  const { data: warehouseList } = useListWarehouses();
  const { data: org } = useGetCurrentOrganization();

  const visibleWarehouses = useMemo(
    () => (warehouseList ?? []).filter((w) => !w.isVirtual),
    [warehouseList],
  );

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of allItems ?? []) if (i.category) set.add(i.category);
    return Array.from(set);
  }, [allItems]);

  const unitOptions = useMemo(() => {
    const set = new Set<string>(COMMON_UNITS);
    for (const i of allItems ?? []) if (i.unit) set.add(i.unit);
    return Array.from(set);
  }, [allItems]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of allItems ?? []) {
      const brand = (i as { brand?: string | null }).brand;
      if (brand) set.add(brand);
    }
    return Array.from(set);
  }, [allItems]);

  const componentCandidates = useMemo(
    () => (allItems ?? []).filter((i) => !i.hasVariants && !i.isBundle),
    [allItems],
  );

  const orgAny = org as
    | (typeof org & {
        showMaxDiscountAmount?: boolean | null;
        showMaxDiscountPercent?: boolean | null;
        skuMode?: string | null;
        skuPrefix?: string | null;
        skuNextNumber?: number | null;
      })
    | undefined;
  const orgSkuMode = (orgAny?.skuMode ?? "manual") as "auto" | "manual";
  const showMaxDiscountPercent = orgAny?.showMaxDiscountPercent ?? true;
  const showMaxDiscountAmount = orgAny?.showMaxDiscountAmount ?? true;

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [skuRefreshing, setSkuRefreshing] = useState(false);
  const [maxDiscountRsStr, setMaxDiscountRsStr] = useState("");
  const discountChangedByRs = useRef(false);
  const lastAutoBarcodeRef = useRef("");

  const computePreviewSku = () => {
    const prefix = orgAny?.skuPrefix ?? "";
    const seqNum = orgAny?.skuNextNumber ?? 1;
    const paddedNum = String(seqNum).padStart(5, "0");
    return prefix ? `${prefix}-${paddedNum}` : paddedNum;
  };

  const refreshNextSku = async () => {
    setSkuRefreshing(true);
    try {
      const res = await customFetch<{ sku: string | null }>("/api/items/next-sku");
      if (res.sku) {
        form.setValue("sku", res.sku, { shouldValidate: false });
      }
    } finally {
      setSkuRefreshing(false);
    }
  };

  const form = useForm<ItemEditFormValues>({
    resolver: zodResolver(itemEditSchema),
    defaultValues: {
      sku: "",
      name: "",
      description: "",
      category: "",
      brand: "",
      unit: "pcs",
      salePrice: 0,
      purchasePrice: 0,
      hsnCode: "",
      barcode: "",
      taxRate: 0,
      reorderLevel: 0,
      openingStock: 0,
      imageUrl: "",
      hasVariants: false,
      axes: "",
      isBundle: false,
      components: [],
      trackBatches: false,
      allowBackorder: false,
      maxDiscountPercent: null,
      weight: null,
      weightUnit: "g",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionUnit: "cm",
      adjustQty: undefined,
      adjustWarehouseId: undefined,
      adjustReason: "manual_adjustment",
    },
  });

  const watchHasVariants = form.watch("hasVariants");
  const watchIsBundle = form.watch("isBundle");
  const watchSalePrice = form.watch("salePrice");
  const watchMaxDiscountPercent = form.watch("maxDiscountPercent");
  const watchComponents = form.watch("components");
  const watchSku = form.watch("sku");
  const watchCategory = form.watch("category");

  useEffect(() => {
    if (item) return;
    const slug = (s: string) =>
      s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const sku = slug(watchSku ?? "");
    const cat = slug(watchCategory ?? "");
    const generated = (cat ? `${cat}-${sku}` : sku).slice(0, 64);
    const current = form.getValues("barcode") ?? "";
    if (current === "" || current === lastAutoBarcodeRef.current) {
      form.setValue("barcode", generated, { shouldDirty: false, shouldValidate: false });
      lastAutoBarcodeRef.current = generated;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchSku, watchCategory, item]);

  useEffect(() => {
    if (discountChangedByRs.current) {
      discountChangedByRs.current = false;
      return;
    }
    const pct = watchMaxDiscountPercent;
    const price = Number(watchSalePrice);
    if (pct != null && price > 0) {
      setMaxDiscountRsStr(((pct / 100) * price).toFixed(2));
    } else if (pct == null) {
      setMaxDiscountRsStr("");
    }
  }, [watchMaxDiscountPercent, watchSalePrice]);

  useEffect(() => {
    if (!open) return;
    lastAutoBarcodeRef.current = "";
    if (item) {
      const wh =
        item.warehouseStock?.find((w) => w.quantity > 0)?.warehouseId ??
        item.warehouseStock?.[0]?.warehouseId ??
        null;
      setSelectedWarehouseId(wh);
      const itemAny = item as typeof item & {
        brand?: string | null;
        weight?: number | null;
        weightUnit?: string | null;
        dimensionLength?: number | null;
        dimensionWidth?: number | null;
        dimensionHeight?: number | null;
        dimensionUnit?: string | null;
        allowBackorder?: boolean;
        maxDiscountPercent?: number | null;
      };
      setMaxDiscountRsStr(
        itemAny.maxDiscountPercent != null && item.salePrice > 0
          ? ((itemAny.maxDiscountPercent / 100) * item.salePrice).toFixed(2)
          : "",
      );
      form.reset({
        sku: item.sku,
        name: item.name,
        description: item.description || "",
        category: item.category || "",
        brand: itemAny.brand || "",
        unit: item.unit,
        salePrice: item.salePrice,
        purchasePrice: item.purchasePrice,
        hsnCode: item.hsnCode || "",
        barcode: item.barcode || "",
        taxRate: item.taxRate,
        reorderLevel: item.reorderLevel,
        openingStock: 0,
        imageUrl: item.imageUrl ?? "",
        hasVariants: !!item.hasVariants,
        axes: axesString(item.variantOptions),
        isBundle: !!item.isBundle,
        components: [],
        trackBatches: !!item.trackBatches,
        allowBackorder: !!itemAny.allowBackorder,
        maxDiscountPercent: itemAny.maxDiscountPercent ?? null,
        weight: itemAny.weight ?? null,
        weightUnit: itemAny.weightUnit || "g",
        dimensionLength: itemAny.dimensionLength ?? null,
        dimensionWidth: itemAny.dimensionWidth ?? null,
        dimensionHeight: itemAny.dimensionHeight ?? null,
        dimensionUnit: itemAny.dimensionUnit || "cm",
      });
      if (item.isBundle) {
        void (async () => {
          try {
            const detail = await getItem(item.id);
            form.setValue(
              "components",
              (detail.components ?? []).map((c) => ({
                componentItemId: c.componentItemId,
                quantityPerBundle: c.quantityPerBundle,
              })),
            );
          } catch {}
        })();
      }
    } else {
      const def = visibleWarehouses.find((w) => w.isDefault)?.id ?? visibleWarehouses[0]?.id ?? null;
      setSelectedWarehouseId(def);
      setMaxDiscountRsStr("");
      const preview = orgSkuMode === "auto" ? computePreviewSku() : "";
      form.reset({
        sku: preview,
        name: "",
        description: "",
        category: "",
        brand: "",
        unit: "pcs",
        salePrice: 0,
        purchasePrice: 0,
        hsnCode: "",
        barcode: "",
        taxRate: 18,
        reorderLevel: 5,
        openingStock: 0,
        imageUrl: "",
        hasVariants: false,
        axes: "",
        isBundle: false,
        components: [],
        trackBatches: false,
        allowBackorder: false,
        maxDiscountPercent: null,
        weight: null,
        weightUnit: "g",
        dimensionLength: null,
        dimensionWidth: null,
        dimensionHeight: null,
        dimensionUnit: "cm",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, open]);

  const createMutation = useCreateItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        onClose();
        onSuccess?.();
        toast({ title: "Item created successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          variant: "destructive",
          title: "Could not create item",
          description: e.response?.data?.error ?? "Unknown error",
        });
      },
    },
  });

  const updateMutation = useUpdateItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        if (item) queryClient.invalidateQueries({ queryKey: getGetItemQueryKey(item.id) });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          variant: "destructive",
          title: "Could not update item",
          description: e.response?.data?.error ?? "Unknown error",
        });
      },
    },
  });

  const adjustMutation = useAdjustItemStock();

  const onSubmit = async (data: ItemEditFormValues) => {
    if (!item && orgSkuMode !== "auto" && !data.sku.trim()) {
      form.setError("sku", { message: "SKU is required" });
      return;
    }
    const axesList = (data.axes ?? "").split(",").map((a) => a.trim()).filter(Boolean);
    const variantOptions = data.hasVariants ? { axes: axesList } : null;
    const componentsPayload = data.isBundle
      ? data.components.map((c) => ({ componentItemId: c.componentItemId, quantityPerBundle: c.quantityPerBundle }))
      : [];

    if (item) {
      const currentWh =
        item.warehouseStock?.find((w) => w.quantity > 0)?.warehouseId ??
        item.warehouseStock?.[0]?.warehouseId ?? null;
      if (selectedWarehouseId && selectedWarehouseId !== currentWh) {
        try {
          await bulkMoveWarehouse({ ids: [item.id], warehouseId: selectedWarehouseId });
        } catch (err) {
          toast({
            variant: "destructive",
            title: "Failed to update warehouse",
            description: err instanceof Error ? err.message : "Unknown error",
          });
          return;
        }
      }
      const wantsVariants = !!data.hasVariants;
      const hadVariants = !!item.hasVariants;
      const wantsBundle = !!data.isBundle;
      const wasBundle = !!item.isBundle;
      const wantsTrackBatches = !!data.trackBatches;
      const wasTrackBatches = !!item.trackBatches;
      try {
        await updateMutation.mutateAsync({
          id: item.id,
          data: {
            sku: data.sku,
            name: data.name,
            description: data.description || null,
            category: data.category || null,
            brand: data.brand || null,
            unit: data.unit,
            salePrice: data.salePrice,
            purchasePrice: data.purchasePrice,
            hsnCode: data.hsnCode || null,
            barcode: data.barcode?.trim() ? data.barcode.trim() : null,
            taxRate: data.taxRate,
            reorderLevel: data.reorderLevel,
            imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
            ...(wantsVariants !== hadVariants ? { hasVariants: wantsVariants } : {}),
            ...(wantsVariants ? { variantOptions } : {}),
            ...(wantsBundle !== wasBundle ? { isBundle: wantsBundle } : {}),
            ...(wantsBundle ? { components: componentsPayload } : {}),
            ...(wantsTrackBatches !== wasTrackBatches ? { trackBatches: wantsTrackBatches } : {}),
            allowBackorder: !!data.allowBackorder,
            maxDiscountPercent: data.maxDiscountPercent ?? null,
            weight: data.weight ?? null,
            weightUnit: data.weightUnit || "g",
            dimensionLength: data.dimensionLength ?? null,
            dimensionWidth: data.dimensionWidth ?? null,
            dimensionHeight: data.dimensionHeight ?? null,
            dimensionUnit: data.dimensionUnit || "cm",
          },
        });
        const shouldAdjust =
          !item.isBundle &&
          !item.hasVariants &&
          data.adjustQty != null &&
          data.adjustQty !== 0 &&
          data.adjustWarehouseId;
        if (shouldAdjust) {
          try {
            await adjustMutation.mutateAsync({
              id: item.id,
              data: {
                warehouseId: data.adjustWarehouseId!,
                quantity: data.adjustQty!,
                reason: data.adjustReason || "manual_adjustment",
              },
            });
            queryClient.invalidateQueries({ queryKey: getGetItemQueryKey(item.id) });
          } catch (adjErr) {
            const e = adjErr as { response?: { data?: { error?: string } } };
            toast({
              variant: "destructive",
              title: "Item saved but stock update failed",
              description: e.response?.data?.error ?? "Unknown error",
            });
            onClose();
            onSuccess?.();
            return;
          }
        }
        onClose();
        onSuccess?.();
        toast({ title: "Item updated successfully" });
      } catch {
        return;
      }
    } else {
      createMutation.mutate({
        data: {
          sku: orgSkuMode === "auto" ? "" : data.sku,
          name: data.name,
          description: data.description || null,
          category: data.category || null,
          brand: data.brand || null,
          unit: data.unit,
          salePrice: data.salePrice,
          purchasePrice: data.purchasePrice,
          hsnCode: data.hsnCode || null,
          barcode: data.barcode?.trim() ? data.barcode.trim() : null,
          taxRate: data.taxRate,
          reorderLevel: data.reorderLevel,
          imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
          openingStock: data.hasVariants || data.isBundle ? 0 : data.openingStock || 0,
          openingWarehouseId: !data.hasVariants && !data.isBundle && selectedWarehouseId ? selectedWarehouseId : undefined,
          hasVariants: data.hasVariants,
          variantOptions,
          ...(data.isBundle ? { isBundle: true, components: componentsPayload } : {}),
          ...(data.trackBatches ? { trackBatches: true } : {}),
          ...(data.allowBackorder ? { allowBackorder: true } : {}),
          maxDiscountPercent: data.maxDiscountPercent ?? null,
          weight: data.weight ?? null,
          weightUnit: data.weightUnit || "g",
          dimensionLength: data.dimensionLength ?? null,
          dimensionWidth: data.dimensionWidth ?? null,
          dimensionHeight: data.dimensionHeight ?? null,
          dimensionUnit: data.dimensionUnit || "cm",
        },
      });
    }
  };

  const isVariant = !!(item && item.parentItemId);
  const hasChildren = !!(item && (item.variantCount ?? 0) > 0);
  const lockHasVariants = !!item && (isVariant || hasChildren);
  const lockAxes = !!item && hasChildren;
  const isVariantParentLock = !!(item && item.hasVariants);
  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{item ? "Edit Item" : "Add New Item"}</SheetTitle>
            <SheetDescription>
              {item ? "Update item details and settings." : "Add a new item to your inventory."}
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, () => {
                const firstError = document.querySelector("[aria-invalid='true'], .border-destructive");
                firstError?.scrollIntoView({ behavior: "smooth", block: "center" });
              })}
              className="space-y-4 mt-6"
            >
              <FormField
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product image</FormLabel>
                    <FormControl>
                      <ImageUploader value={field.value ?? ""} onChange={(next) => field.onChange(next ?? "")} testId="item-image" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!item?.parentItemId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Warehouse</label>
                  <Select value={selectedWarehouseId ? String(selectedWarehouseId) : ""} onValueChange={(v) => setSelectedWarehouseId(v ? Number(v) : null)}>
                    <SelectTrigger data-testid="select-item-warehouse">
                      <SelectValue placeholder="Select warehouse…" />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleWarehouses.map((w) => (
                        <SelectItemUI key={w.id} value={String(w.id)}>
                          {w.name}
                          {w.isDefault && <span className="ml-1 text-xs text-muted-foreground">(default)</span>}
                        </SelectItemUI>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        SKU *
                        {!item && orgSkuMode === "auto" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary leading-none">
                            <Wand2 className="h-2.5 w-2.5" />
                            Auto
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        {!item && orgSkuMode === "auto" ? (
                          <div className="flex gap-1.5">
                            <Input {...field} readOnly className="bg-muted text-muted-foreground font-mono" placeholder="Generating…" data-testid="input-item-sku" />
                            <button
                              type="button"
                              onClick={() => void refreshNextSku()}
                              disabled={skuRefreshing}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                            >
                              <RefreshCw className={`h-4 w-4 ${skuRefreshing ? "animate-spin" : ""}`} />
                            </button>
                          </div>
                        ) : (
                          <Input {...field} data-testid="input-item-sku" />
                        )}
                      </FormControl>
                      {!item && orgSkuMode === "auto" && (
                        <p className="text-xs text-muted-foreground">Assigned automatically on save.</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-item-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-item-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <CreatableCombobox
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          options={categoryOptions}
                          placeholder="Select or add category…"
                          searchPlaceholder="Search or add a category…"
                          emptyMessage="No categories yet."
                          testId="input-item-category"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit *</FormLabel>
                      <FormControl>
                        <CreatableCombobox
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          options={unitOptions}
                          placeholder="Select or add unit…"
                          searchPlaceholder="Search or add a unit…"
                          emptyMessage="No units found."
                          testId="input-item-unit"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl>
                      <CreatableCombobox
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={brandOptions}
                        placeholder="Select or add brand…"
                        searchPlaceholder="Search or add a brand…"
                        emptyMessage="No brands yet."
                        testId="input-item-brand"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="salePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sale Price (₹) *</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-item-saleprice" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="purchasePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>MRP (₹) *</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-item-purchaseprice" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="taxRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GST Rate (%) *</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-item-taxrate" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hsnCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>HSN Code</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-item-hsncode" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Barcode</FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input {...field} placeholder="Scan or type the product barcode" data-testid="input-item-barcode" />
                        <Button type="button" variant="outline" size="icon" onClick={() => setScannerOpen(true)} aria-label="Scan barcode">
                          <ScanLine className="h-4 w-4" />
                        </Button>
                      </div>
                    </FormControl>
                    <FormDescription>Optional. The scanner matches the barcode first, then the SKU.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="reorderLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Stock Level *</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-item-reorderlevel" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {!item && !watchHasVariants && (
                  <FormField
                    control={form.control}
                    name="openingStock"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opening Stock</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} data-testid="input-item-openingstock" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {item && !item.isBundle && !item.hasVariants && (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm font-medium">Update Stock</p>
                  {item.warehouseStock && item.warehouseStock.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {item.warehouseStock.map((ws) => (
                        <span key={ws.warehouseId} className="rounded bg-muted px-2 py-0.5">
                          {ws.warehouseName ?? `Warehouse ${ws.warehouseId}`}: {ws.quantity}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="adjustQty"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Adjustment Qty</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="+10 or -5"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                              data-testid="input-item-adjust-qty"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="adjustWarehouseId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Warehouse</FormLabel>
                          <Select
                            value={field.value?.toString() ?? ""}
                            onValueChange={(v) => field.onChange(v ? Number(v) : undefined)}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select warehouse" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {visibleWarehouses.map((w) => (
                                <SelectItemUI key={w.id} value={w.id.toString()}>
                                  {w.name}
                                </SelectItemUI>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="adjustReason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reason</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItemUI value="manual_adjustment">Manual Adjustment</SelectItemUI>
                            <SelectItemUI value="damaged">Damaged</SelectItemUI>
                            <SelectItemUI value="lost">Lost</SelectItemUI>
                            <SelectItemUI value="found">Found</SelectItemUI>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className="space-y-3">
                <p className="text-sm font-medium">Weight &amp; Dimensions</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="weight"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Weight</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              type="number" min={0} step="0.001" placeholder="e.g. 250"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                              className="flex-1"
                            />
                            <FormField
                              control={form.control}
                              name="weightUnit"
                              render={({ field: uf }) => (
                                <Select value={uf.value} onValueChange={uf.onChange}>
                                  <SelectTrigger className="w-20">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItemUI value="g">g</SelectItemUI>
                                    <SelectItemUI value="kg">kg</SelectItemUI>
                                    <SelectItemUI value="lb">lb</SelectItemUI>
                                    <SelectItemUI value="oz">oz</SelectItemUI>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium leading-none">Dimensions (L × W × H)</label>
                  <div className="flex gap-2 items-center">
                    <FormField
                      control={form.control}
                      name="dimensionLength"
                      render={({ field }) => (
                        <Input type="number" min={0} step="0.01" placeholder="L"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          className="flex-1"
                        />
                      )}
                    />
                    <span className="text-muted-foreground">×</span>
                    <FormField
                      control={form.control}
                      name="dimensionWidth"
                      render={({ field }) => (
                        <Input type="number" min={0} step="0.01" placeholder="W"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          className="flex-1"
                        />
                      )}
                    />
                    <span className="text-muted-foreground">×</span>
                    <FormField
                      control={form.control}
                      name="dimensionHeight"
                      render={({ field }) => (
                        <Input type="number" min={0} step="0.01" placeholder="H"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          className="flex-1"
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dimensionUnit"
                      render={({ field: uf }) => (
                        <Select value={uf.value} onValueChange={uf.onChange}>
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItemUI value="cm">cm</SelectItemUI>
                            <SelectItemUI value="in">in</SelectItemUI>
                            <SelectItemUI value="mm">mm</SelectItemUI>
                            <SelectItemUI value="m">m</SelectItemUI>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>
              </div>

              {(showMaxDiscountPercent || showMaxDiscountAmount) && (
                <div className="grid grid-cols-2 gap-4">
                  {showMaxDiscountPercent && (
                    <FormField
                      control={form.control}
                      name="maxDiscountPercent"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max Discount %</FormLabel>
                          <FormControl>
                            <Input
                              type="number" min={0} max={100} step="0.01" placeholder="No limit"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {showMaxDiscountAmount && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none">Max Discount (₹)</label>
                      <Input
                        type="number" min={0} step="0.01" placeholder="No limit"
                        value={maxDiscountRsStr}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setMaxDiscountRsStr(raw);
                          discountChangedByRs.current = true;
                          if (raw === "") {
                            form.setValue("maxDiscountPercent", null, { shouldValidate: true });
                          } else {
                            const price = Number(watchSalePrice);
                            const rs = Number(raw);
                            if (price > 0) {
                              const pct = Math.min(100, (rs / price) * 100);
                              form.setValue("maxDiscountPercent", parseFloat(pct.toFixed(4)), { shouldValidate: true });
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="border-t pt-4 space-y-3">
                <FormField
                  control={form.control}
                  name="hasVariants"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} disabled={lockHasVariants} data-testid="checkbox-has-variants" />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>This item has variants</FormLabel>
                        <FormDescription>
                          Variants are size/colour combinations under this item.
                          {isVariant ? " This item is a variant itself." : hasChildren ? " Delete existing variants first to disable." : ""}
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                {watchHasVariants && (
                  <FormField
                    control={form.control}
                    name="axes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Variant axes</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Size, Color" disabled={lockAxes} data-testid="input-item-axes" />
                        </FormControl>
                        <FormDescription>Comma-separated list of 1-3 axis names.{lockAxes ? " Locked once variants exist." : ""}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {watchIsBundle && (
                <div className="border-t pt-4 space-y-3">
                  <FormField
                    control={form.control}
                    name="components"
                    render={() => (
                      <FormItem>
                        <FormLabel>Components</FormLabel>
                        <FormDescription>Pick the items consumed when one bundle ships.</FormDescription>
                        <div className="space-y-2 mt-2">
                          {watchComponents.map((row, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <select
                                className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
                                value={row.componentItemId || ""}
                                onChange={(e) => {
                                  const next = [...watchComponents];
                                  next[idx] = { ...next[idx], componentItemId: Number(e.target.value) };
                                  form.setValue("components", next, { shouldValidate: true });
                                }}
                              >
                                <option value="">Choose item…</option>
                                {componentCandidates.map((c) => (
                                  <option key={c.id} value={c.id}
                                    disabled={item?.id === c.id || watchComponents.some((o, j) => j !== idx && o.componentItemId === c.id)}
                                  >
                                    {c.sku} — {c.name}
                                  </option>
                                ))}
                              </select>
                              <Input
                                type="number" step="0.01" min="0" className="w-24"
                                value={row.quantityPerBundle}
                                onChange={(e) => {
                                  const next = [...watchComponents];
                                  next[idx] = { ...next[idx], quantityPerBundle: Number(e.target.value) };
                                  form.setValue("components", next, { shouldValidate: true });
                                }}
                              />
                              <Button type="button" variant="ghost" size="icon"
                                onClick={() => form.setValue("components", watchComponents.filter((_, j) => j !== idx), { shouldValidate: true })}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          <Button type="button" variant="outline" size="sm"
                            onClick={() => form.setValue("components", [...watchComponents, { componentItemId: 0, quantityPerBundle: 1 }], { shouldValidate: true })}>
                            <Plus className="mr-1 h-3 w-3" />
                            Add component
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className="pt-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="btn-save-item"
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Item"}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={(o) => setScannerOpen(o)}
        onDetected={(code) => {
          form.setValue("barcode", code, { shouldValidate: true });
          setScannerOpen(false);
        }}
      />
    </>
  );
}
