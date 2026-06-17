import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { STALE_LIST, STALE_DETAIL } from "@/lib/queryClient";
import { useParams, useLocation, useSearch, Link } from "wouter";
import { format } from "date-fns";
import {
  useListWarehouses,
  useUpdateWarehouse,
  useListStockMovements,
  useListStockTransfers,
  useListItems,
  useCreateStockTransfer,
  useGetShopifyConnection,
  getListWarehousesQueryKey,
  getListStockTransfersQueryKey,
  getListStockMovementsQueryKey,
  fetchWarehouseStockSummaries,
  fetchWarehouseStock,
  adjustItemStock,
  type Warehouse,
  type WarehouseStockSummary,
  type WarehouseStockItem,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { TablePagination } from "@/components/TablePagination";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Edit,
  Package,
  Boxes,
  TrendingUp,
  TrendingDown,
  ArrowRightLeft,
  AlertTriangle,
  History,
  Plus,
  Star,
  Store,
  MapPin,
  Search,
  X,
  CalendarRange,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectedItem {
  itemId: number;
  itemName: string;
  itemSku: string | null;
  availableQty: number;
  transferQty: number;
  isBundle: boolean;
  hasVariants: boolean;
}

interface WriteOffRow {
  itemId: number;
  itemName: string;
  itemSku: string | null;
  availableQty: number;
  writeOffQty: number;
  reason: "damage" | "expired" | "lost" | "theft";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STOCK_PAGE_SIZE = 25;
const MOVEMENTS_PAGE_SIZE = 30;
const TRANSFERS_PAGE_SIZE = 20;

const REASON_LABELS: Record<string, string> = {
  damage: "Damage",
  expired: "Expired",
  lost: "Lost",
  theft: "Theft",
};

const MOVEMENT_LABELS: Record<string, string> = {
  opening: "Opening Stock",
  adjustment: "Adjustment",
  sale: "Sale",
  purchase: "Purchase",
  transfer_in: "Transfer In",
  transfer_out: "Transfer Out",
  transfer_cancelled: "Transfer Cancelled",
  sales_return: "Sales Return",
  purchase_return: "Purchase Return",
  shipment_cancelled: "Shipment Cancelled",
  goods_receipt_cancelled: "GRN Cancelled",
  job_work_issue: "Job Work Issue",
  job_work_receipt: "Job Work Receipt",
  job_work_receipt_cancel: "Job Work Receipt Cancel",
  job_work_scrap: "Job Work Scrap",
  shopify_order: "Shopify Order",
  shopify_sync: "Shopify Sync",
  shopify_webhook: "Shopify Update",
  damage: "Damage Write-off",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function warehouseInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function warehouseHue(code: string): string {
  const hues = [
    "bg-blue-100 text-blue-700",
    "bg-violet-100 text-violet-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-700",
  ];
  let n = 0;
  for (let i = 0; i < code.length; i++) n += code.charCodeAt(i);
  return hues[n % hues.length]!;
}

function formatAddress(w: Warehouse): string {
  return [w.addressLine1, w.city, w.state, w.country].filter(Boolean).join(", ");
}

function movementIsInbound(type: string, quantity: number): boolean {
  const inTypes = [
    "purchase", "transfer_in", "opening", "sales_return",
    "shipment_cancelled", "goods_receipt_cancelled", "transfer_cancelled", "job_work_receipt",
  ];
  if (inTypes.includes(type)) return true;
  if (type === "adjustment") return quantity >= 0;
  return false;
}

function transferStatusColor(status: string) {
  if (status === "completed") return "text-emerald-700 border-emerald-200 bg-emerald-50";
  if (status === "in_transit") return "text-blue-700 border-blue-200 bg-blue-50";
  if (status === "cancelled") return "text-muted-foreground bg-muted/40";
  return "text-amber-700 border-amber-200 bg-amber-50"; // draft
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  colorClass,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  loading?: boolean;
  colorClass?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-start gap-3">
      <div className={cn("rounded-md p-2 shrink-0", colorClass ?? "bg-muted")}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        {loading ? (
          <Skeleton className="h-5 w-12 mt-1" />
        ) : (
          <p className="text-lg font-semibold leading-tight mt-0.5">{value}</p>
        )}
      </div>
    </div>
  );
}

// ─── EditWarehouseDialog ──────────────────────────────────────────────────────

const editWarehouseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  isDefault: z.boolean().default(false),
});
type EditWarehouseFormValues = z.infer<typeof editWarehouseSchema>;

function EditWarehouseDialog({
  warehouse,
  open,
  onOpenChange,
}: {
  warehouse: Warehouse;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<EditWarehouseFormValues>({
    resolver: zodResolver(editWarehouseSchema),
    defaultValues: {
      name: warehouse.name,
      code: warehouse.code,
      addressLine1: warehouse.addressLine1 || "",
      city: warehouse.city || "",
      state: warehouse.state || "",
      country: warehouse.country || "",
      isDefault: warehouse.isDefault,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: warehouse.name,
        code: warehouse.code,
        addressLine1: warehouse.addressLine1 || "",
        city: warehouse.city || "",
        state: warehouse.state || "",
        country: warehouse.country || "",
        isDefault: warehouse.isDefault,
      });
    }
  }, [open, warehouse, form]);

  const updateMutation = useUpdateWarehouse({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWarehousesQueryKey() });
        toast({ title: "Warehouse updated" });
        onOpenChange(false);
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to update";
        toast({ title: "Update failed", description: msg, variant: "destructive" });
      },
    },
  });

  const onSubmit = (data: EditWarehouseFormValues) => {
    updateMutation.mutate({
      id: warehouse.id,
      data: {
        name: data.name,
        code: data.code,
        addressLine1: data.addressLine1 || null,
        city: data.city || null,
        state: data.state || null,
        country: data.country || null,
        isDefault: data.isDefault,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Warehouse</DialogTitle>
          <DialogDescription>Update warehouse details.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code *</FormLabel>
                    <FormControl><Input {...field} className="font-mono" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isDefault"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 pt-6">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0 cursor-pointer font-normal">Set as default</FormLabel>
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="addressLine1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="state" render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="country" render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── BulkWriteOffDialog ───────────────────────────────────────────────────────

function BulkWriteOffDialog({
  warehouseId,
  warehouseName,
  initialItems,
  open,
  onOpenChange,
  onDone,
}: {
  warehouseId: number;
  warehouseName: string;
  initialItems: Map<number, SelectedItem>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [rows, setRows] = useState<WriteOffRow[]>([]);
  const [globalReason, setGlobalReason] = useState("damage");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setRows(
        Array.from(initialItems.values()).map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName,
          itemSku: item.itemSku,
          availableQty: item.availableQty,
          writeOffQty: 0,
          reason: "damage" as const,
        })),
      );
      setGlobalReason("damage");
      setNotes("");
    }
  }, [open, initialItems]);

  const updateRow = (itemId: number, patch: Partial<WriteOffRow>) =>
    setRows((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)));

  const removeRow = (itemId: number) =>
    setRows((prev) => prev.filter((r) => r.itemId !== itemId));

  const applyGlobalReason = () =>
    setRows((prev) =>
      prev.map((r) => ({ ...r, reason: globalReason as WriteOffRow["reason"] })),
    );

  const hasError = rows.some(
    (r) => !r.writeOffQty || r.writeOffQty <= 0 || r.writeOffQty > r.availableQty,
  );
  const isValid = rows.length > 0 && !hasError;

  const bulkMutation = useMutation({
    mutationFn: async () => {
      return Promise.allSettled(
        rows.map((r) =>
          adjustItemStock(r.itemId, {
            warehouseId,
            quantity: -r.writeOffQty,
            reason: r.reason,
            notes: notes.trim() || null,
          }),
        ),
      );
    },
    onSuccess: (results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.length - failed;
      if (failed === 0) {
        toast({
          title: "Write-offs recorded",
          description: `${succeeded} item${succeeded !== 1 ? "s" : ""} adjusted successfully.`,
        });
      } else {
        const failedItems = rows
          .filter((_, i) => results[i]?.status === "rejected")
          .map((r) => r.itemName)
          .join(", ");
        toast({
          title: `Partial success — ${succeeded}/${rows.length} recorded`,
          description: `Could not adjust: ${failedItems}`,
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
      queryClient.invalidateQueries({
        queryKey: getListStockMovementsQueryKey({ warehouseId }),
      });
      queryClient.invalidateQueries({ queryKey: ["warehouse-stock", warehouseId] });
      queryClient.invalidateQueries({ queryKey: ["items-paginated"] });
      queryClient.invalidateQueries({ queryKey: ["items-facets"] });
      onOpenChange(false);
      onDone();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to record write-offs";
      toast({ title: "Failed", description: msg, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Bulk Stock Write-off
          </DialogTitle>
          <DialogDescription>
            Reduce stock in <span className="font-medium">{warehouseName}</span> for selected
            items. Each item's quantity will be decremented.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {/* Global reason */}
          <div className="flex items-end gap-3 rounded-md bg-muted/50 p-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Apply reason to all items</Label>
              <Select value={globalReason} onValueChange={setGlobalReason}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="damage">Damage</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                  <SelectItem value="theft">Theft</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={applyGlobalReason}>
              Apply to all
            </Button>
          </div>

          {/* Per-item table */}
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right w-28">Available</TableHead>
                  <TableHead className="text-right w-36">Write-off Qty *</TableHead>
                  <TableHead className="w-36">Reason *</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const qtyError =
                    !row.writeOffQty ||
                    row.writeOffQty <= 0 ||
                    row.writeOffQty > row.availableQty;
                  return (
                    <TableRow key={row.itemId}>
                      <TableCell>
                        <p className="font-medium text-sm leading-tight">{row.itemName}</p>
                        {row.itemSku && (
                          <p className="text-xs font-mono text-muted-foreground">{row.itemSku}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {row.availableQty.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-end gap-1">
                          <Input
                            type="number"
                            className={cn(
                              "w-28 text-right h-8 text-sm",
                              qtyError && row.writeOffQty > 0 && "border-destructive",
                            )}
                            value={row.writeOffQty || ""}
                            min="0.01"
                            step="0.01"
                            max={row.availableQty}
                            placeholder="0"
                            onChange={(e) =>
                              updateRow(row.itemId, { writeOffQty: Number(e.target.value) })
                            }
                          />
                          {qtyError && row.writeOffQty > 0 && (
                            <p className="text-xs text-destructive whitespace-nowrap">
                              Max: {row.availableQty.toLocaleString()}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.reason}
                          onValueChange={(v) =>
                            updateRow(row.itemId, { reason: v as WriteOffRow["reason"] })
                          }
                        >
                          <SelectTrigger className="h-8 text-sm w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="damage">Damage</SelectItem>
                            <SelectItem value="expired">Expired</SelectItem>
                            <SelectItem value="lost">Lost</SelectItem>
                            <SelectItem value="theft">Theft</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(row.itemId)}
                          title="Remove"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-20 text-center text-sm text-muted-foreground">
                      All items removed. Close and reselect.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Notes (optional — applies to all items)</Label>
            <Textarea
              placeholder="Reason, batch details, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="mt-4 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => bulkMutation.mutate()}
            disabled={!isValid || bulkMutation.isPending}
          >
            {bulkMutation.isPending
              ? "Recording…"
              : `Write off ${rows.length} item${rows.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── BulkTransferDialog ───────────────────────────────────────────────────────

function BulkTransferDialog({
  fromWarehouseId,
  fromWarehouseName,
  initialItems,
  open,
  onOpenChange,
  onCreated,
}: {
  fromWarehouseId: number;
  fromWarehouseName: string;
  initialItems: Map<number, SelectedItem>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (transferId: number) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: warehouses } = useListWarehouses();

  const [items, setItems] = useState<Map<number, SelectedItem>>(new Map());
  const [destWarehouseId, setDestWarehouseId] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setItems(new Map(initialItems));
      setDestWarehouseId("");
      setTransferDate(format(new Date(), "yyyy-MM-dd"));
      setNotes("");
    }
  }, [open, initialItems]);

  const updateQty = (itemId: number, qty: number) => {
    setItems((prev) => {
      const next = new Map(prev);
      const item = next.get(itemId);
      if (item) next.set(itemId, { ...item, transferQty: qty });
      return next;
    });
  };

  const removeItem = (itemId: number) => {
    setItems((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  };

  const destId = Number(destWarehouseId);
  const hasInvalidQty = Array.from(items.values()).some(
    (item) =>
      !item.transferQty ||
      item.transferQty <= 0 ||
      item.transferQty > item.availableQty,
  );
  const sameDest = destId > 0 && destId === fromWarehouseId;
  const bundleItemsList = Array.from(items.values()).filter((i) => i.isBundle);
  const parentItemsList = Array.from(items.values()).filter((i) => i.hasVariants);
  const hasInvalidItems = bundleItemsList.length > 0 || parentItemsList.length > 0;
  const isValid =
    destId > 0 && !sameDest && items.size > 0 && !hasInvalidQty && !hasInvalidItems && !!transferDate;

  const createMutation = useCreateStockTransfer({
    mutation: {
      onSuccess: (detail) => {
        queryClient.invalidateQueries({ queryKey: getListStockTransfersQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
        toast({ title: "Transfer created", description: `Draft ${detail.transfer.transferNumber} created.` });
        onOpenChange(false);
        onCreated(detail.transfer.id);
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

  const handleSubmit = () => {
    if (!isValid) return;
    createMutation.mutate({
      data: {
        fromWarehouseId,
        toWarehouseId: destId,
        transferDate,
        notes: notes.trim() || null,
        lines: Array.from(items.values()).map((item) => ({
          itemId: item.itemId,
          quantity: item.transferQty,
        })),
      },
    });
  };

  const destOptions = (warehouses ?? []).filter((w) => w.id !== fromWarehouseId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Transfer Stock from {fromWarehouseName}
          </DialogTitle>
          <DialogDescription>
            Select a destination and review quantities. Transfers start as drafts — dispatch
            from the transfer detail page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto flex-1 pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-dest-warehouse">To Warehouse *</Label>
              <Select value={destWarehouseId} onValueChange={setDestWarehouseId}>
                <SelectTrigger id="bulk-dest-warehouse">
                  <SelectValue placeholder="Select destination…" />
                </SelectTrigger>
                <SelectContent>
                  {destOptions.map((w) => (
                    <SelectItem key={w.id} value={w.id.toString()}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sameDest && (
                <p className="text-xs text-destructive">Cannot transfer to the same warehouse</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-transfer-date">Transfer Date *</Label>
              <Input
                id="bulk-transfer-date"
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
              />
            </div>
          </div>

          {hasInvalidItems && (
            <div className="flex gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <div className="space-y-1">
                {parentItemsList.length > 0 && (
                  <p>
                    <span className="font-medium">Parent items cannot be transferred</span> — pick a specific variant instead. Remove: {parentItemsList.map((i) => i.itemSku ?? i.itemName).join(", ")}
                  </p>
                )}
                {bundleItemsList.length > 0 && (
                  <p>
                    <span className="font-medium">Bundle items cannot be transferred</span> — transfer their components individually. Remove: {bundleItemsList.map((i) => i.itemSku ?? i.itemName).join(", ")}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right w-28">Available</TableHead>
                  <TableHead className="text-right w-36">Transfer Qty *</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(items.values()).map((item) => {
                  const qtyError =
                    !item.transferQty ||
                    item.transferQty <= 0 ||
                    item.transferQty > item.availableQty;
                  const itemInvalid = item.isBundle || item.hasVariants;
                  return (
                    <TableRow key={item.itemId} className={itemInvalid ? "bg-amber-50/60" : undefined}>
                      <TableCell>
                        <p className="font-medium text-sm">{item.itemName}</p>
                        {item.itemSku && (
                          <p className="text-xs font-mono text-muted-foreground">{item.itemSku}</p>
                        )}
                        {item.hasVariants && (
                          <Badge variant="outline" className="mt-1 text-xs border-amber-300 text-amber-700 bg-amber-50">Parent item</Badge>
                        )}
                        {item.isBundle && (
                          <Badge variant="outline" className="mt-1 text-xs border-amber-300 text-amber-700 bg-amber-50">Bundle</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {item.availableQty.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-end gap-1">
                          <Input
                            type="number"
                            className={cn(
                              "w-28 text-right h-8 text-sm",
                              qtyError &&
                                item.transferQty > 0 &&
                                "border-destructive focus-visible:ring-destructive",
                            )}
                            value={item.transferQty || ""}
                            min="0.01"
                            step="0.01"
                            max={item.availableQty}
                            onChange={(e) =>
                              updateQty(item.itemId, Number(e.target.value))
                            }
                          />
                          {qtyError && item.transferQty > 0 && (
                            <p className="text-xs text-destructive whitespace-nowrap">
                              Max: {item.availableQty.toLocaleString()}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeItem(item.itemId)}
                          title="Remove"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {items.size === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      All items removed. Close and reselect.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-notes">Notes (optional)</Label>
            <Textarea
              id="bulk-notes"
              placeholder="Reason, courier details, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="mt-4 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || createMutation.isPending}>
            {createMutation.isPending
              ? "Creating…"
              : `Create Transfer (${items.size} item${items.size !== 1 ? "s" : ""})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WarehouseDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const _qs = useSearch();

  // ── URL-state bootstrap ───────────────────────────────────────────────────────
  const hasMounted = useRef(false);
  const [tab, setTab] = useState(() => new URLSearchParams(_qs).get("tab") ?? "stock");

  const saveScrollPos = useCallback(() => {
    sessionStorage.setItem(`scroll:${window.location.href}`, String(window.scrollY));
  }, []);

  useEffect(() => {
    const key = `scroll:${window.location.href}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      sessionStorage.removeItem(key);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          window.scrollTo({ top: Number(saved), behavior: "instant" as ScrollBehavior }),
        ),
      );
    }
  }, []);

  // ── Warehouse data ───────────────────────────────────────────────────────────
  const { data: warehouses, isLoading: warehouseLoading } = useListWarehouses();
  const warehouse = useMemo(
    () => warehouses?.find((w) => w.id === id),
    [warehouses, id],
  );

  const { data: stockSummaries, isLoading: summaryLoading } = useQuery<WarehouseStockSummary[]>({
    queryKey: ["warehouses", "stock-summaries"],
    queryFn: fetchWarehouseStockSummaries,
    staleTime: STALE_DETAIL,
    enabled: !!warehouse,
  });
  const summary = useMemo(
    () => stockSummaries?.find((s) => s.warehouseId === id),
    [stockSummaries, id],
  );

  // ── Stock tab ────────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState(() => new URLSearchParams(_qs).get("s") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => new URLSearchParams(_qs).get("s") ?? "");
  const [stockCategory, setStockCategory] = useState(() => new URLSearchParams(_qs).get("c") ?? "");
  const [stockPage, setStockPage] = useState(() => Number(new URLSearchParams(_qs).get("sp") ?? "1"));
  const [stockPageSize, setStockPageSize] = useState(() => Number(new URLSearchParams(_qs).get("sps") ?? String(STOCK_PAGE_SIZE)));

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!hasMounted.current) return;
    setStockPage(1);
  }, [debouncedSearch, stockCategory]);

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["warehouse-stock", id, debouncedSearch, stockCategory, stockPage, stockPageSize],
    queryFn: () =>
      fetchWarehouseStock(id, {
        search: debouncedSearch,
        category: stockCategory,
        page: stockPage,
        pageSize: stockPageSize,
      }),
    enabled: !!id && !Number.isNaN(id),
    staleTime: STALE_LIST,
  });

  // ── Movements tab ────────────────────────────────────────────────────────────
  const [mvmtSearch, setMvmtSearch] = useState(() => new URLSearchParams(_qs).get("ms") ?? "");
  const [mvmtType, setMvmtType] = useState(() => new URLSearchParams(_qs).get("mt") ?? "");
  const [mvmtFromDate, setMvmtFromDate] = useState(() => new URLSearchParams(_qs).get("mfd") ?? "");
  const [mvmtToDate, setMvmtToDate] = useState(() => new URLSearchParams(_qs).get("mtd") ?? "");
  const [movementsPage, setMovementsPage] = useState(() => Number(new URLSearchParams(_qs).get("mp") ?? "1"));
  const [movementsPageSize, setMovementsPageSize] = useState(() => Number(new URLSearchParams(_qs).get("mps") ?? String(MOVEMENTS_PAGE_SIZE)));

  const { data: allMovements, isLoading: movementsLoading } = useListStockMovements({
    warehouseId: id,
  });

  const filteredMovements = useMemo(() => {
    const all = allMovements ?? [];
    const search = mvmtSearch.trim().toLowerCase();
    return all.filter((m) => {
      if (search && !m.itemName.toLowerCase().includes(search) &&
        !(m.itemSku ?? "").toLowerCase().includes(search)) return false;
      if (mvmtType && m.movementType !== mvmtType) return false;
      if (mvmtFromDate && m.createdAt.slice(0, 10) < mvmtFromDate) return false;
      if (mvmtToDate && m.createdAt.slice(0, 10) > mvmtToDate) return false;
      return true;
    });
  }, [allMovements, mvmtSearch, mvmtType, mvmtFromDate, mvmtToDate]);

  useEffect(() => {
    if (!hasMounted.current) return;
    setMovementsPage(1);
  }, [mvmtSearch, mvmtType, mvmtFromDate, mvmtToDate]);

  const pagedMovements = useMemo(() => {
    const start = (movementsPage - 1) * movementsPageSize;
    return filteredMovements.slice(start, start + movementsPageSize);
  }, [filteredMovements, movementsPage, movementsPageSize]);

  const movementTypes = useMemo(() => {
    const types = new Set((allMovements ?? []).map((m) => m.movementType));
    return [...types].sort();
  }, [allMovements]);

  const mvmtFiltersActive = !!(mvmtSearch || mvmtType || mvmtFromDate || mvmtToDate);

  // ── Transfers tab ────────────────────────────────────────────────────────────
  const [tfrStatus, setTfrStatus] = useState(() => new URLSearchParams(_qs).get("ts") ?? "");
  const [tfrDirection, setTfrDirection] = useState(() => new URLSearchParams(_qs).get("td") ?? "");
  const [tfrFromDate, setTfrFromDate] = useState(() => new URLSearchParams(_qs).get("tfd") ?? "");
  const [tfrToDate, setTfrToDate] = useState(() => new URLSearchParams(_qs).get("ttd") ?? "");
  const [transfersPage, setTransfersPage] = useState(() => Number(new URLSearchParams(_qs).get("tp") ?? "1"));
  const [transfersPageSize, setTransfersPageSize] = useState(() => Number(new URLSearchParams(_qs).get("tps") ?? String(TRANSFERS_PAGE_SIZE)));

  const { data: allTransfers, isLoading: transfersLoading } = useListStockTransfers({
    warehouseId: id,
  });

  const filteredTransfers = useMemo(() => {
    const all = allTransfers ?? [];
    return all.filter((t) => {
      if (tfrStatus && t.status !== tfrStatus) return false;
      if (tfrDirection === "in" && t.toWarehouseId !== id) return false;
      if (tfrDirection === "out" && t.fromWarehouseId !== id) return false;
      if (tfrFromDate && t.transferDate.slice(0, 10) < tfrFromDate) return false;
      if (tfrToDate && t.transferDate.slice(0, 10) > tfrToDate) return false;
      return true;
    });
  }, [allTransfers, tfrStatus, tfrDirection, tfrFromDate, tfrToDate, id]);

  useEffect(() => {
    if (!hasMounted.current) return;
    setTransfersPage(1);
  }, [tfrStatus, tfrDirection, tfrFromDate, tfrToDate]);

  const pagedTransfers = useMemo(() => {
    const start = (transfersPage - 1) * transfersPageSize;
    return filteredTransfers.slice(start, start + transfersPageSize);
  }, [filteredTransfers, transfersPage, transfersPageSize]);

  const tfrFiltersActive = !!(tfrStatus || tfrDirection || tfrFromDate || tfrToDate);

  // ── URL sync (replaceState keeps URL current so back-nav restores all state) ──
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "stock") p.set("tab", tab);
    if (searchInput) p.set("s", searchInput);
    if (stockCategory) p.set("c", stockCategory);
    if (stockPage > 1) p.set("sp", String(stockPage));
    if (stockPageSize !== STOCK_PAGE_SIZE) p.set("sps", String(stockPageSize));
    if (mvmtSearch) p.set("ms", mvmtSearch);
    if (mvmtType) p.set("mt", mvmtType);
    if (mvmtFromDate) p.set("mfd", mvmtFromDate);
    if (mvmtToDate) p.set("mtd", mvmtToDate);
    if (movementsPage > 1) p.set("mp", String(movementsPage));
    if (movementsPageSize !== MOVEMENTS_PAGE_SIZE) p.set("mps", String(movementsPageSize));
    if (tfrStatus) p.set("ts", tfrStatus);
    if (tfrDirection) p.set("td", tfrDirection);
    if (tfrFromDate) p.set("tfd", tfrFromDate);
    if (tfrToDate) p.set("ttd", tfrToDate);
    if (transfersPage > 1) p.set("tp", String(transfersPage));
    if (transfersPageSize !== TRANSFERS_PAGE_SIZE) p.set("tps", String(transfersPageSize));
    const qs = p.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [tab, searchInput, stockCategory, stockPage, stockPageSize, mvmtSearch, mvmtType, mvmtFromDate, mvmtToDate, movementsPage, movementsPageSize, tfrStatus, tfrDirection, tfrFromDate, tfrToDate, transfersPage, transfersPageSize]);

  // Must be declared after all page-reset effects so hasMounted is false during their first run
  useEffect(() => { hasMounted.current = true; }, []);

  // ── Selection ────────────────────────────────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState<Map<number, SelectedItem>>(new Map());

  const handleToggleItem = (item: WarehouseStockItem) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      if (next.has(item.itemId)) {
        next.delete(item.itemId);
      } else {
        next.set(item.itemId, {
          itemId: item.itemId,
          itemName: item.itemName,
          itemSku: item.itemSku,
          availableQty: Number(item.availableQty),
          transferQty: Number(item.availableQty),
          isBundle: item.isBundle,
          hasVariants: item.hasVariants,
        });
      }
      return next;
    });
  };

  const handleSelectPage = (checked: boolean) => {
    if (!stockData?.items) return;
    setSelectedItems((prev) => {
      const next = new Map(prev);
      for (const item of stockData.items) {
        if (checked) {
          if (!next.has(item.itemId)) {
            next.set(item.itemId, {
              itemId: item.itemId,
              itemName: item.itemName,
              itemSku: item.itemSku,
              availableQty: Number(item.availableQty),
              transferQty: Number(item.availableQty),
              isBundle: item.isBundle,
              hasVariants: item.hasVariants,
            });
          }
        } else {
          next.delete(item.itemId);
        }
      }
      return next;
    });
  };

  const pageItemIds = stockData?.items.map((i) => i.itemId) ?? [];
  const pageSelected = pageItemIds.filter((iid) => selectedItems.has(iid)).length;
  const pageAllSelected = pageItemIds.length > 0 && pageSelected === pageItemIds.length;
  const pageIndeterminate = pageSelected > 0 && !pageAllSelected;

  // ── Shopify ──────────────────────────────────────────────────────────────────
  const { data: connection } = useGetShopifyConnection();
  const shopifyConnected = !!connection?.connected;

  // ── Dialogs ──────────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [bulkWriteOffOpen, setBulkWriteOffOpen] = useState(false);
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [quickWriteOffOpen, setQuickWriteOffOpen] = useState(false);

  // ── Loading / not found ──────────────────────────────────────────────────────
  if (warehouseLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!warehouse) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
        <Boxes className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">Warehouse not found</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/warehouses">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Warehouses
          </Link>
        </Button>
      </div>
    );
  }

  const hue = warehouseHue(warehouse.code);
  const address = formatAddress(warehouse);

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" asChild>
          <Link href="/warehouses" data-testid="btn-back-warehouses">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3">
            <div
              className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center text-sm font-bold ${hue}`}
            >
              {warehouseInitials(warehouse.name)}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold leading-tight text-page-title">
                {warehouse.name}
              </h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground">{warehouse.code}</span>
                {warehouse.isDefault && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <Star className="h-3 w-3" />Default
                  </Badge>
                )}
                {shopifyConnected && warehouse.shopifyLocationName && (
                  <Badge variant="outline" className="gap-1 text-xs font-normal">
                    <Store className="h-3 w-3" />{warehouse.shopifyLocationName}
                  </Badge>
                )}
              </div>
              {address && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{address}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
          className="shrink-0"
          data-testid="btn-edit-warehouse"
        >
          <Edit className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Available Units"
          value={summary ? summary.totalUnits.toLocaleString() : "0"}
          icon={Boxes}
          loading={summaryLoading}
          colorClass="bg-emerald-100 text-emerald-700"
        />
        <StatCard
          label="Item SKUs"
          value={summary ? summary.totalItems.toLocaleString() : "0"}
          icon={Package}
          loading={summaryLoading}
          colorClass="bg-blue-100 text-blue-700"
        />
        <StatCard
          label="Pending Inbound"
          value={summary ? summary.pendingInUnits.toLocaleString() : "0"}
          icon={TrendingUp}
          loading={summaryLoading}
          colorClass="bg-violet-100 text-violet-700"
        />
        <StatCard
          label="Pending Outbound"
          value={summary ? summary.pendingOutUnits.toLocaleString() : "0"}
          icon={TrendingDown}
          loading={summaryLoading}
          colorClass="bg-amber-100 text-amber-700"
        />
      </div>

      {/* ── Selection action bar ────────────────────────────────────────────── */}
      {selectedItems.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
          <span className="text-sm font-medium">
            {selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground h-7"
            onClick={() => setSelectedItems(new Map())}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-amber-700 border-amber-200 hover:bg-amber-50 h-8"
              onClick={() => setBulkWriteOffOpen(true)}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Write off
            </Button>
            <Button
              size="sm"
              className="gap-2 h-8"
              onClick={() => setBulkTransferOpen(true)}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Transfer
            </Button>
          </div>
        </div>
      )}


      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stock" className="gap-1.5">
            <Boxes className="h-4 w-4" />
            Stock
            {stockData && stockData.total > 0 && (
              <Badge variant="secondary" className="text-xs ml-1 h-4 px-1.5">
                {stockData.total}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="movements" className="gap-1.5">
            <History className="h-4 w-4" />
            Movements
            {filteredMovements.length > 0 && (
              <Badge variant="secondary" className="text-xs ml-1 h-4 px-1.5">
                {filteredMovements.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5">
            <ArrowRightLeft className="h-4 w-4" />
            Transfers
            {filteredTransfers.length > 0 && (
              <Badge variant="secondary" className="text-xs ml-1 h-4 px-1.5">
                {filteredTransfers.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Stock ─────────────────────────────────────────────────────────── */}
        <TabsContent value="stock" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search item or SKU…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
              {searchInput && (
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchInput("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {stockData && stockData.categories.length > 0 && (
              <Select
                value={stockCategory || "__all__"}
                onValueChange={(v) => setStockCategory(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories</SelectItem>
                  {stockData.categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(debouncedSearch || stockCategory) && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 h-8 text-muted-foreground"
                onClick={() => { setSearchInput(""); setStockCategory(""); }}
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
          </div>

          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-4">
                    <Checkbox
                      checked={
                        pageAllSelected ? true : pageIndeterminate ? "indeterminate" : false
                      }
                      onCheckedChange={(v) => handleSelectPage(!!v)}
                      aria-label="Select all on page"
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden md:table-cell">SKU</TableHead>
                  <TableHead className="hidden lg:table-cell">Category</TableHead>
                  <TableHead className="text-right pr-4">Available Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : !stockData || stockData.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-36 text-center text-muted-foreground text-sm"
                    >
                      {debouncedSearch || stockCategory
                        ? "No items match your filters."
                        : "No stock in this warehouse yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  stockData.items.map((item) => {
                    const selected = selectedItems.has(item.itemId);
                    const availableNum = Number(item.availableQty);
                    const reorderLvl = item.reorderLevel != null ? Number(item.reorderLevel) : 0;
                    const lowStock = availableNum <= 0 || (reorderLvl > 0 && availableNum <= reorderLvl);
                    return (
                      <TableRow
                        key={item.itemId}
                        className={cn(
                          "cursor-pointer select-none transition-colors",
                          selected
                            ? "bg-primary/5 hover:bg-primary/5"
                            : "hover:bg-muted/40",
                        )}
                        onClick={() => handleToggleItem(item)}
                      >
                        <TableCell
                          className="pl-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => handleToggleItem(item)}
                            aria-label={`Select ${item.itemName}`}
                          />
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm leading-tight">{item.itemName}</p>
                          {item.itemSku && (
                            <p className="text-xs font-mono text-muted-foreground md:hidden mt-0.5">
                              {item.itemSku}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs font-mono text-muted-foreground">
                          {item.itemSku ?? <span className="italic">—</span>}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {item.category ? (
                            <Badge variant="outline" className="text-xs font-normal">
                              {item.category}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <span
                            className={cn(
                              "font-mono font-semibold text-sm",
                              lowStock
                                ? "text-amber-600"
                                : availableNum <= 0
                                  ? "text-muted-foreground"
                                  : "text-foreground",
                            )}
                          >
                            {availableNum.toLocaleString()}
                          </span>
                          {lowStock && (
                            <span className="block text-xs text-amber-600 leading-none">low</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {stockData && stockData.total > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Select value={String(stockPageSize)} onValueChange={(v) => { setStockPageSize(Number(v)); setStockPage(1); }}>
                <SelectTrigger className="h-8 w-[105px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TablePagination
                page={stockPage}
                pageSize={stockPageSize}
                total={stockData.total}
                onPageChange={setStockPage}
                className="border-0 pt-0 mt-0"
              />
            </div>
          )}
          {stockData && (
            <p className="text-xs text-muted-foreground text-center">
              {stockData.total === 0
                ? "No items in stock"
                : `${stockData.total.toLocaleString()} item${stockData.total !== 1 ? "s" : ""} in stock`}
              {selectedItems.size > 0 && ` · ${selectedItems.size} selected across all pages`}
            </p>
          )}
        </TabsContent>

        {/* ── Movements ─────────────────────────────────────────────────────── */}
        <TabsContent value="movements" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search item…"
                value={mvmtSearch}
                onChange={(e) => setMvmtSearch(e.target.value)}
                className="pl-9 h-9"
              />
              {mvmtSearch && (
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setMvmtSearch("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select
              value={mvmtType || "__all__"}
              onValueChange={(v) => setMvmtType(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="w-44 h-9">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                {movementTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {MOVEMENT_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                type="date"
                value={mvmtFromDate}
                onChange={(e) => setMvmtFromDate(e.target.value)}
                className="h-9 w-36 text-sm"
                title="From date"
              />
              <span className="text-muted-foreground text-sm">–</span>
              <Input
                type="date"
                value={mvmtToDate}
                onChange={(e) => setMvmtToDate(e.target.value)}
                className="h-9 w-36 text-sm"
                title="To date"
              />
            </div>
            {mvmtFiltersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 h-8 text-muted-foreground"
                onClick={() => {
                  setMvmtSearch("");
                  setMvmtType("");
                  setMvmtFromDate("");
                  setMvmtToDate("");
                }}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="hidden sm:table-cell">Reference</TableHead>
                  <TableHead className="hidden md:table-cell">Notes</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movementsLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : pagedMovements.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-36 text-center text-muted-foreground text-sm"
                    >
                      {mvmtFiltersActive
                        ? "No movements match your filters."
                        : "No stock movements yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedMovements.map((m) => {
                    const isIn = movementIsInbound(m.movementType, m.quantity);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="max-w-[150px]">
                          <p className="text-sm font-medium truncate">{m.itemName}</p>
                          {m.itemSku && (
                            <p className="text-xs font-mono text-muted-foreground">{m.itemSku}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs whitespace-nowrap",
                              isIn
                                ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                                : "text-rose-700 border-rose-200 bg-rose-50",
                            )}
                          >
                            {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono text-sm font-medium whitespace-nowrap",
                            isIn ? "text-emerald-700" : "text-rose-700",
                          )}
                        >
                          {isIn ? "+" : ""}
                          {m.quantity}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs font-mono text-muted-foreground">
                          {m.referenceType ? (
                            m.referenceId ? (
                              <span>
                                {m.referenceType} #{m.referenceId}
                              </span>
                            ) : (
                              m.referenceType
                            )
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[120px] truncate">
                          {m.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(m.createdAt), "dd MMM yy")}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {filteredMovements.length > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Select value={String(movementsPageSize)} onValueChange={(v) => { setMovementsPageSize(Number(v)); setMovementsPage(1); }}>
                <SelectTrigger className="h-8 w-[105px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TablePagination
                page={movementsPage}
                pageSize={movementsPageSize}
                total={filteredMovements.length}
                onPageChange={setMovementsPage}
                className="border-0 pt-0 mt-0"
              />
            </div>
          )}
          {!movementsLoading && (
            <p className="text-xs text-muted-foreground text-center">
              {filteredMovements.length} movement{filteredMovements.length !== 1 ? "s" : ""}
              {mvmtFiltersActive && " (filtered)"}
            </p>
          )}
        </TabsContent>

        {/* ── Transfers ─────────────────────────────────────────────────────── */}
        <TabsContent value="transfers" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={tfrStatus || "__all__"}
                onValueChange={(v) => setTfrStatus(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="w-36 h-9">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={tfrDirection || "__all__"}
                onValueChange={(v) => setTfrDirection(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="w-32 h-9">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  <SelectItem value="in">Inbound</SelectItem>
                  <SelectItem value="out">Outbound</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5">
                <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  type="date"
                  value={tfrFromDate}
                  onChange={(e) => setTfrFromDate(e.target.value)}
                  className="h-9 w-36 text-sm"
                  title="From date"
                />
                <span className="text-muted-foreground text-sm">–</span>
                <Input
                  type="date"
                  value={tfrToDate}
                  onChange={(e) => setTfrToDate(e.target.value)}
                  className="h-9 w-36 text-sm"
                  title="To date"
                />
              </div>
              {tfrFiltersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 h-8 text-muted-foreground"
                  onClick={() => {
                    setTfrStatus("");
                    setTfrDirection("");
                    setTfrFromDate("");
                    setTfrToDate("");
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
            {/* Actions */}
            <Button variant="outline" size="sm" className="gap-2 shrink-0" asChild>
              <Link href={`/transfers/new?from=${id}`}>
                <Plus className="h-4 w-4" />
                New Transfer
              </Link>
            </Button>
          </div>

          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer #</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="hidden sm:table-cell">Counterpart</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfersLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : pagedTransfers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-36 text-center text-muted-foreground text-sm"
                    >
                      {tfrFiltersActive ? (
                        "No transfers match your filters."
                      ) : (
                        <>
                          No transfers yet.{" "}
                          <Link href={`/transfers/new?from=${id}`}>
                            <span className="text-primary hover:underline cursor-pointer">
                              Create one
                            </span>
                          </Link>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedTransfers.map((t) => {
                    const isInbound = t.toWarehouseId === id;
                    const counterpart = isInbound ? t.fromWarehouseName : t.toWarehouseName;
                    return (
                      <TableRow key={t.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => { saveScrollPos(); setLocation(`/transfers/${t.id}`); }}>
                        <TableCell onClick={(e) => { e.stopPropagation(); saveScrollPos(); }}>
                          <Link href={`/transfers/${t.id}`}>
                            <span className="text-sm font-mono text-primary hover:underline cursor-pointer">
                              {t.transferNumber}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            {isInbound ? (
                              <TrendingUp className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                            )}
                            <span
                              className={cn(
                                "text-xs font-medium",
                                isInbound ? "text-emerald-700" : "text-amber-700",
                              )}
                            >
                              {isInbound ? "Inbound" : "Outbound"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground truncate max-w-[140px]">
                          {counterpart}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("text-xs capitalize", transferStatusColor(t.status))}
                          >
                            {t.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(t.transferDate), "dd MMM yy")}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {filteredTransfers.length > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Select value={String(transfersPageSize)} onValueChange={(v) => { setTransfersPageSize(Number(v)); setTransfersPage(1); }}>
                <SelectTrigger className="h-8 w-[105px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TablePagination
                page={transfersPage}
                pageSize={transfersPageSize}
                total={filteredTransfers.length}
                onPageChange={setTransfersPage}
                className="border-0 pt-0 mt-0"
              />
            </div>
          )}
          {!transfersLoading && (
            <p className="text-xs text-muted-foreground text-center">
              {filteredTransfers.length} transfer{filteredTransfers.length !== 1 ? "s" : ""}
              {tfrFiltersActive && " (filtered)"}
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <EditWarehouseDialog
        warehouse={warehouse}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      {/* Quick (single-item) write-off — keeps the same flow as before for convenience */}
      <QuickWriteOffDialog
        warehouseId={id}
        warehouseName={warehouse.name}
        open={quickWriteOffOpen}
        onOpenChange={setQuickWriteOffOpen}
      />

      {/* Bulk write-off from selected stock items */}
      <BulkWriteOffDialog
        warehouseId={id}
        warehouseName={warehouse.name}
        initialItems={selectedItems}
        open={bulkWriteOffOpen}
        onOpenChange={setBulkWriteOffOpen}
        onDone={() => setSelectedItems(new Map())}
      />

      {/* Bulk transfer from selected stock items */}
      <BulkTransferDialog
        fromWarehouseId={id}
        fromWarehouseName={warehouse.name}
        initialItems={selectedItems}
        open={bulkTransferOpen}
        onOpenChange={setBulkTransferOpen}
        onCreated={(transferId) => {
          setSelectedItems(new Map());
          setLocation(`/transfers/${transferId}`);
        }}
      />
    </div>
  );
}

// ─── QuickWriteOffDialog (single item) ────────────────────────────────────────

const quickWriteOffSchema = z.object({
  itemId: z.coerce.number().min(1, "Select an item"),
  quantity: z.coerce.number().positive("Quantity must be positive"),
  reason: z.enum(["damage", "expired", "lost", "theft"]).default("damage"),
  notes: z.string().optional(),
});
type QuickWriteOffValues = z.infer<typeof quickWriteOffSchema>;

function QuickWriteOffDialog({
  warehouseId,
  warehouseName,
  open,
  onOpenChange,
}: {
  warehouseId: number;
  warehouseName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [itemSearch, setItemSearch] = useState("");

  const { data: allItems } = useListItems();

  const matchingItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!allItems) return [];
    if (!q) return allItems.slice(0, 50);
    return allItems
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.sku ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [allItems, itemSearch]);

  const form = useForm<QuickWriteOffValues>({
    resolver: zodResolver(quickWriteOffSchema),
    defaultValues: { itemId: 0, quantity: 0, reason: "damage", notes: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ itemId: 0, quantity: 0, reason: "damage", notes: "" });
      setItemSearch("");
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: async (values: QuickWriteOffValues) =>
      adjustItemStock(values.itemId, {
        warehouseId,
        quantity: -values.quantity,
        reason: values.reason,
        notes: values.notes || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
      queryClient.invalidateQueries({
        queryKey: getListStockMovementsQueryKey({ warehouseId }),
      });
      queryClient.invalidateQueries({ queryKey: ["warehouse-stock", warehouseId] });
      queryClient.invalidateQueries({ queryKey: ["items-paginated"] });
      queryClient.invalidateQueries({ queryKey: ["items-facets"] });
      toast({ title: "Write-off recorded", description: "Stock adjusted." });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to record write-off";
      toast({ title: "Failed", description: msg, variant: "destructive" });
    },
  });

  const selectedItemId = form.watch("itemId");
  const selectedItem = allItems?.find((it) => it.id === selectedItemId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Quick Stock Write-off
          </DialogTitle>
          <DialogDescription>
            Reduce stock in <span className="font-medium">{warehouseName}</span> for a
            single item. Select items from the Stock tab to write off multiple at once.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            {/* Item selector */}
            <FormField
              control={form.control}
              name="itemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item *</FormLabel>
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Search by name or SKU…"
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    {selectedItem && (
                      <div className="rounded-md border bg-muted/40 px-3 py-2 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{selectedItem.name}</p>
                          {selectedItem.sku && (
                            <p className="text-xs font-mono text-muted-foreground">{selectedItem.sku}</p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          onClick={() => { field.onChange(0); setItemSearch(""); }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    {!selectedItem && itemSearch && (
                      <div className="rounded-md border divide-y max-h-40 overflow-y-auto text-sm">
                        {matchingItems.length === 0 ? (
                          <p className="px-3 py-2 text-muted-foreground text-xs">No items found</p>
                        ) : (
                          matchingItems.map((it) => (
                            <button
                              key={it.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                              onClick={() => {
                                field.onChange(it.id);
                                setItemSearch(it.name);
                              }}
                            >
                              <p className="font-medium">{it.name}</p>
                              {it.sku && (
                                <p className="text-xs font-mono text-muted-foreground">{it.sku}</p>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Qty to write off *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0"
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="damage">Damage</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                        <SelectItem value="theft">Theft</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional details…" rows={2} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={mutation.isPending}>
                {mutation.isPending ? "Recording…" : "Record Write-off"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
