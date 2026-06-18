import { useParams, Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import {
  useGetItem,
  useAdjustItemStock,
  useListWarehouses,
  useListStockTransfers,
  useCreateItemVariants,
  useDeleteItemVariant,
  useListItemBatches,
  getGetItemQueryKey,
  getListItemsQueryKey,
  getListStockTransfersQueryKey,
  downloadItemBarcodeLabelsPdf,
  useRegenerateItemBarcode,
  useGetCurrentOrganization,
  useUpdateItem,
} from "@/lib/queryKeys";
import { ItemEditSheet } from "@/components/ItemEditSheet";
import { ImageUploader } from "@/components/ImageUploader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, ArrowRight, Trash2, Printer, RefreshCw, Edit, Pencil, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useImageSrc } from "@/hooks/use-image-src";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo, useEffect } from "react";
import { normalizeRole } from "@/lib/permissions";
import { useGetMe } from "@/lib/queryKeys";
import { useRecordVisit } from "@/lib/recentRecords";
import { Can } from "@/components/Can";

const adjustStockSchema = z.object({
  warehouseId: z.coerce.number().min(1, "Warehouse is required"),
  quantity: z.coerce
    .number()
    .refine((val) => val !== 0, "Quantity cannot be zero"),
  reason: z.enum(["manual_adjustment", "damaged", "lost", "found"]),
  notes: z.string().optional(),
});

type AdjustStockFormValues = z.infer<typeof adjustStockSchema>;

/** Build the cartesian product of axis-value lists. */
/**
 * Renders the large item-detail image. Wraps the `useImageSrc` hook
 * so it can be conditionally placed inside JSX without violating
 * the rules of hooks.
 */
function ItemDetailImage({
  url,
  alt,
}: {
  url: string | null | undefined;
  alt: string;
}) {
  const { src } = useImageSrc(url);
  if (!src) return null;
  return (
    <div className="pb-2">
      <img
        src={src}
        alt={alt}
        className="h-48 w-48 rounded-md border object-cover"
        data-testid="img-item-detail"
      />
    </div>
  );
}

function cartesian(values: string[][]): string[][] {
  if (values.length === 0) return [[]];
  const [head, ...rest] = values;
  const tail = cartesian(rest);
  const out: string[][] = [];
  for (const h of head) for (const t of tail) out.push([h, ...t]);
  return out;
}

function variantLabel(opts: unknown): string {
  if (!opts || typeof opts !== "object") return "";
  return Object.entries(opts as Record<string, unknown>)
    .filter(([k]) => k !== "axes")
    .map(([, v]) => (typeof v === "string" ? v : ""))
    .filter(Boolean)
    .join(" / ");
}

export default function ItemDetail() {
  const { id } = useParams();
  const itemId = parseInt(id || "0", 10);

  const { data: me } = useGetMe();
  const isAdmin =
    (me?.user?.isSuperAdmin ?? false) ||
    (["owner", "admin"] as const).some((r) => r === normalizeRole(me?.role));

  const { data: itemDetail, isLoading } = useGetItem(itemId, {
    query: { enabled: !!itemId, queryKey: getGetItemQueryKey(itemId) },
  });

  useRecordVisit(
    useMemo(
      () =>
        itemDetail?.item
          ? {
              kind: "item" as const,
              id: itemDetail.item.id,
              title: itemDetail.item.name,
              subtitle: `SKU ${itemDetail.item.sku}`,
              href: `/items/${itemDetail.item.id}`,
            }
          : null,
      [itemDetail?.item],
    ),
  );

  const { data: warehouses } = useListWarehouses();
  const { data: orgData } = useGetCurrentOrganization();
  const orgAny = orgData as { skuMode?: string; showMaxDiscountPercent?: boolean; showMaxDiscountAmount?: boolean } | undefined;
  const orgSkuMode = (orgAny?.skuMode === "auto") ? "auto" as const : "manual" as const;
  const showMaxDiscountPercent = orgAny?.showMaxDiscountPercent ?? true;
  const showMaxDiscountAmount = orgAny?.showMaxDiscountAmount ?? true;
  const { data: recentTransfers } = useListStockTransfers(
    { itemId },
    {
      query: {
        enabled: !!itemId && !itemDetail?.item.hasVariants,
        queryKey: getListStockTransfersQueryKey({ itemId }),
      },
    },
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [variantsDialogOpen, setVariantsDialogOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [printDialog, setPrintDialog] = useState<{ open: boolean; itemId: number | null }>({
    open: false,
    itemId: null,
  });
  const [printCopies, setPrintCopies] = useState(1);
  const [printPending, setPrintPending] = useState(false);

  const handlePrintBarcode = (itemId: number) => {
    setPrintCopies(1);
    setPrintDialog({ open: true, itemId });
  };

  const executePrint = async () => {
    if (!printDialog.itemId) return;
    setPrintPending(true);
    try {
      const blob = (await downloadItemBarcodeLabelsPdf({
        ids: String(printDialog.itemId),
        copies: printCopies,
      })) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPrintDialog({ open: false, itemId: null });
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast({
        title: "Could not generate labels",
        description: e.response?.data?.error ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPrintPending(false);
    }
  };

  const adjustMutation = useAdjustItemStock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetItemQueryKey(itemId),
        });
        queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
        setDialogOpen(false);
        form.reset();
        toast({ title: "Stock adjusted successfully" });
      },
    },
  });

  const createVariantsMutation = useCreateItemVariants({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetItemQueryKey(itemId),
        });
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        setVariantsDialogOpen(false);
        toast({ title: "Variants created" });
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({
          variant: "destructive",
          title: "Could not create variants",
          description: e.message ?? "Unknown error",
        });
      },
    },
  });

  const regenerateBarcode = useRegenerateItemBarcode({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetItemQueryKey(itemId),
        });
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        toast({ title: "Barcode regenerated" });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { error?: string } } };
        toast({
          variant: "destructive",
          title: "Could not regenerate barcode",
          description: e.response?.data?.error ?? "Please try again.",
        });
      },
    },
  });

  const deleteVariantMutation = useDeleteItemVariant({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetItemQueryKey(itemId),
        });
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
        toast({ title: "Variant deleted" });
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({
          variant: "destructive",
          title: "Could not delete variant",
          description: e.message ?? "Unknown error",
        });
      },
    },
  });

  const form = useForm<AdjustStockFormValues>({
    resolver: zodResolver(adjustStockSchema),
    defaultValues: {
      quantity: 0,
      reason: "manual_adjustment",
      notes: "",
    },
  });
  const adjustWh = form.watch("warehouseId");
  const adjustQtyRaw = form.watch("quantity");
  const adjustQty = Number(adjustQtyRaw) || 0;
  const adjustCurrentStock = itemDetail?.stockByWarehouse.find((s) => s.warehouseId === adjustWh)?.quantity ?? 0;
  const adjustWouldGoNeg = !!adjustWh && adjustQty < 0 && adjustCurrentStock + adjustQty < -1e-9;

  const onSubmit = (data: AdjustStockFormValues) => {
    adjustMutation.mutate({
      id: itemId,
      data: {
        warehouseId: data.warehouseId,
        quantity: data.quantity,
        reason: data.reason,
        notes: data.notes || null,
      },
    });
  };

  if (isLoading || !itemDetail) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { item, stockByWarehouse, inTransitQty, variants, components } = itemDetail;
  const isParent = !!item.hasVariants;
  const isBundle = !!item.isBundle;
  const axes: string[] = (() => {
    const opts = item.variantOptions as unknown;
    if (opts && typeof opts === "object") {
      const a = (opts as { axes?: unknown }).axes;
      if (Array.isArray(a)) return a.filter((x) => typeof x === "string");
    }
    return [];
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.name}
        description={`SKU: ${item.sku}`}
        backHref="/items"
        breadcrumbs={[{ label: "Items", href: "/items" }, { label: item.name }]}
        actions={
            <div className="flex items-center gap-2 flex-wrap">
              {item.barcodeSource === "auto" ? (
                <Badge
                  variant="secondary"
                  data-testid="badge-barcode-source-auto"
                >
                  Auto barcode
                </Badge>
              ) : item.barcodeSource === "manual" ? (
                <Badge
                  variant="outline"
                  data-testid="badge-barcode-source-manual"
                >
                  Manual barcode
                </Badge>
              ) : null}
              {/*
                Per spec: regenerating an auto barcode invalidates any
                previously printed labels, so we gate the action behind
                a confirmation dialog. Manual barcodes are user-owned —
                the user should clear them on the Edit form rather than
                have the system overwrite them, so we hide the button
                in that state.
              */}
              {isAdmin && item.barcodeSource !== "manual" ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={regenerateBarcode.isPending}
                      data-testid="btn-regenerate-barcode"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {item.barcode ? "Regenerate" : "Generate"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {item.barcode
                          ? "Regenerate barcode?"
                          : "Generate barcode?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {item.barcode ? (
                          <>
                            This will issue a new auto-barcode for{" "}
                            <strong>{item.sku}</strong> and replace the
                            current value{" "}
                            <span className="font-mono">{item.barcode}</span>.
                            Any previously printed labels for this item
                            will no longer scan correctly.
                          </>
                        ) : (
                          <>
                            This will issue a fresh auto-barcode for{" "}
                            <strong>{item.sku}</strong>.
                          </>
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        data-testid="btn-cancel-regenerate-barcode"
                      >
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          regenerateBarcode.mutate({ id: item.id })
                        }
                        data-testid="btn-confirm-regenerate-barcode"
                        disabled={regenerateBarcode.isPending}
                      >
                        {item.barcode ? "Regenerate" : "Generate"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
              <Can module="items" action="edit">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditSheetOpen(true)}
                  data-testid="btn-edit-item"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Item
                </Button>
              </Can>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePrintBarcode(item.id)}
                data-testid="btn-print-barcode"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print barcode
              </Button>
            </div>
          }
        />

      {item.parentItemId && (
        <Card>
          <CardContent className="py-4 flex items-center gap-2">
            <Badge variant="outline">Variant</Badge>
            <span className="text-sm text-muted-foreground">
              This is a variant of{" "}
              <Link
                href={`/items/${item.parentItemId}`}
                className="text-primary hover:underline"
              >
                item #{item.parentItemId}
              </Link>
              {variantLabel(item.variantOptions) && (
                <> — {variantLabel(item.variantOptions)}</>
              )}
            </span>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Item Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ItemDetailImage url={item.imageUrl} alt={item.name} />
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Category
                </p>
                <p>{item.category || "-"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Unit
                </p>
                <p>{item.unit}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Sale Price
                </p>
                <p>
                  {isParent ? (
                    <span className="text-muted-foreground">
                      Per-variant
                    </span>
                  ) : (
                    formatCurrency(item.salePrice)
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  MRP
                </p>
                <p>
                  {isParent ? (
                    <span className="text-muted-foreground">
                      Per-variant
                    </span>
                  ) : (
                    formatCurrency(item.purchasePrice)
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Tax Rate
                </p>
                <p>{item.taxRate}%</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  HSN Code
                </p>
                <p>{item.hsnCode || "-"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Min Stock Level
                </p>
                <p>{(item as unknown as { reorderLevel?: number }).reorderLevel ?? 0}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Max Discount
                </p>
                <p>
                  {(item as unknown as { maxDiscountPercent?: number | null }).maxDiscountPercent != null
                    ? `${(item as unknown as { maxDiscountPercent: number }).maxDiscountPercent}%`
                    : "—"}
                </p>
              </div>
            </div>
            {(() => {
              const i = item as unknown as {
                weight?: number | null;
                weightUnit?: string;
                dimensionLength?: number | null;
                dimensionWidth?: number | null;
                dimensionHeight?: number | null;
                dimensionUnit?: string;
              };
              const hasWeight = i.weight != null;
              const hasDims = i.dimensionLength != null || i.dimensionWidth != null || i.dimensionHeight != null;
              if (!hasWeight && !hasDims) return null;
              return (
                <div className="pt-4 border-t grid grid-cols-2 gap-y-4 gap-x-8">
                  {hasWeight && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Weight</p>
                      <p>{i.weight} {i.weightUnit ?? "g"}</p>
                    </div>
                  )}
                  {hasDims && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Dimensions (L × W × H)</p>
                      <p>
                        {[i.dimensionLength, i.dimensionWidth, i.dimensionHeight]
                          .map((v) => v ?? "—")
                          .join(" × ")}{" "}
                        {i.dimensionUnit ?? "cm"}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
            {item.description && (
              <div className="pt-4 border-t">
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Description
                </p>
                <p className="text-sm">{item.description}</p>
              </div>
            )}
            {isParent && axes.length > 0 && (
              <div className="pt-4 border-t">
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Variant axes
                </p>
                <div className="flex flex-wrap gap-2">
                  {axes.map((a) => (
                    <Badge key={a} variant="outline">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {isParent
                  ? "Variants"
                  : isBundle
                  ? "Bundle Stock"
                  : "Total Stock"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isParent ? (
                <>
                  <div className="text-3xl font-bold">
                    {item.variantCount}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Variant rows
                  </p>
                </>
              ) : (
                <>
                  <div className={`text-3xl font-bold ${item.totalStock < 0 ? "text-destructive" : ""}`}>
                    {item.totalStock} {item.unit}
                  </div>
                  {item.totalStock < 0 && (
                    <p className="text-xs text-destructive font-medium mt-0.5">Negative stock — adjust to correct</p>
                  )}
                  <p className="text-sm text-muted-foreground mt-1">
                    {isBundle
                      ? "Derived from current component stock."
                      : `Min stock level: ${item.reorderLevel}`}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {isBundle && (
        <Card>
          <CardHeader>
            <CardTitle>Components</CardTitle>
            <CardDescription>
              Items consumed when one bundle ships. Stock is derived
              from these components and changes whenever they do.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {components.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This bundle has no components configured.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">
                        Quantity per bundle
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {components.map((c) => (
                      <TableRow
                        key={c.id}
                        data-testid={`row-bundle-component-${c.id}`}
                      >
                        <TableCell className="font-mono text-xs">
                          <Link
                            href={`/items/${c.componentItemId}`}
                            className="text-primary hover:underline"
                            data-testid={`link-bundle-component-${c.id}`}
                          >
                            {c.componentSku}
                          </Link>
                        </TableCell>
                        <TableCell>{c.componentName}</TableCell>
                        <TableCell className="text-right">
                          {c.quantityPerBundle}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {stockByWarehouse.length > 0 && (
              <>
                <h3 className="text-sm font-medium mt-6 mb-2">
                  Assemblable per warehouse
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Warehouse</TableHead>
                        <TableHead className="text-right">
                          Bundles available
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockByWarehouse.map((row) => (
                        <TableRow key={row.warehouseId}>
                          <TableCell>{row.warehouseName}</TableCell>
                          <TableCell className="text-right">
                            {row.quantity} {item.unit}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isParent ? (
        <VariantsCard
          parentName={item.name}
          parentCategory={item.category ?? null}
          axes={axes}
          variants={variants}
          warehouses={warehouses ?? []}
          onAddClick={() => setVariantsDialogOpen(true)}
          onDelete={(variantId) =>
            deleteVariantMutation.mutate({
              parentId: itemId,
              variantId,
            })
          }
          onPrint={handlePrintBarcode}
          dialogOpen={variantsDialogOpen}
          setDialogOpen={setVariantsDialogOpen}
          isCreating={createVariantsMutation.isPending}
          onCreate={(payload) =>
            createVariantsMutation.mutate({ id: itemId, data: payload })
          }
          existingOptionKeys={new Set(
            variants.map((v) =>
              axes
                .map(
                  (a) =>
                    ((v.item.variantOptions as Record<string, unknown> | null)?.[
                      a
                    ] as string) ?? "",
                )
                .join("\u0000"),
            ),
          )}
          existingSkus={new Set(variants.map((v) => v.item.sku))}
          orgSkuMode={orgSkuMode}
          showMaxDiscountPercent={showMaxDiscountPercent}
          showMaxDiscountAmount={showMaxDiscountAmount}
        />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Stock by Warehouse</CardTitle>
              <CardDescription>
                Current inventory levels across all locations.
              </CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="btn-adjust-stock">Adjust Stock</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adjust Stock</DialogTitle>
                  <DialogDescription>
                    Manually increase or decrease inventory for this item.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="warehouseId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Warehouse</FormLabel>
                          <Select
                            onValueChange={(val) =>
                              field.onChange(parseInt(val))
                            }
                            value={field.value?.toString() || ""}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-warehouse">
                                <SelectValue placeholder="Select a warehouse" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {warehouses?.map((w) => (
                                <SelectItem
                                  key={w.id}
                                  value={w.id.toString()}
                                >
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
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Adjustment Quantity (use negative for removal)
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="text"
                              inputMode="numeric"
                              {...field}
                              data-testid="input-adjust-qty"
                            />
                          </FormControl>
                          <FormMessage />
                          {adjustWouldGoNeg && (
                            <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                              Exceeds available stock ({adjustCurrentStock} on hand)
                            </p>
                          )}
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reason</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-reason">
                                <SelectValue placeholder="Select a reason" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="manual_adjustment">
                                Manual Adjustment
                              </SelectItem>
                              <SelectItem value="damaged">Damaged</SelectItem>
                              <SelectItem value="lost">Lost</SelectItem>
                              <SelectItem value="found">Found</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes (Optional)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-adjust-notes"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end pt-4">
                      <Button
                        type="submit"
                        disabled={adjustMutation.isPending || adjustWouldGoNeg}
                        data-testid="btn-submit-adjust"
                      >
                        {adjustMutation.isPending
                          ? "Adjusting..."
                          : "Apply Adjustment"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Sale Price</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockByWarehouse.map((stock) => (
                  <TableRow
                    key={stock.warehouseId}
                    data-testid={`row-stock-wh-${stock.warehouseId}`}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {stock.warehouseName}
                        {stock.isVirtual && (
                          <Badge variant="secondary" className="text-xs font-normal">
                            Job Work
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {stock.isVirtual ? "—" : formatCurrency(item.salePrice)}
                    </TableCell>
                    <TableCell className={`text-right ${stock.quantity < 0 ? "text-destructive font-semibold" : ""}`}>
                      {stock.quantity < 0 && "⚠ "}
                      {stock.quantity}
                    </TableCell>
                  </TableRow>
                ))}
                {(inTransitQty ?? 0) > 0 && (
                  <TableRow className="text-muted-foreground">
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className="italic">In transit</span>
                        <Badge variant="outline" className="text-xs font-normal">
                          Dispatched
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right italic">
                      {inTransitQty}
                    </TableCell>
                  </TableRow>
                )}
                {stockByWarehouse.length === 0 && !(inTransitQty ?? 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center py-4 text-muted-foreground"
                    >
                      No stock available in any warehouse.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!isParent && !isBundle && item.trackBatches && (
        <BatchesCard itemId={itemId} unit={item.unit} />
      )}

      {!isParent && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Transfers</CardTitle>
            <CardDescription>
              Warehouse-to-warehouse transfers that include this item.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead></TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentTransfers ?? []).slice(0, 10).map((tr) => (
                  <TableRow
                    key={tr.id}
                    data-testid={`row-item-transfer-${tr.id}`}
                  >
                    <TableCell className="font-mono">
                      <Link
                        href={`/transfers/${tr.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {tr.transferNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(tr.transferDate)}</TableCell>
                    <TableCell>{tr.fromWarehouseName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <ArrowRight className="h-4 w-4" />
                    </TableCell>
                    <TableCell>{tr.toWarehouseName}</TableCell>
                    <TableCell>
                      <StatusBadge status={tr.status} />
                    </TableCell>
                  </TableRow>
                ))}
                {(!recentTransfers || recentTransfers.length === 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-4 text-muted-foreground"
                    >
                      No transfers involve this item yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ItemEditSheet
        item={item}
        open={editSheetOpen}
        onClose={() => setEditSheetOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getGetItemQueryKey(itemId) });
          queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        }}
      />

      <Dialog
        open={printDialog.open}
        onOpenChange={(open) => !open && setPrintDialog({ open: false, itemId: null })}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Print Barcode Labels</DialogTitle>
            <DialogDescription>
              How many labels would you like to print?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium leading-none">Number of labels</label>
            <Input
              type="number"
              min={1}
              max={200}
              value={printCopies}
              onChange={(e) =>
                setPrintCopies(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))
              }
              data-testid="input-print-copies"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPrintDialog({ open: false, itemId: null })}
            >
              Cancel
            </Button>
            <Button onClick={() => void executePrint()} disabled={printPending} data-testid="btn-confirm-print">
              {printPending
                ? "Generating…"
                : `Print ${printCopies} label${printCopies === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Warehouse = { id: number; name: string };
type VariantStockEntry = {
  item: {
    id: number;
    sku: string;
    name: string;
    barcode: string | null;
    salePrice: number;
    purchasePrice: number;
    totalStock: number;
    unit: string;
    variantOptions: unknown;
    imageUrl: string | null;
    description: string | null;
    reorderLevel: number;
    maxDiscountPercent: number | null;
    maxDiscountAmount: number | null;
    weight: number | null;
    weightUnit: string;
    dimensionLength: number | null;
    dimensionWidth: number | null;
    dimensionHeight: number | null;
    dimensionUnit: string;
  };
  stockByWarehouse: Array<{
    warehouseId: number;
    warehouseName: string;
    quantity: number;
    isVirtual?: boolean;
  }>;
};

interface VariantsCardProps {
  parentName: string;
  parentCategory: string | null;
  axes: string[];
  variants: VariantStockEntry[];
  warehouses: Warehouse[];
  onAddClick: () => void;
  onDelete: (variantId: number) => void;
  onPrint: (itemId: number) => void;
  dialogOpen: boolean;
  setDialogOpen: (b: boolean) => void;
  isCreating: boolean;
  onCreate: (payload: {
    variants: Array<{
      sku: string;
      options: Record<string, string>;
      salePrice: number;
      purchasePrice: number;
      openingStock?: number;
      openingWarehouseId?: number | null;
    }>;
  }) => void;
  existingOptionKeys: Set<string>;
  existingSkus: Set<string>;
  orgSkuMode: "auto" | "manual";
  showMaxDiscountPercent: boolean;
  showMaxDiscountAmount: boolean;
}

const variantEditSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  salePrice: z.coerce.number().min(0),
  purchasePrice: z.coerce.number().min(0),
  barcode: z.string().max(64, "Barcode must be 64 characters or fewer").optional(),
  imageUrl: z.string().nullable().optional(),
  description: z.string().optional(),
  reorderLevel: z.coerce.number().min(0),
  maxDiscountPercent: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(0).max(100).nullable(),
  ),
  maxDiscountAmount: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(0).nullable(),
  ),
  weight: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(0).nullable(),
  ),
  weightUnit: z.string(),
  dimensionLength: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(0).nullable(),
  ),
  dimensionWidth: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(0).nullable(),
  ),
  dimensionHeight: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(0).nullable(),
  ),
  dimensionUnit: z.string(),
});
type VariantEditFormValues = z.infer<typeof variantEditSchema>;

function VariantThumb({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  const { src } = useImageSrc(imageUrl);
  return (
    <div className="h-8 w-8 shrink-0 rounded border bg-muted/40 overflow-hidden flex items-center justify-center">
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="text-[10px] text-muted-foreground font-medium select-none">
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function VariantsCard({
  parentName,
  parentCategory,
  axes,
  variants,
  warehouses,
  onDelete,
  onPrint,
  dialogOpen,
  setDialogOpen,
  isCreating,
  onCreate,
  existingOptionKeys,
  existingSkus,
  orgSkuMode,
  showMaxDiscountPercent,
  showMaxDiscountAmount,
}: VariantsCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingVariant, setEditingVariant] = useState<VariantStockEntry | null>(null);
  const [deletingVariant, setDeletingVariant] = useState<VariantStockEntry | null>(null);
  const [warehouseStocks, setWarehouseStocks] = useState<Record<number, string>>({});

  const editVariantForm = useForm<VariantEditFormValues>({
    resolver: zodResolver(variantEditSchema),
    defaultValues: {
      name: "", sku: "", salePrice: 0, purchasePrice: 0, barcode: "",
      imageUrl: null, description: "", reorderLevel: 0, maxDiscountPercent: null, maxDiscountAmount: null,
      weight: null, weightUnit: "g",
      dimensionLength: null, dimensionWidth: null, dimensionHeight: null, dimensionUnit: "cm",
    },
  });

  useEffect(() => {
    if (editingVariant) {
      editVariantForm.reset({
        name: editingVariant.item.name,
        sku: editingVariant.item.sku,
        salePrice: editingVariant.item.salePrice,
        purchasePrice: editingVariant.item.purchasePrice,
        barcode: editingVariant.item.barcode ?? "",
        imageUrl: editingVariant.item.imageUrl ?? null,
        description: editingVariant.item.description ?? "",
        reorderLevel: editingVariant.item.reorderLevel,
        maxDiscountPercent: editingVariant.item.maxDiscountPercent,
        maxDiscountAmount: editingVariant.item.maxDiscountAmount,
        weight: editingVariant.item.weight,
        weightUnit: editingVariant.item.weightUnit ?? "g",
        dimensionLength: editingVariant.item.dimensionLength,
        dimensionWidth: editingVariant.item.dimensionWidth,
        dimensionHeight: editingVariant.item.dimensionHeight,
        dimensionUnit: editingVariant.item.dimensionUnit ?? "cm",
      });
      // Seed warehouse stock inputs from current stock data
      const initial: Record<number, string> = {};
      for (const w of warehouses) {
        const entry = editingVariant.stockByWarehouse.find((s) => s.warehouseId === w.id);
        initial[w.id] = String(entry?.quantity ?? 0);
      }
      setWarehouseStocks(initial);
    }
  }, [editingVariant?.item.id]);

  const updateVariantMutation = useUpdateItem();
  const adjustVariantStockMutation = useAdjustItemStock();

  const handleVariantSubmit = async (data: VariantEditFormValues) => {
    if (!editingVariant) return;
    try {
      await updateVariantMutation.mutateAsync({
        id: editingVariant.item.id,
        data: {
          name: data.name,
          sku: data.sku,
          salePrice: data.salePrice,
          purchasePrice: data.purchasePrice,
          barcode: data.barcode?.trim() || null,
          imageUrl: data.imageUrl ?? null,
          description: data.description?.trim() || null,
          reorderLevel: data.reorderLevel,
          maxDiscountPercent: data.maxDiscountPercent,
          maxDiscountAmount: data.maxDiscountAmount,
          weight: data.weight,
          weightUnit: data.weightUnit,
          dimensionLength: data.dimensionLength,
          dimensionWidth: data.dimensionWidth,
          dimensionHeight: data.dimensionHeight,
          dimensionUnit: data.dimensionUnit,
        },
      });
      // Apply warehouse stock changes as adjustments
      for (const w of warehouses) {
        const newQty = parseFloat(warehouseStocks[w.id] ?? "0");
        if (!Number.isFinite(newQty) || newQty < 0) continue;
        const originalQty = editingVariant.stockByWarehouse.find((s) => s.warehouseId === w.id)?.quantity ?? 0;
        const delta = newQty - originalQty;
        if (delta === 0) continue;
        await adjustVariantStockMutation.mutateAsync({
          id: editingVariant.item.id,
          data: { warehouseId: w.id, quantity: delta, reason: "manual_adjustment" },
        });
      }
      queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetItemQueryKey(editingVariant.item.id) });
      setEditingVariant(null);
      toast({
        title: "Variant saved",
        description: `${data.name} (${data.sku}) updated successfully.`,
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e.response?.data?.error ?? "An unexpected error occurred. Please try again.";
      toast({
        variant: "destructive",
        title: "Could not save variant",
        description: msg,
      });
    }
  };
  // The "Add variants" dialog is a small wizard: the user provides one
  // comma-separated list of values per axis, plus default prices, and
  // we generate the cartesian product of combinations as the preview
  // table. Combinations that already exist are filtered out.
  const [axisValues, setAxisValues] = useState<Record<string, string>>(
    () => Object.fromEntries(axes.map((a) => [a, ""])),
  );

  // Per-row overrides. Keyed by the combo's null-joined key so a row
  // keeps its user-entered values even as other axis lists change. New
  // combos seed with auto SKU `V-N` and zero price/stock — every value
  // is editable per row in the table below.
  type RowDraft = {
    sku: string;
    salePrice: string;
    purchasePrice: string;
    openingStock: string;
  };
  const [rowDrafts, setRowDrafts] = useState<Record<string, RowDraft>>({});

  // Build the preview: cartesian product of axis values, filtered to
  // remove combinations that already exist on this parent.
  const valuesByAxis = axes.map((a) =>
    (axisValues[a] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const preview = useMemo(() => {
    if (valuesByAxis.some((v) => v.length === 0)) return [];
    const combos = cartesian(valuesByAxis);
    // Auto SKU = first 2 chars of: product name, category, then each
    // axis value (e.g. Color, Size). Stripped to alphanumerics and
    // upper-cased. If two combos collapse to the same base (e.g.
    // "Small/Silver" vs "Smoke/Silk"), or it collides with an
    // existing variant SKU, append "-2", "-3", … to keep them unique.
    const slug2 = (s: string) =>
      s.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 2);
    const usedSkus = new Set<string>(existingSkus);
    return combos
      .map((combo) => {
        const opts: Record<string, string> = {};
        axes.forEach((a, idx) => (opts[a] = combo[idx]!));
        const key = combo.join("\u0000");
        const base =
          [
            slug2(parentName),
            slug2(parentCategory ?? ""),
            ...combo.map(slug2),
          ]
            .filter(Boolean)
            .join("") || "VAR";
        let autoSku = base;
        let n = 2;
        while (usedSkus.has(autoSku)) autoSku = `${base}-${n++}`;
        usedSkus.add(autoSku);
        return { options: opts, combo, key, autoSku };
      })
      .filter((c) => !existingOptionKeys.has(c.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    valuesByAxis.join("|"),
    parentName,
    parentCategory,
    Array.from(existingSkus).sort().join("|"),
  ]);

  // Seed/refresh per-row drafts as combos appear/disappear. Existing
  // rows keep any user edits; new rows pick up the current defaults
  // and the auto-generated SKU.
  useEffect(() => {
    setRowDrafts((prev) => {
      const next: Record<string, RowDraft> = {};
      for (const p of preview) {
        const old = prev[p.key];
        next[p.key] = old
          ? {
              ...old,
              // Keep user's SKU unless they hadn't edited it (still
              // matches the previous auto value) — then refresh from
              // the new auto SKU so prefix changes propagate.
              sku:
                old.sku && old.sku !== "" ? old.sku : p.autoSku,
            }
          : {
              sku: p.autoSku,
              salePrice: "0",
              purchasePrice: "0",
              openingStock: "0",
            };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.map((p) => p.key + "|" + p.autoSku).join(",")]);

  const updateRow = (key: string, patch: Partial<RowDraft>) =>
    setRowDrafts((m) => ({ ...m, [key]: { ...m[key]!, ...patch } }));

  // SKUs that conflict with an existing variant or duplicate within
  // the dialog itself — used to disable submit + tag the offending
  // row visually. In auto-SKU mode the backend assigns the SKU so we
  // skip empty-value and manual-duplicate checks.
  const skuErrors = useMemo(() => {
    if (orgSkuMode === "auto") return {} as Record<string, string>;
    const errs: Record<string, string> = {};
    const seen = new Map<string, string>();
    for (const p of preview) {
      const draft = rowDrafts[p.key];
      const sku = (draft?.sku ?? "").trim();
      if (!sku) {
        errs[p.key] = "SKU is required";
        continue;
      }
      if (existingSkus.has(sku)) {
        errs[p.key] = "SKU already exists on this item";
        continue;
      }
      const dup = seen.get(sku);
      if (dup) {
        errs[p.key] = "Duplicate SKU in this batch";
        errs[dup] = "Duplicate SKU in this batch";
        continue;
      }
      seen.set(sku, p.key);
    }
    return errs;
  }, [preview, rowDrafts, existingSkus, orgSkuMode]);

  const stockErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    for (const p of preview) {
      const draft = rowDrafts[p.key];
      if (!draft) continue;
      const stock = Number(draft.openingStock || "0");
      if (!Number.isFinite(stock) || stock < 0) {
        errs[p.key] = "Stock must be zero or positive";
      }
    }
    return errs;
  }, [preview, rowDrafts]);

  const hasErrors =
    Object.keys(skuErrors).length > 0 || Object.keys(stockErrors).length > 0;

  const handleSubmit = () => {
    if (preview.length === 0 || hasErrors) return;
    onCreate({
      variants: preview.map((p) => {
        const d = rowDrafts[p.key]!;
        const stock = Number(d.openingStock || "0") || 0;
        return {
          // In auto mode the backend generates the SKU; send empty string.
          sku: orgSkuMode === "auto" ? "" : d.sku.trim(),
          options: p.options,
          salePrice: Number(d.salePrice) || 0,
          purchasePrice: Number(d.purchasePrice) || 0,
          ...(stock > 0 ? { openingStock: stock } : {}),
        };
      }),
    });
  };

  const allWarehouseIds = warehouses.map((w) => w.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Variants</CardTitle>
          <CardDescription>
            Each row is its own stockable item. Stock and price live on
            the variant, not the parent.
          </CardDescription>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="btn-add-variants">
              <Plus className="mr-2 h-4 w-4" />
              Add Variants
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto sm:w-full">
            <DialogHeader>
              <DialogTitle>Add Variants to {parentName}</DialogTitle>
              <DialogDescription>
                Enter one or more values per axis (comma separated). We'll
                create one variant per combination. Existing combinations
                are skipped.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {axes.map((a) => (
                <div key={a}>
                  <label className="text-sm font-medium">{a} values</label>
                  <Input
                    value={axisValues[a] ?? ""}
                    onChange={(e) =>
                      setAxisValues((m) => ({ ...m, [a]: e.target.value }))
                    }
                    placeholder={
                      a.toLowerCase() === "color"
                        ? "Red, Blue, Green"
                        : a.toLowerCase() === "size"
                          ? "S, M, L"
                          : `e.g. value1, value2, value3`
                    }
                    data-testid={`input-axis-${a}`}
                  />
                </div>
              ))}
              {preview.length > 0 && (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {axes.map((a) => (
                          <TableHead key={a}>{a}</TableHead>
                        ))}
                        <TableHead className="min-w-[140px]">
                          SKU{orgSkuMode === "auto" && (
                            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                              Auto
                            </span>
                          )}
                        </TableHead>
                        <TableHead className="min-w-[110px] text-right">
                          Sale Price
                        </TableHead>
                        <TableHead className="min-w-[110px] text-right">
                          MRP
                        </TableHead>
                        <TableHead className="min-w-[100px] text-right">
                          Stock
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.map((p) => {
                        const d = rowDrafts[p.key];
                        if (!d) return null;
                        const skuErr = skuErrors[p.key];
                        const stockErr = stockErrors[p.key];
                        return (
                          <TableRow key={p.key}>
                            {axes.map((a) => (
                              <TableCell key={a}>{p.options[a]}</TableCell>
                            ))}
                            <TableCell>
                              {orgSkuMode === "auto" ? (
                                <Input
                                  value=""
                                  readOnly
                                  disabled
                                  placeholder="(Auto)"
                                  className="text-muted-foreground"
                                  data-testid={`input-variant-sku-${p.key}`}
                                />
                              ) : (
                                <>
                                  <Input
                                    value={d.sku}
                                    onChange={(e) =>
                                      updateRow(p.key, { sku: e.target.value })
                                    }
                                    aria-invalid={skuErr ? true : undefined}
                                    className={
                                      skuErr ? "border-destructive" : undefined
                                    }
                                    data-testid={`input-variant-sku-${p.key}`}
                                  />
                                  {skuErr && (
                                    <p className="mt-1 text-xs text-destructive">
                                      {skuErr}
                                    </p>
                                  )}
                                </>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                inputMode="decimal"
                                className="text-right"
                                value={d.salePrice}
                                onChange={(e) =>
                                  updateRow(p.key, {
                                    salePrice: e.target.value,
                                  })
                                }
                                data-testid={`input-variant-sale-${p.key}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                inputMode="decimal"
                                className="text-right"
                                value={d.purchasePrice}
                                onChange={(e) =>
                                  updateRow(p.key, {
                                    purchasePrice: e.target.value,
                                  })
                                }
                                data-testid={`input-variant-purchase-${p.key}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                inputMode="numeric"
                                className="text-right"
                                aria-invalid={stockErr ? true : undefined}
                                value={d.openingStock}
                                onChange={(e) =>
                                  updateRow(p.key, {
                                    openingStock: e.target.value,
                                  })
                                }
                                data-testid={`input-variant-stock-${p.key}`}
                              />
                              {stockErr && (
                                <p className="mt-1 text-xs text-destructive">
                                  {stockErr}
                                </p>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  preview.length === 0 || isCreating || hasErrors
                }
                data-testid="btn-create-variants"
              >
                {isCreating
                  ? "Creating..."
                  : `Create ${preview.length} variant${preview.length === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[48px]" />
              <TableHead>SKU</TableHead>
              {axes.map((a) => (
                <TableHead key={a}>{a}</TableHead>
              ))}
              <TableHead>Barcode</TableHead>
              <TableHead className="text-right">Sale Price</TableHead>
              <TableHead className="text-right">MRP</TableHead>
              <TableHead className="text-right">Total Stock</TableHead>
              {allWarehouseIds.length > 0 && (
                <>
                  {warehouses.map((w) => (
                    <TableHead key={w.id} className="text-right">
                      {w.name}
                    </TableHead>
                  ))}
                </>
              )}
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4 + axes.length + warehouses.length}
                  className="text-center py-6 text-muted-foreground"
                >
                  No variants yet. Click "Add Variants" to create the
                  first combinations.
                </TableCell>
              </TableRow>
            )}
            {variants.map((v) => {
              const opts =
                (v.item.variantOptions as Record<string, unknown> | null) ??
                {};
              const stockByWh = new Map<number, number>();
              for (const s of v.stockByWarehouse) {
                stockByWh.set(s.warehouseId, s.quantity);
              }
              return (
                <TableRow
                  key={v.item.id}
                  data-testid={`row-variant-${v.item.id}`}
                >
                  <TableCell className="py-1">
                    <VariantThumb imageUrl={v.item.imageUrl} name={v.item.name} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/items/${v.item.id}`}
                      className="text-primary hover:underline"
                    >
                      {v.item.sku}
                    </Link>
                  </TableCell>
                  {axes.map((a) => (
                    <TableCell key={a}>
                      {(opts[a] as string) ?? ""}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {v.item.barcode || "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(v.item.salePrice)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {v.item.purchasePrice != null ? formatCurrency(v.item.purchasePrice) : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {v.item.totalStock} {v.item.unit}
                  </TableCell>
                  {warehouses.map((w) => (
                    <TableCell key={w.id} className="text-right">
                      {stockByWh.get(w.id) ?? 0}
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit variant"
                        data-testid={`btn-edit-variant-${v.item.id}`}
                        onClick={() => setEditingVariant(v)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Print barcode label"
                        data-testid={`btn-print-variant-barcode-${v.item.id}`}
                        onClick={() => onPrint(v.item.id)}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setDeletingVariant(v)}
                        data-testid={`btn-delete-variant-${v.item.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      {/* ── Edit Variant Dialog ── */}
      <Dialog open={!!editingVariant} onOpenChange={(open) => !open && setEditingVariant(null)}>
        <DialogContent className="sm:max-w-lg flex flex-col max-h-[92vh] gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle>Edit Variant</DialogTitle>
            <DialogDescription>
              {editingVariant?.item.name}
              {editingVariant?.item.sku ? (
                <span className="ml-1 font-mono text-xs">· {editingVariant.item.sku}</span>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <Form {...editVariantForm}>
            <form
              id="edit-variant-form"
              onSubmit={editVariantForm.handleSubmit((data) => void handleVariantSubmit(data))}
              className="overflow-y-auto flex-1 px-6 py-4 space-y-5"
            >
              {/* Image */}
              <FormField
                control={editVariantForm.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image</FormLabel>
                    <FormControl>
                      <ImageUploader
                        value={field.value}
                        onChange={field.onChange}
                        testId="edit-variant-image"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Name */}
              <FormField
                control={editVariantForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-variant-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={editVariantForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="Optional description…"
                        className="resize-none"
                        data-testid="input-edit-variant-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* SKU + Barcode */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editVariantForm.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SKU</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-variant-sku" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editVariantForm.control}
                  name="barcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Barcode</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Optional" data-testid="input-edit-variant-barcode" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Prices */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editVariantForm.control}
                  name="salePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sale Price (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-edit-variant-sale-price" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editVariantForm.control}
                  name="purchasePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>MRP / Cost (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-edit-variant-purchase-price" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Min Stock */}
              <FormField
                control={editVariantForm.control}
                name="reorderLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Stock Level</FormLabel>
                    <FormControl>
                      <Input type="number" step="1" min="0" {...field} data-testid="input-edit-variant-reorder-level" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Discount Limits */}
              {(showMaxDiscountPercent || showMaxDiscountAmount) && (
                <div className="rounded-md border p-3 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discount Limits</p>
                  <div className="grid grid-cols-2 gap-4">
                    {showMaxDiscountPercent && (
                      <FormField
                        control={editVariantForm.control}
                        name="maxDiscountPercent"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Max Discount %</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                placeholder="No limit"
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                                data-testid="input-edit-variant-max-discount-pct"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {showMaxDiscountAmount && (
                      <FormField
                        control={editVariantForm.control}
                        name="maxDiscountAmount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Max Discount ₹</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="No limit"
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                                data-testid="input-edit-variant-max-discount-amt"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Weight & Unit */}
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shipping</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editVariantForm.control}
                    name="weight"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Weight</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="—"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                            data-testid="input-edit-variant-weight"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editVariantForm.control}
                    name="weightUnit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Weight Unit</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-variant-weight-unit">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="g">g</SelectItem>
                            <SelectItem value="kg">kg</SelectItem>
                            <SelectItem value="lb">lb</SelectItem>
                            <SelectItem value="oz">oz</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Dimensions */}
                <div>
                  <p className="text-sm font-medium mb-2">Dimensions (L × W × H)</p>
                  <div className="grid grid-cols-4 gap-2">
                    <FormField
                      control={editVariantForm.control}
                      name="dimensionLength"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">L</FormLabel>
                          <FormControl>
                            <Input
                              type="number" step="0.01" min="0" placeholder="—"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                              data-testid="input-edit-variant-dim-l"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editVariantForm.control}
                      name="dimensionWidth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">W</FormLabel>
                          <FormControl>
                            <Input
                              type="number" step="0.01" min="0" placeholder="—"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                              data-testid="input-edit-variant-dim-w"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editVariantForm.control}
                      name="dimensionHeight"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">H</FormLabel>
                          <FormControl>
                            <Input
                              type="number" step="0.01" min="0" placeholder="—"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                              data-testid="input-edit-variant-dim-h"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editVariantForm.control}
                      name="dimensionUnit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">Unit</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-variant-dim-unit" className="px-2">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="cm">cm</SelectItem>
                              <SelectItem value="m">m</SelectItem>
                              <SelectItem value="mm">mm</SelectItem>
                              <SelectItem value="in">in</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* Warehouse Stock */}
              {warehouses.length > 0 && (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock by Warehouse</p>
                  {warehouses.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm truncate flex-1">{w.name}</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        className="h-8 w-24 text-right shrink-0"
                        value={warehouseStocks[w.id] ?? "0"}
                        onChange={(e) =>
                          setWarehouseStocks((prev) => ({ ...prev, [w.id]: e.target.value }))
                        }
                        data-testid={`input-edit-variant-stock-${w.id}`}
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-0.5">
                    Changes create a manual stock adjustment entry.
                  </p>
                </div>
              )}
            </form>
          </Form>

          {/* Footer pinned outside scroll area */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0">
            <Button type="button" variant="outline" onClick={() => setEditingVariant(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="edit-variant-form"
              disabled={updateVariantMutation.isPending || adjustVariantStockMutation.isPending}
              data-testid="btn-save-variant"
            >
              {(updateVariantMutation.isPending || adjustVariantStockMutation.isPending) ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Variant Confirmation ── */}
      <AlertDialog open={!!deletingVariant} onOpenChange={(open) => !open && setDeletingVariant(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Variant?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deletingVariant?.item.name}</span>
              {deletingVariant?.item.sku && (
                <span className="ml-1 font-mono text-xs text-muted-foreground">({deletingVariant.item.sku})</span>
              )}
              <br />
              This will permanently remove the variant and all its stock history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingVariant(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingVariant) onDelete(deletingVariant.item.id);
                setDeletingVariant(null);
              }}
              data-testid="btn-confirm-delete-variant"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function BatchesCard({ itemId, unit }: { itemId: number; unit: string }) {
  const { data, isLoading } = useListItemBatches(itemId);
  const onHand = data?.onHand ?? [];
  const batches = data?.batches ?? [];
  const today = useMemo(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, []);

  const expiryStatus = (expiry: string | null) => {
    if (!expiry) return null;
    const exp = new Date(expiry);
    if (Number.isNaN(exp.getTime())) return null;
    const days = Math.floor(
      (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days < 0)
      return { label: `Expired (${-days}d ago)`, variant: "destructive" as const };
    if (days <= 30)
      return { label: `Expires in ${days}d`, variant: "secondary" as const };
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batches</CardTitle>
        <CardDescription>
          Per-batch on-hand quantities, sorted earliest expiry first.
          Receipts capture new batches; shipments and transfers pick from
          this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-2">On hand</h3>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : onHand.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No batches with stock on hand.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch #</TableHead>
                    <TableHead>Mfg date</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {onHand.map((row) => {
                    const status = expiryStatus(row.expiryDate);
                    return (
                      <TableRow
                        key={`${row.itemBatchId}-${row.warehouseId}`}
                        data-testid={`row-batch-onhand-${row.itemBatchId}-${row.warehouseId}`}
                      >
                        <TableCell className="font-mono text-xs">
                          {row.batchNumber}
                        </TableCell>
                        <TableCell>
                          {row.mfgDate ? formatDate(row.mfgDate) : "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {row.expiryDate
                              ? formatDate(row.expiryDate)
                              : "-"}
                            {status && (
                              <Badge variant={status.variant}>
                                {status.label}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>Warehouse #{row.warehouseId}</TableCell>
                        <TableCell className="text-right">
                          {row.quantity} {unit}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2">All batches</h3>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No batches recorded yet. New batches are created when this
              item is received.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch #</TableHead>
                    <TableHead>Mfg date</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow
                      key={b.id}
                      data-testid={`row-batch-${b.id}`}
                    >
                      <TableCell className="font-mono text-xs">
                        {b.batchNumber}
                      </TableCell>
                      <TableCell>
                        {b.mfgDate ? formatDate(b.mfgDate) : "-"}
                      </TableCell>
                      <TableCell>
                        {b.expiryDate ? formatDate(b.expiryDate) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.costPrice != null
                          ? formatCurrency(b.costPrice)
                          : "-"}
                      </TableCell>
                      <TableCell>{formatDate(b.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
