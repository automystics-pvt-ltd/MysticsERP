import { useState, useEffect, useMemo } from "react";
import { useAdjustItemStock } from "@/lib/queryKeys";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Item } from "@/lib/queryKeys";

type Warehouse = { id: number; name: string };

interface RowState {
  quantity: string;
  warehouseId: number | null;
  reason: string;
  status: "idle" | "loading" | "success" | "error";
  error?: string;
}

const REASONS = [
  { value: "manual_adjustment", label: "Manual Adjustment" },
  { value: "damaged", label: "Damaged" },
  { value: "lost", label: "Lost" },
  { value: "found", label: "Found" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: Item[];
  warehouses: Warehouse[];
  onSuccess: () => void;
}

export function BulkAdjustStockDialog({
  open,
  onOpenChange,
  selectedItems,
  warehouses,
  onSuccess,
}: Props) {
  const { toast } = useToast();
  const adjustMutation = useAdjustItemStock();

  const defaultWarehouseId = warehouses[0]?.id ?? null;

  const initRows = (): Record<number, RowState> => {
    const map: Record<number, RowState> = {};
    for (const item of selectedItems) {
      map[item.id] = {
        quantity: "",
        warehouseId: defaultWarehouseId,
        reason: "manual_adjustment",
        status: "idle",
      };
    }
    return map;
  };

  const [rows, setRows] = useState<Record<number, RowState>>(initRows);
  const [globalWarehouse, setGlobalWarehouse] = useState<string>(
    defaultWarehouseId?.toString() ?? "",
  );
  const [globalReason, setGlobalReason] = useState<string>("manual_adjustment");

  useEffect(() => {
    if (open) setRows(initRows());
  }, [open, selectedItems.map((i) => i.id).join(",")]);

  function applyGlobal() {
    setRows((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[Number(id)] = {
          ...next[Number(id)],
          warehouseId: globalWarehouse ? Number(globalWarehouse) : null,
          reason: globalReason,
        };
      }
      return next;
    });
  }

  function updateRow(id: number, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const eligibleItems = useMemo(
    () => selectedItems.filter((i) => !i.isBundle && !i.hasVariants),
    [selectedItems],
  );
  const skippedCount = selectedItems.length - eligibleItems.length;

  const validRows = useMemo(
    () =>
      eligibleItems.filter((item) => {
        const r = rows[item.id];
        if (!r) return false;
        const q = Number(r.quantity);
        return r.quantity.trim() !== "" && !isNaN(q) && q !== 0 && r.warehouseId !== null;
      }),
    [eligibleItems, rows],
  );

  const allDone = eligibleItems.every(
    (i) => rows[i.id]?.status === "success" || rows[i.id]?.status === "error",
  );
  const anyLoading = eligibleItems.some((i) => rows[i.id]?.status === "loading");

  async function handleSubmit() {
    const toProcess = validRows;
    if (toProcess.length === 0) return;

    for (const item of toProcess) {
      const r = rows[item.id];
      if (!r || r.warehouseId === null) continue;
      updateRow(item.id, { status: "loading" });
      try {
        await adjustMutation.mutateAsync({
          id: item.id,
          data: {
            warehouseId: r.warehouseId,
            quantity: Number(r.quantity),
            reason: r.reason,
          },
        });
        updateRow(item.id, { status: "success" });
      } catch (err) {
        updateRow(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }

    const successCount = validRows.filter(
      (i) => rows[i.id]?.status === "success",
    ).length;

    toast({
      title: `Stock adjusted for ${toProcess.length} item${toProcess.length === 1 ? "" : "s"}`,
    });

    if (successCount > 0) onSuccess();
  }

  function handleClose() {
    if (!anyLoading) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Adjust Stock</DialogTitle>
          <DialogDescription>
            Enter a quantity delta (positive to add, negative to remove) for
            each item. Bundles and parent items are skipped.
          </DialogDescription>
        </DialogHeader>

        {skippedCount > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {skippedCount} item{skippedCount > 1 ? "s" : ""} skipped (bundles
            or parent items — adjust their variants individually).
          </div>
        )}

        {eligibleItems.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No eligible items selected. Select regular (non-bundle, non-parent)
            items to adjust stock.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 p-3 rounded-md border bg-muted/40">
              <span className="text-sm font-medium whitespace-nowrap">
                Apply to all:
              </span>
              <Select value={globalWarehouse} onValueChange={setGlobalWarehouse}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue placeholder="Warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id.toString()}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={globalReason} onValueChange={setGlobalReason}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={applyGlobal}
              >
                Apply
              </Button>
            </div>

            <div className="overflow-auto flex-1 min-h-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Current Stock</TableHead>
                    <TableHead className="w-28">Adjustment</TableHead>
                    <TableHead className="w-40">Warehouse</TableHead>
                    <TableHead className="w-40">Reason</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligibleItems.map((item) => {
                    const r = rows[item.id];
                    if (!r) return null;
                    const qty = Number(r.quantity);
                    const currentStock = item.totalStock;
                    const newStock = r.quantity.trim() !== "" && !isNaN(qty)
                      ? currentStock + qty
                      : null;
                    const wouldGoNeg = newStock !== null && newStock < 0;

                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">
                              {item.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {item.sku}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`text-sm font-medium ${currentStock < 0 ? "text-destructive" : ""}`}
                          >
                            {currentStock}
                          </span>
                          {newStock !== null && (
                            <span className="text-xs text-muted-foreground ml-1">
                              → {newStock}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            className={`h-8 ${wouldGoNeg ? "border-amber-400" : ""}`}
                            type="text"
                            inputMode="numeric"
                            placeholder="+10 or -5"
                            value={r.quantity}
                            disabled={r.status === "loading" || r.status === "success"}
                            onChange={(e) =>
                              updateRow(item.id, {
                                quantity: e.target.value,
                                status: "idle",
                                error: undefined,
                              })
                            }
                          />
                          {wouldGoNeg && (
                            <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Goes negative
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={r.warehouseId?.toString() ?? ""}
                            onValueChange={(v) =>
                              updateRow(item.id, {
                                warehouseId: Number(v),
                                status: "idle",
                                error: undefined,
                              })
                            }
                            disabled={r.status === "loading" || r.status === "success"}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {warehouses.map((w) => (
                                <SelectItem key={w.id} value={w.id.toString()}>
                                  {w.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={r.reason}
                            onValueChange={(v) =>
                              updateRow(item.id, { reason: v })
                            }
                            disabled={r.status === "loading" || r.status === "success"}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {REASONS.map((rs) => (
                                <SelectItem key={rs.value} value={rs.value}>
                                  {rs.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {r.status === "loading" && (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                          {r.status === "success" && (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                          {r.status === "error" && (
                            <div title={r.error}>
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {eligibleItems.some((i) => rows[i.id]?.status === "error") && (
              <div className="space-y-1 pt-1">
                {eligibleItems
                  .filter((i) => rows[i.id]?.status === "error")
                  .map((i) => (
                    <p key={i.id} className="text-xs text-destructive">
                      {i.name}: {rows[i.id]?.error}
                    </p>
                  ))}
              </div>
            )}
          </>
        )}

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={handleClose} disabled={anyLoading}>
            {allDone ? "Close" : "Cancel"}
          </Button>
          {!allDone && eligibleItems.length > 0 && (
            <Button
              onClick={handleSubmit}
              disabled={anyLoading || validRows.length === 0}
              data-testid="btn-bulk-adjust-submit"
            >
              {anyLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adjusting…
                </>
              ) : (
                `Adjust ${validRows.length} item${validRows.length === 1 ? "" : "s"}`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
