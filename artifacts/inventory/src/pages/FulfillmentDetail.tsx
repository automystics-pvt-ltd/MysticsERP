import { useState, useRef, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, Scan, Package, Truck, ChevronLeft,
  ExternalLink, AlertCircle, Check, Minus, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { key: "picking", label: "Pick", icon: Package },
  { key: "picked",  label: "Pick", icon: Package },
  { key: "packed",  label: "Pack & Label", icon: CheckCircle2 },
  { key: "dispatched", label: "Dispatch", icon: Truck },
];

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
              <div
                className={cn(
                  "h-0.5 w-16 mx-1 transition-colors",
                  done ? "bg-green-500" : "bg-muted",
                )}
              />
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
                {done ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-semibold">{i + 1}</span>
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium whitespace-nowrap",
                  active ? "text-primary" : done ? "text-green-600" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
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
  const [quantities, setQuantities] = useState<Record<number, number>>(
    () =>
      Object.fromEntries(
        fulfillment.lines.map((l) => [l.id, l.quantityPicked]),
      ),
  );
  const [lastScanned, setLastScanned] = useState<{
    lineId: number;
    itemName: string;
    ok: boolean;
  } | null>(null);

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  const updateLinesMutation = useMutation({
    mutationFn: (lines: Array<{ fulfillmentLineId: number; quantityPicked: number }>) =>
      customFetch<Fulfillment>(`/api/fulfillments/${fulfillment.id}/lines`, {
        method: "PATCH",
        body: JSON.stringify({ lines }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", fulfillment.id] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: (code: string) =>
      customFetch<Fulfillment & { scanned?: { lineId: number; itemName: string; quantityPicked: number } }>(
        `/api/fulfillments/${fulfillment.id}/scan`,
        {
          method: "POST",
          body: JSON.stringify({ code }),
        },
      ),
    onSuccess: (data) => {
      if (data.scanned) {
        setLastScanned({ lineId: data.scanned.lineId, itemName: data.scanned.itemName, ok: true });
        setQuantities((prev) => ({
          ...prev,
          [data.scanned!.lineId]: data.scanned!.quantityPicked,
        }));
        qc.invalidateQueries({ queryKey: ["fulfillment", fulfillment.id] });
      }
      setScanCode("");
      scanInputRef.current?.focus();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "Item not found";
      setLastScanned(null);
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

  const handleScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && scanCode.trim()) {
      scanMutation.mutate(scanCode.trim());
    }
  };

  const handleQtyChange = (lineId: number, delta: number) => {
    const line = fulfillment.lines.find((l) => l.id === lineId)!;
    const current = quantities[lineId] ?? 0;
    const newQty = Math.max(0, Math.min(line.quantityRequired, current + delta));
    setQuantities((prev) => ({ ...prev, [lineId]: newQty }));
    updateLinesMutation.mutate([{ fulfillmentLineId: lineId, quantityPicked: newQty }]);
  };

  const handleQtyInput = (lineId: number, val: string) => {
    const line = fulfillment.lines.find((l) => l.id === lineId)!;
    const n = parseFloat(val);
    if (Number.isFinite(n) && n >= 0) {
      const clamped = Math.min(n, line.quantityRequired);
      setQuantities((prev) => ({ ...prev, [lineId]: clamped }));
    }
  };

  const handleQtyBlur = (lineId: number) => {
    const qty = quantities[lineId] ?? 0;
    updateLinesMutation.mutate([{ fulfillmentLineId: lineId, quantityPicked: qty }]);
  };

  const allPicked = fulfillment.lines.every(
    (l) => (quantities[l.id] ?? 0) > 0,
  );

  return (
    <div className="space-y-5">
      {/* Barcode scan input */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scan className="h-4 w-4" />
            Scan Item
          </CardTitle>
          <CardDescription>
            Scan a barcode or type a SKU and press Enter. Each scan increments the line by 1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="relative">
            <Input
              ref={scanInputRef}
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={handleScan}
              placeholder="Scan barcode or type SKU…"
              className="pr-20 font-mono"
              autoComplete="off"
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
          {lastScanned && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {lastScanned.itemName} picked (+1)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Lines table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Items to Pick</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {fulfillment.lines.map((line) => {
              const picked = quantities[line.id] ?? 0;
              const done = picked >= line.quantityRequired;
              const isLast = line.id === lastScanned?.lineId;
              return (
                <div
                  key={line.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors",
                    isLast && "bg-green-50 dark:bg-green-950/20",
                    done && !isLast && "bg-muted/30",
                  )}
                >
                  {/* Status icon */}
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}

                  {/* Item info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{line.itemName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{line.sku}</p>
                  </div>

                  {/* Required */}
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Required</p>
                    <p className="text-sm font-semibold">{line.quantityRequired}</p>
                  </div>

                  {/* Picked quantity stepper */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleQtyChange(line.id, -1)}
                      disabled={picked <= 0}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      min={0}
                      max={line.quantityRequired}
                      value={String(picked)}
                      onChange={(e) => handleQtyInput(line.id, e.target.value)}
                      onBlur={() => handleQtyBlur(line.id)}
                      className="w-16 h-7 text-center text-sm px-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleQtyChange(line.id, 1)}
                      disabled={picked >= line.quantityRequired}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Confirm pick */}
      {!allPicked && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Pick all items before confirming. Items with 0 quantity cannot be confirmed.
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
      const msg = (err as { message?: string })?.message ?? "Failed to mark as packed";
      toast({ title: msg, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Picked Items Summary</CardTitle>
          <CardDescription>
            Verify the items below are packed and labelled correctly before proceeding.
          </CardDescription>
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
                <div className="text-right">
                  <Badge variant="secondary" className="font-mono">
                    × {line.quantityPicked}
                  </Badge>
                </div>
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
        <Button
          size="lg"
          onClick={() => packMutation.mutate()}
          disabled={packMutation.isPending}
        >
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
      const msg = (err as { message?: string })?.message ?? "Dispatch failed";
      toast({ title: msg, variant: "destructive" });
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
            <div className="flex gap-2">
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
            <Label htmlFor="tracking-url">Tracking URL <span className="text-muted-foreground">(optional)</span></Label>
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
        <Button
          size="lg"
          onClick={() => dispatchMutation.mutate()}
          disabled={dispatchMutation.isPending}
        >
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
                <Badge variant="secondary" className="font-mono">
                  × {line.quantityPicked}
                </Badge>
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
        subtitle={
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/fulfillments" className="hover:underline">
              Fulfillments
            </Link>
            <ChevronLeft className="h-3 w-3 rotate-180" />
            Order{" "}
            <Link
              href={`/sales-orders/${fulfillment.salesOrderId}`}
              className="text-primary hover:underline"
            >
              {fulfillment.orderNumber}
            </Link>
            {fulfillment.shopifyOrderId && (
              <Badge variant="outline" className="text-xs gap-1 ml-1">
                <ExternalLink className="h-3 w-3" />
                Shopify
              </Badge>
            )}
          </span>
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
        </div>

        {/* Step content */}
        {(status === "picking") && (
          <PickStep
            fulfillment={fulfillment}
            onDone={() => {}}
          />
        )}
        {status === "picked" && (
          <PackStep
            fulfillment={fulfillment}
            onDone={() => {}}
          />
        )}
        {status === "packed" && (
          <DispatchStep
            fulfillment={fulfillment}
            onDone={() => {}}
          />
        )}
        {status === "dispatched" && (
          <DispatchedView fulfillment={fulfillment} />
        )}
      </div>
    </>
  );
}
