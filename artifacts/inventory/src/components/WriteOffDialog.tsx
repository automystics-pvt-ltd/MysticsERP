import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  Search,
  Loader2,
  Package,
  X,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  useListWarehouses,
  useAdjustItemStock,
  getListStockMovementsQueryKey,
  fetchWarehouseStock,
  type WarehouseStockItem,
} from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import {
  type WriteOffReason,
  WRITE_OFF_REASONS,
  reasonLabel,
  reasonColorCls,
} from "@/lib/writeOffUtils";

interface SelectionEntry {
  qty: string;
  reason: WriteOffReason;
  notes: string;
}

// ─── WriteOffDialog ────────────────────────────────────────────────────────────

interface WriteOffDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultWarehouseId?: number;
}

export function WriteOffDialog({
  open,
  onOpenChange,
  defaultWarehouseId,
}: WriteOffDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useAdjustItemStock();

  const { data: warehouses } = useListWarehouses();

  const [warehouseId, setWarehouseId] = useState<number | null>(
    defaultWarehouseId ?? null,
  );
  const [search, setSearch] = useState("");
  const [globalReason, setGlobalReason] = useState<WriteOffReason>("damage");
  const [selections, setSelections] = useState<Map<number, SelectionEntry>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  // Reset state when dialog closes
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setSearch("");
      setSelections(new Map());
      setProgress(null);
      setConfirmStep(false);
      if (!defaultWarehouseId) setWarehouseId(null);
    }
    onOpenChange(v);
  };

  // Load items with stock for selected warehouse
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["warehouse-stock-writeoff", warehouseId],
    queryFn: () => fetchWarehouseStock(warehouseId!, { pageSize: 500 }),
    enabled: open && !!warehouseId,
    staleTime: 30_000,
  });

  const allItems: WarehouseStockItem[] = stockData?.items ?? [];

  const readyEntries = useMemo(
    () => [...selections.entries()].filter(([, v]) => Number(v.qty) > 0 && v.reason),
    [selections],
  );

  const hasQtyErrors = useMemo(() => {
    for (const [itemIdStr, sel] of selections.entries()) {
      const item = allItems.find((i) => i.itemId === Number(itemIdStr));
      if (!item) continue;
      const qty = Number(sel.qty);
      if (qty > 0 && qty > Number(item.availableQty)) return true;
    }
    return false;
  }, [selections, allItems]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (i) =>
        i.itemName.toLowerCase().includes(q) ||
        (i.itemSku ?? "").toLowerCase().includes(q) ||
        (i.category ?? "").toLowerCase().includes(q),
    );
  }, [allItems, search]);

  const selectedCount = selections.size;
  const isSubmitting = !!progress;

  // ── Item selection helpers ──────────────────────────────────────────────────

  const toggleItem = (item: WarehouseStockItem) => {
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.has(item.itemId)) {
        next.delete(item.itemId);
      } else {
        next.set(item.itemId, { qty: "", reason: globalReason, notes: "" });
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (filteredItems.every((i) => selections.has(i.itemId))) {
      // Deselect all visible
      setSelections((prev) => {
        const next = new Map(prev);
        filteredItems.forEach((i) => next.delete(i.itemId));
        return next;
      });
    } else {
      // Select all visible
      setSelections((prev) => {
        const next = new Map(prev);
        filteredItems.forEach((i) => {
          if (!next.has(i.itemId)) {
            next.set(i.itemId, { qty: "", reason: globalReason, notes: "" });
          }
        });
        return next;
      });
    }
  };

  const updateField = (
    itemId: number,
    field: keyof SelectionEntry,
    value: string,
  ) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const cur = next.get(itemId);
      if (cur) next.set(itemId, { ...cur, [field]: value });
      return next;
    });
  };

  const applyGlobalReason = () => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.forEach((val, key) => next.set(key, { ...val, reason: globalReason }));
      return next;
    });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!warehouseId) return;

    const entries = readyEntries;
    if (!entries.length) return;

    setProgress({ done: 0, total: entries.length });
    const failed: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const [itemId, fields] = entries[i]!;
      try {
        await mutation.mutateAsync({
          id: itemId,
          data: {
            warehouseId,
            quantity: -Number(fields.qty),
            reason: fields.reason,
            notes: fields.notes.trim() || null,
          },
        });
      } catch {
        const item = allItems.find((it) => it.itemId === itemId);
        failed.push(item?.itemName ?? `Item #${itemId}`);
      }
      setProgress({ done: i + 1, total: entries.length });
    }

    queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
    queryClient.invalidateQueries({ queryKey: getListStockMovementsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: ["warehouse-stock-writeoff", warehouseId],
    });

    setProgress(null);

    if (failed.length === 0) {
      toast({
        title: "Write-offs recorded",
        description: `${entries.length} item${entries.length !== 1 ? "s" : ""} written off successfully.`,
      });
      handleOpenChange(false);
    } else {
      const ok = entries.length - failed.length;
      toast({
        title: ok > 0 ? "Partially recorded" : "Write-off failed",
        description:
          ok > 0
            ? `${ok} succeeded. Failed: ${failed.join(", ")}.`
            : `Failed: ${failed.join(", ")}.`,
        variant: "destructive",
      });
    }
  };

  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((i) => selections.has(i.itemId));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </span>
            {confirmStep ? "Review Write-offs" : "Quick Stock Write-off"}
          </DialogTitle>
          <DialogDescription>
            {confirmStep
              ? "Check the items below before confirming. Stock is reduced immediately and cannot be automatically reversed."
              : "Select items, enter quantities, and assign a reason. Stock will be reduced immediately."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Controls (hidden during review step) ─────────────────────────── */}
        <div className={cn("flex flex-col gap-3 shrink-0", confirmStep && "hidden")}>
          {/* Warehouse + global reason */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warehouse *</Label>
              <Select
                value={warehouseId ? String(warehouseId) : ""}
                onValueChange={(v) => {
                  setWarehouseId(Number(v));
                  setSelections(new Map());
                }}
                disabled={!!defaultWarehouseId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a warehouse…" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses ?? [])
                    .filter((w) => !w.isVirtual)
                    .map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name} <span className="font-mono text-xs text-muted-foreground ml-1">({w.code})</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Default Reason</Label>
              <div className="flex gap-2">
                <Select
                  value={globalReason}
                  onValueChange={(v) => setGlobalReason(v as WriteOffReason)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WRITE_OFF_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-xs h-9"
                  onClick={applyGlobalReason}
                  disabled={!selectedCount}
                  title="Apply reason to all selected items"
                >
                  Apply All
                </Button>
              </div>
            </div>
          </div>

          {/* Search */}
          {warehouseId && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search items by name, SKU, or category…"
                  className="pl-8 h-9 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {selectedCount > 0 && (
                <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
                  <CheckSquare className="h-3 w-3" />
                  {selectedCount} selected
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* ── Item list / Review ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {confirmStep ? (
            <div className="space-y-2 py-1">
              <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-900/10 p-3.5 mb-1">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  {readyEntries.length} item{readyEntries.length !== 1 ? "s" : ""} ready to write off
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  {readyEntries.reduce((s, [, v]) => s + Number(v.qty), 0).toLocaleString()} total units.
                  Use the Back button to make changes.
                </p>
              </div>
              {readyEntries.map(([itemId, fields]) => {
                const item = allItems.find((i) => i.itemId === itemId);
                const qty = Number(fields.qty);
                return (
                  <div key={itemId} className="flex items-start gap-3 px-3.5 py-3 rounded-lg border bg-card">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item?.itemName ?? `Item #${itemId}`}</p>
                      {item?.itemSku && (
                        <p className="text-xs font-mono text-muted-foreground">{item.itemSku}</p>
                      )}
                      {fields.notes && (
                        <p className="text-xs text-muted-foreground/80 mt-1 italic">"{fields.notes}"</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] px-2 py-0.5 whitespace-nowrap", reasonColorCls(fields.reason))}
                      >
                        {reasonLabel(fields.reason)}
                      </Badge>
                      <span className="text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
                        −{qty}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !warehouseId ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-sm">Select a warehouse to load items.</p>
            </div>
          ) : stockLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-6 w-14" />
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-sm">{search ? "No items match your search." : "No items with stock in this warehouse."}</p>
            </div>
          ) : (
            <div className="space-y-1 py-1">
              {/* Select all header */}
              <div className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b">
                <button onClick={toggleSelectAll} className="flex items-center gap-2 hover:text-foreground transition-colors">
                  {allFilteredSelected ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  <span>{allFilteredSelected ? "Deselect All" : "Select All"} ({filteredItems.length} items)</span>
                </button>
              </div>

              {filteredItems.map((item) => {
                const sel = selections.get(item.itemId);
                const isSelected = !!sel;
                const stock = Number(item.availableQty);
                const qty = Number(sel?.qty ?? 0);
                const qtyError = isSelected && qty > 0 && qty > stock;

                return (
                  <div
                    key={item.itemId}
                    className={cn(
                      "rounded-lg border transition-all duration-150",
                      isSelected
                        ? "border-amber-300 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-900/10"
                        : "border-border/50 hover:border-border hover:bg-muted/20 cursor-pointer",
                    )}
                    onClick={() => !isSelected && toggleItem(item)}
                  >
                    {/* Always-visible row */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleItem(item)}
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-medium leading-tight truncate", !isSelected && "text-muted-foreground")}>{item.itemName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.itemSku && (
                            <span className="text-xs font-mono text-muted-foreground">{item.itemSku}</span>
                          )}
                          {item.category && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">{item.category}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSelected && stock > 0) updateField(item.itemId, "qty", String(stock));
                          }}
                          title={isSelected && stock > 0 ? "Click to write off all available stock" : undefined}
                          className={cn(
                            "text-xs font-mono px-2 py-1 rounded-md font-semibold transition-all",
                            stock > 0
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground cursor-default",
                            isSelected && stock > 0 && "hover:ring-2 hover:ring-emerald-400 hover:ring-offset-1 cursor-pointer",
                          )}
                        >
                          {stock} in stock
                        </button>
                      </div>
                    </div>

                    {/* Selected item controls */}
                    {isSelected && (
                      <div className="px-3 pb-3 grid grid-cols-12 gap-2 items-start border-t border-amber-200/60 dark:border-amber-700/30 pt-2.5">
                        {/* Qty */}
                        <div className="col-span-2 space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Qty *</Label>
                          <Input
                            type="number"
                            min="0.01"
                            step="any"
                            placeholder="0"
                            className={cn("h-8 text-sm text-right", qtyError && "border-red-400")}
                            value={sel?.qty ?? ""}
                            onChange={(e) => updateField(item.itemId, "qty", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          {qtyError && (
                            <p className="text-[10px] text-red-600">Exceeds available stock</p>
                          )}
                        </div>

                        {/* Reason */}
                        <div className="col-span-4 space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reason *</Label>
                          <Select
                            value={sel?.reason ?? "damage"}
                            onValueChange={(v) => updateField(item.itemId, "reason", v)}
                          >
                            <SelectTrigger className="h-8 text-xs" onClick={(e) => e.stopPropagation()}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {WRITE_OFF_REASONS.map((r) => (
                                <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Notes */}
                        <div className="col-span-6 space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Notes (optional)</Label>
                          <Input
                            placeholder="Add a note…"
                            className="h-8 text-xs"
                            value={sel?.notes ?? ""}
                            onChange={(e) => updateField(item.itemId, "notes", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <DialogFooter className="shrink-0 flex-col sm:flex-row gap-2 pt-2 border-t">
          {/* Status line */}
          {selectedCount > 0 && !progress && !confirmStep && (
            <p className="text-xs text-muted-foreground mr-auto self-center">
              {selectedCount} selected · {readyEntries.length} ready to submit
            </p>
          )}
          {progress && (
            <p className="text-xs text-muted-foreground mr-auto self-center">
              Processing {progress.done} / {progress.total}…
            </p>
          )}

          {confirmStep ? (
            <>
              <Button
                variant="outline"
                onClick={() => setConfirmStep(false)}
                disabled={isSubmitting}
                className="gap-1.5"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white border-0"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Recording…
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4" />
                    Confirm &amp; Record
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={() => setConfirmStep(true)}
                disabled={isSubmitting || !warehouseId || !readyEntries.length || hasQtyErrors}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white border-0"
              >
                Review {readyEntries.length > 0 ? readyEntries.length : ""} Write-off{readyEntries.length !== 1 ? "s" : ""}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
