import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import {
  CheckCircle2, Circle, Scan, Package, Truck,
  ExternalLink, AlertCircle, Check, Camera,
  Printer, History, AlertTriangle, Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FulfillmentLine {
  id: number;
  fulfillmentId: number;
  salesOrderLineId: number;
  itemId: number;
  itemName: string;
  sku: string;
  barcode: string | null;
  quantityRequired: number;
  quantityPicked: number;
  stockAvailable: number | null;
}

interface Fulfillment {
  id: number;
  fulfillmentNumber: string;
  salesOrderId: number;
  orderNumber: string;
  shopifyOrderId: string | null;
  shipmentId: number | null;
  status: string;
  warehouseId: number;
  warehouseName: string;
  courierName: string | null;
  awbNumber: string | null;
  trackingUrl: string | null;
  notes: string | null;
  pickedAt: string | null;
  packedAt: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  lines: FulfillmentLine[];
}

interface ScanRecord {
  id: number;
  scannedCode: string;
  result: string;
  itemName: string | null;
  sku: string | null;
  fulfillmentLineId: number | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  createdAt: string;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_ORDER = ["picking", "picked", "packed", "dispatched"];

function StepIndicator({ status }: { status: string }) {
  const current = STEP_ORDER.indexOf(status);
  const displaySteps = [
    { label: "Pick", index: 0 },
    { label: "Pack & Label", index: 2 },
    { label: "Dispatch", index: 3 },
  ];

  return (
    <div className="flex items-center gap-0 mb-6">
      {displaySteps.map((step, i) => {
        const done = current > step.index;
        const active = current === step.index || (step.index === 0 && current === 1);
        return (
          <div key={step.label} className="flex items-center">
            {i > 0 && (
              <div className={cn("h-0.5 w-16 mx-1 transition-colors", done ? "bg-green-500" : "bg-muted")} />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors",
                  done
                    ? "bg-green-500 border-green-500 text-white"
                    : active
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-background border-muted-foreground/30 text-muted-foreground",
                )}
              >
                {done ? <Check className="h-5 w-5" /> : <span className="text-sm font-semibold">{i + 1}</span>}
              </div>
              <span className={cn("text-xs font-medium whitespace-nowrap", active ? "text-primary" : done ? "text-green-600" : "text-muted-foreground")}>
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Scan History ─────────────────────────────────────────────────────────────

const SCAN_RESULT_LABEL: Record<string, string> = {
  ok: "Picked",
  already_full: "Already full",
  not_found: "Not found",
  not_in_order: "Not in order",
  wrong_stage: "Wrong stage",
};

const SCAN_RESULT_COLOR: Record<string, string> = {
  ok: "bg-green-100 text-green-800 border-green-200",
  already_full: "bg-amber-100 text-amber-800 border-amber-200",
  not_found: "bg-red-100 text-red-800 border-red-200",
  not_in_order: "bg-red-100 text-red-800 border-red-200",
  wrong_stage: "bg-gray-100 text-gray-700 border-gray-200",
};

function ScanHistory({ fulfillmentId, status }: { fulfillmentId: number; status: string }) {
  const { data, isLoading } = useQuery<ScanRecord[]>({
    queryKey: ["fulfillment-scans", fulfillmentId],
    queryFn: () => customFetch<ScanRecord[]>(`/api/fulfillments/${fulfillmentId}/scans`),
    refetchInterval: status === "picking" ? 4000 : false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2 mt-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No scans recorded yet.</p>
        <p className="text-xs mt-1">Scans appear here in real time during picking.</p>
      </div>
    );
  }

  const okCount = data.filter((s) => s.result === "ok").length;
  const errorCount = data.filter((s) => s.result !== "ok").length;

  return (
    <div className="space-y-4 mt-2">
      <div className="flex gap-4 text-sm">
        <span className="text-muted-foreground">{data.length} total scans</span>
        {okCount > 0 && <span className="text-green-600 font-medium">✓ {okCount} successful</span>}
        {errorCount > 0 && <span className="text-red-600 font-medium">✗ {errorCount} failed</span>}
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="divide-y">
          {data.map((scan) => (
            <div key={scan.id} className={cn("flex items-center gap-3 px-4 py-2.5", scan.result !== "ok" && "bg-red-50/50 dark:bg-red-950/10")}>
              <div className="shrink-0 w-6 text-center">
                {scan.result === "ok" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-400 mx-auto" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {scan.itemName ?? <span className="text-muted-foreground italic">Unknown item</span>}
                </p>
                <p className="text-xs text-muted-foreground font-mono">{scan.scannedCode}</p>
              </div>
              <div className="shrink-0 text-right space-y-0.5">
                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border", SCAN_RESULT_COLOR[scan.result] ?? "bg-gray-100 text-gray-700 border-gray-200")}>
                  {SCAN_RESULT_LABEL[scan.result] ?? scan.result}
                </span>
                {scan.result === "ok" && scan.quantityBefore !== null && scan.quantityAfter !== null && (
                  <p className="text-xs text-muted-foreground">{scan.quantityBefore} → {scan.quantityAfter}</p>
                )}
              </div>
              <div className="shrink-0 text-xs text-muted-foreground w-24 text-right">
                {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Packing List ─────────────────────────────────────────────────────────────

function PackingListView({ fulfillment }: { fulfillment: Fulfillment }) {
  const lines = fulfillment.lines.filter((l) => l.quantityPicked > 0);

  const handlePrint = () => {
    const printContent = `
      <html>
        <head>
          <title>Packing List — ${fulfillment.fulfillmentNumber}</title>
          <style>
            body { font-family: sans-serif; padding: 24px; font-size: 13px; }
            h1 { font-size: 18px; margin: 0 0 4px; }
            .meta { color: #666; margin-bottom: 16px; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; }
            th { text-align: left; border-bottom: 2px solid #000; padding: 6px 8px; }
            td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
            .qty { text-align: right; font-weight: 600; font-size: 15px; }
            .mono { font-family: monospace; font-size: 11px; color: #555; }
            .footer { margin-top: 24px; color: #888; font-size: 11px; }
            .checkbox { width: 18px; height: 18px; border: 1px solid #999; display: inline-block; }
          </style>
        </head>
        <body>
          <h1>Packing List</h1>
          <div class="meta">
            Fulfillment: <strong>${fulfillment.fulfillmentNumber}</strong> &nbsp;|&nbsp;
            Order: <strong>${fulfillment.orderNumber}</strong> &nbsp;|&nbsp;
            Warehouse: <strong>${fulfillment.warehouseName}</strong>
            ${fulfillment.shopifyOrderId ? `&nbsp;|&nbsp; Shopify: <strong>${fulfillment.shopifyOrderId}</strong>` : ""}
          </div>
          <table>
            <thead>
              <tr>
                <th>✓</th>
                <th>Item</th>
                <th>SKU</th>
                <th>Barcode</th>
                <th style="text-align:right">Qty</th>
              </tr>
            </thead>
            <tbody>
              ${lines.map((l) => `
                <tr>
                  <td><span class="checkbox">&nbsp;</span></td>
                  <td>${l.itemName}</td>
                  <td class="mono">${l.sku}</td>
                  <td class="mono">${l.barcode ?? "—"}</td>
                  <td class="qty">${l.quantityPicked}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <div class="footer">
            Printed: ${new Date().toLocaleString()} &nbsp;|&nbsp;
            Total items: ${lines.reduce((s, l) => s + l.quantityPicked, 0)}
            ${fulfillment.courierName ? ` &nbsp;|&nbsp; Courier: ${fulfillment.courierName}` : ""}
            ${fulfillment.awbNumber ? ` &nbsp;|&nbsp; AWB: ${fulfillment.awbNumber}` : ""}
          </div>
        </body>
      </html>
    `;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(printContent);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 200);
  };

  if (lines.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground mt-2">
        <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No items picked yet — packing list will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {lines.length} line{lines.length !== 1 ? "s" : ""} · {lines.reduce((s, l) => s + l.quantityPicked, 0)} total units
        </p>
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-1.5" />
          Print Packing List
        </Button>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left px-4 py-2 font-medium">Item</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">SKU</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Barcode</th>
              <th className="text-right px-4 py-2 font-medium">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => (
              <tr key={l.id} className="hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium">{l.itemName}</td>
                <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{l.sku}</td>
                <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{l.barcode ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <Badge variant="secondary" className="font-mono">{l.quantityPicked}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/20">
              <td colSpan={3} className="px-4 py-2 text-sm font-medium text-right text-muted-foreground">Total units</td>
              <td className="px-4 py-2 text-right">
                <Badge className="font-mono">{lines.reduce((s, l) => s + l.quantityPicked, 0)}</Badge>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Pick Step ────────────────────────────────────────────────────────────────

function PickStep({
  fulfillment,
  onDone,
}: {
  fulfillment: Fulfillment;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanCode, setScanCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>(
    () => Object.fromEntries(fulfillment.lines.map((l) => [l.id, l.quantityRequired])),
  );
  const [lastScannedLineId, setLastScannedLineId] = useState<number | null>(null);
  const [lastScanOk, setLastScanOk] = useState<{ itemName: string } | null>(null);

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  // Auto-populate: set every line's picked quantity to the required quantity on mount.
  useEffect(() => {
    const linesToSet = fulfillment.lines.filter(
      (l) => l.quantityPicked !== l.quantityRequired,
    );
    if (linesToSet.length > 0) {
      updateLinesMutation.mutate(
        linesToSet.map((l) => ({ fulfillmentLineId: l.id, quantityPicked: l.quantityRequired })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLinesMutation = useMutation({
    mutationFn: (lines: Array<{ fulfillmentLineId: number; quantityPicked: number }>) =>
      customFetch<Fulfillment>(`/api/fulfillments/${fulfillment.id}/lines`, {
        method: "PATCH",
        body: JSON.stringify({ lines }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", fulfillment.id] });
      qc.invalidateQueries({ queryKey: ["fulfillment-scans", fulfillment.id] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: (code: string) =>
      customFetch<Fulfillment & { scanned?: { lineId: number; itemName: string; quantityPicked: number } }>(
        `/api/fulfillments/${fulfillment.id}/scan`,
        { method: "POST", body: JSON.stringify({ code }) },
      ),
    onSuccess: (data) => {
      if (data.scanned) {
        setLastScannedLineId(data.scanned.lineId);
        setLastScanOk({ itemName: data.scanned.itemName });
        setQuantities((prev) => ({ ...prev, [data.scanned!.lineId]: data.scanned!.quantityPicked }));
        qc.invalidateQueries({ queryKey: ["fulfillment", fulfillment.id] });
        qc.invalidateQueries({ queryKey: ["fulfillment-scans", fulfillment.id] });
        toast({ title: `✓ ${data.scanned.itemName} picked (+1)` });
      }
      setScanCode("");
      scanInputRef.current?.focus();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "Item not found";
      setLastScannedLineId(null);
      setLastScanOk(null);
      toast({ title: msg, variant: "destructive" });
      setScanCode("");
      scanInputRef.current?.focus();
    },
  });

  const confirmPickMutation = useMutation({
    mutationFn: () =>
      customFetch<Fulfillment>(`/api/fulfillments/${fulfillment.id}/confirm-pick`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", fulfillment.id] });
      qc.invalidateQueries({ queryKey: ["fulfillments"] });
      toast({ title: "Pick confirmed — stock deducted" });
      onDone();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "Failed to confirm pick";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const handleScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && scanCode.trim()) {
      scanMutation.mutate(scanCode.trim());
    }
  };

  const handleCameraDetect = (code: string) => {
    setCameraOpen(false);
    scanMutation.mutate(code);
  };

  const allPicked = fulfillment.lines.every((l) => (quantities[l.id] ?? 0) > 0);
  const totalRequired = fulfillment.lines.reduce((s, l) => s + l.quantityRequired, 0);
  const totalPicked = fulfillment.lines.reduce((s, l) => s + (quantities[l.id] ?? 0), 0);
  const overallPct = totalRequired > 0 ? Math.round((totalPicked / totalRequired) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Overall progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Overall progress</span>
          <span>{totalPicked} / {totalRequired} units</span>
        </div>
        <Progress value={overallPct} className="h-2" />
      </div>

      {/* Scan card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scan className="h-4 w-4" />
            Scan Item
          </CardTitle>
          <CardDescription>
            Each scan increments the matched line by 1. Use the camera on mobile or type a barcode/SKU.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                ref={scanInputRef}
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={handleScanKey}
                placeholder="Scan barcode or type SKU…"
                className="pr-20 font-mono"
                autoComplete="off"
                disabled={scanMutation.isPending}
              />
              <Button
                size="sm"
                variant="secondary"
                className="absolute right-1 top-1 h-7"
                onClick={() => scanCode.trim() && scanMutation.mutate(scanCode.trim())}
                disabled={!scanCode.trim() || scanMutation.isPending}
              >
                Enter
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setCameraOpen(true)}
            >
              <Camera className="h-4 w-4" />
              Camera
            </Button>
          </div>
          {lastScanOk && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {lastScanOk.itemName} picked (+1)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Items to Pick</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {fulfillment.lines.map((line) => {
              const picked = quantities[line.id] ?? 0;
              const done = picked >= line.quantityRequired;
              const isLast = line.id === lastScannedLineId;
              const pct = line.quantityRequired > 0 ? (picked / line.quantityRequired) * 100 : 0;
              const lowStock =
                line.stockAvailable !== null &&
                line.stockAvailable !== undefined &&
                line.stockAvailable < line.quantityRequired;

              return (
                <div
                  key={line.id}
                  className={cn(
                    "px-4 py-3 transition-colors",
                    isLast && "bg-green-50 dark:bg-green-950/20",
                    done && !isLast && "bg-muted/30",
                  )}
                >
                  <div className="flex items-center gap-3">
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{line.itemName}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground font-mono">{line.sku}</p>
                        {line.barcode && (
                          <p className="text-xs text-muted-foreground font-mono">· {line.barcode}</p>
                        )}
                        {line.stockAvailable !== null && line.stockAvailable !== undefined && (
                          <span className={cn(
                            "text-xs flex items-center gap-0.5",
                            lowStock ? "text-red-500" : "text-muted-foreground",
                          )}>
                            <Warehouse className="h-3 w-3" />
                            {lowStock && <AlertTriangle className="h-3 w-3" />}
                            Stock: {line.stockAvailable}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">Qty</p>
                      <p className="text-sm font-semibold">{line.quantityRequired}</p>
                    </div>
                  </div>

                  {/* Per-line progress bar */}
                  {!done && (
                    <div className="mt-2 ml-8">
                      <Progress value={pct} className="h-1" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Warning if incomplete */}
      {!allPicked && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Pick all items before confirming. Lines with 0 quantity will be rejected.
        </div>
      )}

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={() => confirmPickMutation.mutate()}
          disabled={!allPicked || confirmPickMutation.isPending}
        >
          {confirmPickMutation.isPending ? "Confirming…" : "Confirm Pick & Deduct Stock"}
        </Button>
      </div>

      <BarcodeScannerDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onDetected={handleCameraDetect}
        title="Scan fulfillment item"
        description="Point your camera at the barcode or QR code on the item."
      />
    </div>
  );
}

// ─── Pack Step ────────────────────────────────────────────────────────────────

function PackStep({ fulfillment, onDone }: { fulfillment: Fulfillment; onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const packMutation = useMutation({
    mutationFn: () =>
      customFetch<Fulfillment>(`/api/fulfillments/${fulfillment.id}/pack`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", fulfillment.id] });
      qc.invalidateQueries({ queryKey: ["fulfillments"] });
      toast({ title: "Items packed and labelled ✓" });
      onDone();
    },
    onError: (err: unknown) => {
      toast({ title: (err as { message?: string })?.message ?? "Failed", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Picked Items Summary</CardTitle>
          <CardDescription>Verify the items below are packed and labelled correctly.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {fulfillment.lines.map((line) => (
              <div key={line.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{line.itemName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{line.sku}</p>
                </div>
                <Badge variant="secondary" className="font-mono">× {line.quantityPicked}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-lg text-sm">
        <Package className="h-5 w-5 text-muted-foreground shrink-0" />
        <div>
          <p className="font-medium">Ready to pack?</p>
          <p className="text-muted-foreground text-xs">
            Confirm that all items above are physically packed and the shipping label is affixed.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => packMutation.mutate()} disabled={packMutation.isPending}>
          {packMutation.isPending ? "Confirming…" : "Confirm Pack & Label"}
        </Button>
      </div>
    </div>
  );
}

// ─── Dispatch Step ────────────────────────────────────────────────────────────

const COURIERS = [
  "Delhivery", "Bluedart", "DTDC", "Ekart", "Shadowfax", "XpressBees",
  "Ecom Express", "Shiprocket", "India Post", "FedEx", "DHL", "Other",
];

function DispatchStep({ fulfillment, onDone }: { fulfillment: Fulfillment; onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [courierName, setCourierName] = useState(fulfillment.courierName ?? "");
  const [awbNumber, setAwbNumber] = useState(fulfillment.awbNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(fulfillment.trackingUrl ?? "");

  const dispatchMutation = useMutation({
    mutationFn: () =>
      customFetch<Fulfillment>(`/api/fulfillments/${fulfillment.id}/dispatch`, {
        method: "POST",
        body: JSON.stringify({
          courierName: courierName.trim() || null,
          awbNumber: awbNumber.trim() || null,
          trackingUrl: trackingUrl.trim() || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", fulfillment.id] });
      qc.invalidateQueries({ queryKey: ["fulfillments"] });
      toast({ title: "Order dispatched — Shopify updated ✓" });
      onDone();
    },
    onError: (err: unknown) => {
      toast({ title: (err as { message?: string })?.message ?? "Dispatch failed", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dispatch Details</CardTitle>
          <CardDescription>
            Enter courier and AWB details. The Shopify order will be marked fulfilled upon dispatch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="courier">Courier</Label>
            <Input
              id="courier"
              value={courierName}
              onChange={(e) => setCourierName(e.target.value)}
              placeholder="e.g. Delhivery"
              list="courier-list"
            />
            <datalist id="courier-list">
              {COURIERS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="awb">AWB / Tracking Number</Label>
            <Input
              id="awb"
              value={awbNumber}
              onChange={(e) => setAwbNumber(e.target.value)}
              placeholder="Enter airway bill number"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tracking-url">
              Tracking URL <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="tracking-url"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="https://track.example.com/…"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-sm">
        <Truck className="h-5 w-5 text-blue-500 shrink-0" />
        <div>
          <p className="font-medium text-blue-700 dark:text-blue-400">Ready to dispatch?</p>
          <p className="text-blue-600/80 dark:text-blue-400/80 text-xs">
            Stock has already been deducted. Dispatching will mark the Shopify order as fulfilled.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => dispatchMutation.mutate()} disabled={dispatchMutation.isPending}>
          <Truck className="h-4 w-4 mr-2" />
          {dispatchMutation.isPending ? "Dispatching…" : "Dispatch Order"}
        </Button>
      </div>
    </div>
  );
}

// ─── Dispatched View ──────────────────────────────────────────────────────────

function DispatchedView({ fulfillment }: { fulfillment: Fulfillment }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 p-5 bg-green-50 dark:bg-green-950/20 rounded-lg">
        <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
        <div>
          <p className="font-semibold text-green-700 dark:text-green-400 text-base">
            Dispatched successfully
          </p>
          <p className="text-green-600/80 dark:text-green-400/80 text-sm">
            Stock has been deducted and the Shopify order has been marked fulfilled.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          {fulfillment.courierName && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Courier</span>
              <span className="font-medium">{fulfillment.courierName}</span>
            </div>
          )}
          {fulfillment.awbNumber && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">AWB Number</span>
              <span className="font-mono font-medium">{fulfillment.awbNumber}</span>
            </div>
          )}
          {fulfillment.trackingUrl && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tracking</span>
              <a
                href={fulfillment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline flex items-center gap-1"
              >
                Track shipment <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {fulfillment.dispatchedAt && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Dispatched at</span>
              <span>{new Date(fulfillment.dispatchedAt).toLocaleString()}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Items Shipped</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {fulfillment.lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium">{line.itemName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{line.sku}</p>
                </div>
                <Badge variant="secondary" className="font-mono">× {line.quantityPicked}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FulfillmentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const fulfillmentId = Number(id);

  const { data: fulfillment, isLoading } = useQuery<Fulfillment>({
    queryKey: ["fulfillment", fulfillmentId],
    queryFn: () => customFetch<Fulfillment>(`/api/fulfillments/${fulfillmentId}`),
    refetchInterval: (query) => {
      const status = (query.state.data as Fulfillment | undefined)?.status;
      return status === "dispatched" ? false : 10_000;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!fulfillment) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p>Fulfillment not found.</p>
        <Button variant="link" onClick={() => navigate("/fulfillments")}>
          Back to fulfillments
        </Button>
      </div>
    );
  }

  const { status } = fulfillment;

  return (
    <>
      <PageHeader
        title={fulfillment.fulfillmentNumber}
        breadcrumbs={[
          { label: "Fulfillments", href: "/fulfillments" },
          { label: `Order ${fulfillment.orderNumber}`, href: `/sales-orders/${fulfillment.salesOrderId}` },
          { label: fulfillment.fulfillmentNumber },
        ]}
        badge={
          fulfillment.shopifyOrderId ? (
            <Badge variant="outline" className="text-xs gap-1">
              <ExternalLink className="h-3 w-3" />
              Shopify
            </Badge>
          ) : undefined
        }
      />

      <div className="max-w-2xl">
        {/* Step indicator */}
        <StepIndicator status={status} />

        {/* Meta strip */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 mb-5 text-sm text-muted-foreground">
          <span>Warehouse: <span className="text-foreground font-medium">{fulfillment.warehouseName}</span></span>
          {fulfillment.pickedAt && (
            <span>Picked: <span className="text-foreground">{new Date(fulfillment.pickedAt).toLocaleString()}</span></span>
          )}
          {fulfillment.packedAt && (
            <span>Packed: <span className="text-foreground">{new Date(fulfillment.packedAt).toLocaleString()}</span></span>
          )}
          {fulfillment.dispatchedAt && (
            <span>Dispatched: <span className="text-foreground">{new Date(fulfillment.dispatchedAt).toLocaleString()}</span></span>
          )}
        </div>

        {/* Tabs: Workflow / Scan Log / Packing List */}
        <Tabs defaultValue="workflow">
          <TabsList className="mb-4">
            <TabsTrigger value="workflow">
              <Package className="h-3.5 w-3.5 mr-1.5" />
              Workflow
            </TabsTrigger>
            <TabsTrigger value="scan-log">
              <History className="h-3.5 w-3.5 mr-1.5" />
              Scan Log
            </TabsTrigger>
            <TabsTrigger value="packing-list">
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Packing List
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workflow">
            {status === "picking" && (
              <PickStep fulfillment={fulfillment} onDone={() => {}} />
            )}
            {status === "picked" && (
              <PackStep fulfillment={fulfillment} onDone={() => {}} />
            )}
            {status === "packed" && (
              <DispatchStep fulfillment={fulfillment} onDone={() => {}} />
            )}
            {status === "dispatched" && (
              <DispatchedView fulfillment={fulfillment} />
            )}
          </TabsContent>

          <TabsContent value="scan-log">
            <ScanHistory fulfillmentId={fulfillmentId} status={status} />
          </TabsContent>

          <TabsContent value="packing-list">
            <PackingListView fulfillment={fulfillment} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
