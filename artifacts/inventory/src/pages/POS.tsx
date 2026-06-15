import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyActiveSession } from "@/lib/posSessionApi";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  ShoppingCart,
  Search,
  Receipt,
  Printer,
  ScanLine,
  Plus,
  Minus,
  AlertTriangle,
} from "lucide-react";
import {
  lookupPosItems,
  posCheckout,
  downloadCustomerPaymentReceipt,
  useGetCurrentOrganization,
  useGetMe,
  useRecordPrint,
  type PosLookupItem,
  type PosCheckoutResult,
} from "@/lib/queryKeys";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { useImageSrc } from "@/hooks/use-image-src";
import { formatCurrency } from "@/lib/format";
import { normalizeRole } from "@/lib/permissions";

type CartLine = {
  itemId: number;
  sku: string;
  name: string;
  listPrice: number;
  unitPrice: number;
  taxRate: number;
  quantity: number;
  isBundle: boolean;
  discountMode: "percent" | "amount";
  discountPercent: number;
  discountAmount: number;
  maxDiscountPercent: number | null;
  onHand: number;
};

function effectiveDiscount(l: CartLine): number {
  const gross = l.quantity * l.unitPrice;
  if (l.discountMode === "percent") {
    const pct = Math.max(0, Math.min(100, l.discountPercent));
    return Math.min(gross, Math.round((gross * pct) / 100 * 100) / 100);
  }
  return Math.max(0, Math.min(gross, l.discountAmount));
}

function isDiscountViolation(l: CartLine): boolean {
  if (l.maxDiscountPercent == null) return false;
  const gross = l.quantity * l.unitPrice;
  if (l.discountMode === "percent") return l.discountPercent > l.maxDiscountPercent;
  const maxAmt = Math.round(gross * l.maxDiscountPercent / 100 * 100) / 100;
  return l.discountAmount > maxAmt;
}

type PaymentMode = "cash" | "upi" | "card";
type PaymentSplit = { mode: PaymentMode; amount: string; ref: string };
type SaleChannel =
  | "pos"
  | "walkin"
  | "website"
  | "store"
  | "whatsapp"
  | "phone"
  | "instagram"
  | "other";
const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  pos: "POS",
  walkin: "Walk-in",
  website: "Website",
  store: "Store",
  whatsapp: "WhatsApp",
  phone: "Phone",
  instagram: "Instagram",
  other: "Other",
};
const PAYMENT_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
};

export default function POS() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org } = useGetCurrentOrganization();
  const { data: activeSession } = useQuery({
    queryKey: ["pos-session-active"],
    queryFn: getMyActiveSession,
    staleTime: 60_000,
  });
  const maxOrderPct = org?.maxOrderDiscountPercent ?? null;
  const maxOrderAmt = org?.maxOrderDiscountAmount ?? null;
  const showMaxDiscountPercent = (org as any)?.showMaxDiscountPercent ?? true;
  const showOrderDiscount = (org as any)?.showOrderDiscount ?? true;
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<PosLookupItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [walkinName, setWalkinName] = useState("");
  const [walkinPhone, setWalkinPhone] = useState("");
  const [saleChannel, setSaleChannel] = useState<SaleChannel>("pos");
  const [splits, setSplits] = useState<PaymentSplit[]>([{ mode: "cash", amount: "", ref: "" }]);
  const [orderDiscountMode, setOrderDiscountMode] = useState<"percent" | "amount">("percent");
  const [orderDiscountPercent, setOrderDiscountPercent] = useState<number>(0);
  const [orderDiscountAmount, setOrderDiscountAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PosCheckoutResult | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Map<number, string>>(new Map());
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [bagItems, setBagItems] = useState<PosLookupItem[]>([]);
  const [bagQtys, setBagQtys] = useState<Map<number, number>>(new Map());
  const { data: me } = useGetMe();
  const isAdmin = (["owner", "admin"] as const).some((r) => r === normalizeRole(me?.role));
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const discountViolations = useMemo(() => cart.filter(isDiscountViolation), [cart]);
  const recordPrintMutation = useRecordPrint();
  useEffect(() => {
    scanRef.current?.focus();
  }, [cart.length]);

  useEffect(() => {
    let cancelled = false;
    lookupPosItems({ bags: "1", saleChannel: "pos" } as Parameters<typeof lookupPosItems>[0])
      .then((res) => { if (!cancelled) setBagItems(res.items); })
      .catch(() => {
        if (!cancelled) {
          toast({ title: "Failed to load bag items", variant: "destructive" });
        }
      });
    return () => { cancelled = true; };
  }, [toast]);

  useEffect(() => {
    const q = searchValue.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await lookupPosItems({ q, limit: 10, saleChannel: "pos" });
        if (!cancelled) setSearchResults(res.items);
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          toast({ title: "Search failed", description: "Could not load items. Please try again.", variant: "destructive" });
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [searchValue]);

  const totals = useMemo(() => {
    let itemSubtotal = 0;
    let itemDiscount = 0;
    let tax = 0;
    for (const l of cart) {
      const gross = l.quantity * l.unitPrice;
      const d = effectiveDiscount(l);
      const lineSub = gross - d;
      itemSubtotal += lineSub;
      itemDiscount += d;
      tax += lineSub * (l.taxRate / 100);
    }
    // Bag items — included in order total, no discount
    for (const [bagId, qty] of bagQtys) {
      if (qty <= 0) continue;
      const bag = bagItems.find((b) => b.id === bagId);
      if (!bag) continue;
      const price = Number(bag.salePrice) || 0;
      const bagGross = qty * price;
      itemSubtotal += bagGross;
      tax += bagGross * ((Number(bag.taxRate) || 0) / 100);
    }
    // Order-level discount (applied on top of item discounts)
    let orderDiscount = 0;
    if (showOrderDiscount) {
      if (orderDiscountMode === "percent") {
        const pctCap = maxOrderPct != null ? maxOrderPct : 100;
        const pct = Math.max(0, Math.min(pctCap, orderDiscountPercent));
        orderDiscount = Math.round(Math.min(itemSubtotal, itemSubtotal * pct / 100) * 100) / 100;
      } else {
        const amtCap = maxOrderAmt != null ? Math.min(itemSubtotal, maxOrderAmt) : itemSubtotal;
        orderDiscount = Math.max(0, Math.min(amtCap, orderDiscountAmount));
      }
    }
    const total = itemSubtotal - orderDiscount + tax;
    return { subtotal: itemSubtotal, itemDiscount, orderDiscount, taxTotal: tax, total };
  }, [cart, bagQtys, bagItems, orderDiscountMode, orderDiscountPercent, orderDiscountAmount, maxOrderPct, maxOrderAmt, showOrderDiscount]);

  function addToCart(item: PosLookupItem) {
    if (item.onHand <= 0) return;
    // Validate that adding one more won't exceed available stock.
    const existing = cart.find((l) => l.itemId === item.id);
    if (existing && !item.isBundle && existing.quantity >= item.onHand) {
      toast({
        title: "Stock limit reached",
        description: `Only ${item.onHand} unit${item.onHand !== 1 ? "s" : ""} of "${item.name}" available.`,
        variant: "destructive",
      });
      setSearchValue("");
      setSearchResults([]);
      setScanValue("");
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx]!, quantity: next[idx]!.quantity + 1 };
        return next;
      }
      const list = Number(item.salePrice) || 0;
      const autoDisc = showMaxDiscountPercent ? (item.maxDiscountPercent ?? 0) : 0;
      return [
        ...prev,
        {
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          listPrice: list,
          unitPrice: list,
          taxRate: Number(item.taxRate) || 0,
          quantity: 1,
          isBundle: item.isBundle,
          discountMode: "percent" as const,
          discountPercent: autoDisc,
          discountAmount: 0,
          maxDiscountPercent: item.maxDiscountPercent ?? null,
          onHand: item.onHand,
        },
      ];
    });
    setSearchValue("");
    setSearchResults([]);
    setScanValue("");
  }

  async function lookupAndAdd(code: string) {
    try {
      const res = await lookupPosItems({ q: code, limit: 5, saleChannel: "pos" });
      if (res.items.length === 1) {
        addToCart(res.items[0]!);
        return;
      }
      if (res.items.length === 0) {
        toast({
          title: "No item",
          description: `Nothing matches "${code}"`,
          variant: "destructive",
        });
        return;
      }
      setSearchValue(code);
      setSearchResults(res.items);
      setScanValue("");
    } catch (err) {
      toast({
        title: "Lookup failed",
        description: extractApiErrorMessage(err),
        variant: "destructive",
      });
    }
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const code = scanValue.trim();
    if (!code) return;
    await lookupAndAdd(code);
  }

  function handleCameraScanned(code: string) {
    setScannerOpen(false);
    void lookupAndAdd(code);
  }

  function updateQty(itemId: number, qty: number) {
    if (!Number.isFinite(qty) || qty <= 0) return;
    const line = cart.find((l) => l.itemId === itemId);
    if (line && !line.isBundle && qty > line.onHand) {
      toast({
        title: "Not enough stock",
        description: `Only ${line.onHand} unit${line.onHand !== 1 ? "s" : ""} of "${line.name}" available.`,
        variant: "destructive",
      });
      setCart((prev) =>
        prev.map((l) => (l.itemId === itemId ? { ...l, quantity: line.onHand } : l)),
      );
      setQtyDrafts((prev) => { const m = new Map(prev); m.delete(itemId); return m; });
      return;
    }
    setCart((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, quantity: qty } : l)),
    );
  }
  function updateDiscount(
    itemId: number,
    patch: Partial<Pick<CartLine, "discountMode" | "discountPercent" | "discountAmount">>,
  ) {
    setCart((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)),
    );
  }
  function removeLine(itemId: number) {
    setCart((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  async function doCheckout() {
    if (submitting) return;
    const hasBags = Array.from(bagQtys.values()).some((q) => q > 0);
    if (cart.length === 0 && !hasBags) {
      toast({ title: "Cart is empty", variant: "destructive" });
      return;
    }
    setOverrideDialogOpen(false);
    // Normalise splits:
    // 1. Single split with no amount → fill with the cart total.
    // 2. Multi-split → drop any blank/zero entries so the backend never
    //    receives an amount ≤ 0 (it rejects those with a validation error).
    let effectiveSplits: PaymentSplit[];
    if (splits.length === 1 && !splits[0]!.amount.trim()) {
      effectiveSplits = [{ ...splits[0]!, amount: String(totals.total) }];
    } else {
      effectiveSplits = splits.filter((s) => Number(s.amount) > 0);
      if (effectiveSplits.length === 0) effectiveSplits = splits;
    }
    const totalPaid = effectiveSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (!Number.isFinite(totalPaid) || totalPaid <= 0) {
      toast({ title: "Enter a payment amount", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Build bag checkout lines from the bag qty counters.
      const bagCheckoutLines = Array.from(bagQtys.entries())
        .filter(([, qty]) => qty > 0)
        .map(([bagId, qty]) => {
          const bag = bagItems.find((b) => b.id === bagId)!;
          return {
            itemId: bagId,
            quantity: qty,
            unitPrice: Number(bag.salePrice) || 0,
            taxRate: Number(bag.taxRate) || 0,
          };
        });

      // Build receipt-only CartLine entries for bags.
      const bagReceiptLines: CartLine[] = Array.from(bagQtys.entries())
        .filter(([, qty]) => qty > 0)
        .map(([bagId, qty]) => {
          const bag = bagItems.find((b) => b.id === bagId)!;
          return {
            itemId: bagId,
            sku: bag.sku,
            name: bag.name,
            listPrice: Number(bag.salePrice) || 0,
            unitPrice: Number(bag.salePrice) || 0,
            taxRate: Number(bag.taxRate) || 0,
            quantity: qty,
            isBundle: false,
            discountMode: "percent" as const,
            discountPercent: 0,
            discountAmount: 0,
            maxDiscountPercent: null,
            onHand: 0,
          };
        });

      const result = await posCheckout({
        lines: [
          ...cart.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            ...(l.discountMode === "percent" && l.discountPercent > 0
              ? { discountPercent: l.discountPercent }
              : {}),
            ...(l.discountMode === "amount" && l.discountAmount > 0
              ? { discountAmount: l.discountAmount }
              : {}),
          })),
          ...bagCheckoutLines,
        ],
        customerId: null,
        customerName: walkinName.trim() || null,
        customerPhone: walkinPhone.trim() || null,
        saleChannel,
        orderDiscountAmount: totals.orderDiscount > 0 ? totals.orderDiscount : undefined,
        payments: effectiveSplits.map((s) => ({
          mode: s.mode as "cash" | "card" | "upi" | "bank" | "other",
          amount: Number(s.amount),
          referenceNumber: s.ref || null,
        })),
        sessionId: activeSession?.id ?? null,
      } as Parameters<typeof posCheckout>[0]);
      setReceipt({
        ...result,
        _lines: [...cart.map((l) => ({ ...l })), ...bagReceiptLines],
        _payments: effectiveSplits.map((s) => ({
          mode: s.mode,
          amount: Number(s.amount),
        })),
        _totalPaid: totalPaid,
        _walkin: walkinName.trim() || walkinPhone.trim()
          ? { name: walkinName.trim(), phone: walkinPhone.trim() }
          : null,
        _channel: saleChannel,
        _orderDiscount: totals.orderDiscount,
      } as PosCheckoutResult & {
        _lines: CartLine[];
        _payments: { mode: PaymentMode; amount: number }[];
        _totalPaid: number;
        _walkin: { name: string; phone: string } | null;
        _channel: SaleChannel;
        _orderDiscount: number;
      });
      setCart([]);
      setBagQtys(new Map());
      setSplits([{ mode: "cash", amount: "", ref: "" }]);
      setWalkinName("");
      setWalkinPhone("");
      setSaleChannel("pos");
      setOrderDiscountMode("percent");
      setOrderDiscountPercent(0);
      setOrderDiscountAmount(0);
      toast({
        title: `Sale ${result.orderNumber} recorded`,
        description: `Total ${formatCurrency(Number(result.total))}`,
      });
      queryClient.invalidateQueries({ queryKey: ["pos-session-active"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
    } catch (err) {
      toast({
        title: "Checkout failed",
        description: extractApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleCheckout() {
    if (discountViolations.length > 0) {
      if (!isAdmin) {
        toast({
          title: "Discount limit exceeded",
          description: discountViolations
            .map((l) => `${l.name}: max ${l.maxDiscountPercent}%`)
            .join(", "),
          variant: "destructive",
        });
        return;
      }
      setOverrideDialogOpen(true);
      return;
    }
    void doCheckout();
  }

  function extractApiErrorMessage(err: unknown): string {
    const e = err as {
      data?: { error?: string; message?: string; detail?: string } | string | null;
      message?: string;
      response?: { data?: { error?: string } };
    };
    if (e?.data && typeof e.data === "object") {
      return (
        e.data.error ?? e.data.message ?? e.data.detail ?? e.message ?? "Try again"
      );
    }
    if (typeof e?.data === "string" && e.data.trim()) return e.data;
    if (e?.response?.data?.error) return e.response.data.error;
    if (e?.message) return e.message;
    return "Try again";
  }

  async function handleDownloadReceipt() {
    if (!receipt) return;
    setDownloadingReceipt(true);
    try {
      const blob = (await downloadCustomerPaymentReceipt(
        receipt.customerPaymentId,
      )) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${receipt.orderNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      toast({
        title: "Could not download receipt",
        description: extractApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setDownloadingReceipt(false);
    }
  }

  const splitTotal = splits.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const change = Math.max(0, splitTotal - totals.total);
  const remaining = Math.max(0, totals.total - splitTotal);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Point of Sale"
        description="Scan or search items, take payment, and record the sale."
      />
      {activeSession ? (
        <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span>
              Session <span className="font-mono font-medium">{activeSession.sessionNumber}</span>
              {activeSession.counterName ? ` · ${activeSession.counterName}` : ""}
              {activeSession.warehouseName ? ` · ${activeSession.warehouseName}` : ""}
            </span>
          </div>
          <Link href={`/pos/sessions/${activeSession.id}`}>
            <Button size="sm" variant="outline" className="h-7 text-xs">
              View Session
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-md border border-muted bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          <span>No active session — sales won't be tracked for day closing.</span>
          <Link href="/pos/sessions/new">
            <Button size="sm" variant="outline" className="h-7 text-xs">
              Open Session
            </Button>
          </Link>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* ── Left: Cart ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4" />
              Cart
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleScan} className="flex gap-2">
              <Input
                ref={scanRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                placeholder="Scan barcode or type code, then Enter"
                data-testid="input-pos-scan"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setScannerOpen(true)}
                data-testid="btn-pos-scan-camera"
                aria-label="Scan with camera"
              >
                <ScanLine className="h-4 w-4" />
              </Button>
              <Button type="submit" data-testid="btn-pos-scan-add">
                Add
              </Button>
            </form>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Search by name or SKU"
                  className="pl-9"
                  data-testid="input-pos-search"
                />
              </div>
              {searchResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                  {searchResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => addToCart(r)}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        data-testid={`btn-pos-add-${r.id}`}
                      >
                        <div className="flex justify-between gap-3">
                          <span className="truncate font-medium">{r.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatCurrency(Number(r.salePrice) || 0)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.sku} · <span className="text-green-600 dark:text-green-400">{r.onHand} available</span>
                        </div>
                      </button>
                    ))}
                </div>
              )}
              {searching && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Searching…
                </p>
              )}
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-20 text-right">Qty</TableHead>
                    <TableHead className="w-28 text-right">Price</TableHead>
                    <TableHead className="w-36 text-right">Discount</TableHead>
                    <TableHead className="w-24 text-right">Total</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-sm text-muted-foreground py-6"
                      >
                        Cart is empty. Scan or search to add items.
                      </TableCell>
                    </TableRow>
                  )}
                  {cart.map((l) => {
                    const gross = l.quantity * l.unitPrice;
                    const disc = effectiveDiscount(l);
                    const lineTotal = gross - disc;
                    const priceReduced = l.unitPrice + 1e-9 < l.listPrice;
                    return (
                      <TableRow key={l.itemId} data-testid={`row-cart-${l.itemId}`}>
                        <TableCell>
                          <div className="font-medium">{l.name}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">
                            <span>{l.sku}</span>
                            {l.isBundle && <span>· bundle</span>}
                            {priceReduced && (
                              <span
                                className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                data-testid={`badge-price-reduced-${l.itemId}`}
                                title={`List price ${formatCurrency(l.listPrice)}`}
                              >
                                Price reduced
                              </span>
                            )}
                            {disc > 0 && (
                              <span
                                className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                                data-testid={`badge-discounted-${l.itemId}`}
                              >
                                Discount {formatCurrency(disc)}
                              </span>
                            )}
                            {isDiscountViolation(l) && (
                              <span
                                className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300 flex items-center gap-0.5"
                                data-testid={`badge-discount-violation-${l.itemId}`}
                                title={`Exceeds max allowed discount of ${l.maxDiscountPercent}%`}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Exceeds max {l.maxDiscountPercent}%
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={qtyDrafts.get(l.itemId) ?? String(l.quantity)}
                            onChange={(e) =>
                              setQtyDrafts((prev) => new Map(prev).set(l.itemId, e.target.value))
                            }
                            onBlur={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n) && n > 0) updateQty(l.itemId, n);
                              setQtyDrafts((prev) => { const m = new Map(prev); m.delete(l.itemId); return m; });
                            }}
                            className="h-8 w-20 text-right"
                            data-testid={`input-cart-qty-${l.itemId}`}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm" data-testid={`text-cart-price-${l.itemId}`}>
                          {formatCurrency(l.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {showMaxDiscountPercent ? (
                            <div className="flex flex-col items-end gap-1">
                              {l.maxDiscountPercent != null && l.maxDiscountPercent > 0 ? (
                                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium whitespace-nowrap">
                                  {l.maxDiscountPercent}% off
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          ) : (
                          <div className="flex flex-col items-end gap-1">
                            {l.maxDiscountPercent != null && (() => {
                              const gross = l.quantity * l.unitPrice;
                              const maxAmt = Math.round(gross * l.maxDiscountPercent / 100 * 100) / 100;
                              return (
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  max {l.maxDiscountPercent}% · ₹{maxAmt}
                                </span>
                              );
                            })()}
                            <div className="flex items-center gap-1">
                              <div className="relative">
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={l.discountPercent || ""}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    if (!Number.isFinite(v) || v < 0) return;
                                    const cap = l.maxDiscountPercent != null ? l.maxDiscountPercent : 100;
                                    updateDiscount(l.itemId, {
                                      discountMode: "percent",
                                      discountPercent: isAdmin ? Math.min(100, v) : Math.min(cap, v),
                                      discountAmount: 0,
                                    });
                                  }}
                                  className="h-8 w-16 text-right pr-5"
                                  placeholder="0"
                                  data-testid={`input-cart-discount-pct-${l.itemId}`}
                                />
                                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
                              </div>
                              <div className="relative">
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={l.discountAmount || ""}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    if (!Number.isFinite(v) || v < 0) return;
                                    const gross = l.quantity * l.unitPrice;
                                    const maxAmt = (l.maxDiscountPercent != null && !isAdmin)
                                      ? Math.round(gross * l.maxDiscountPercent / 100 * 100) / 100
                                      : gross;
                                    updateDiscount(l.itemId, {
                                      discountMode: "amount",
                                      discountAmount: Math.min(maxAmt, v),
                                      discountPercent: 0,
                                    });
                                  }}
                                  className="h-8 w-16 text-right pl-5"
                                  placeholder="0"
                                  data-testid={`input-cart-discount-${l.itemId}`}
                                />
                                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₹</span>
                              </div>
                            </div>
                          </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {disc > 0 && (
                            <div className="text-[11px] text-muted-foreground line-through">
                              {formatCurrency(gross)}
                            </div>
                          )}
                          <div>{formatCurrency(lineTotal)}</div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLine(l.itemId)}
                            aria-label="Remove"
                            data-testid={`btn-cart-remove-${l.itemId}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ── Right: Tender ──────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 1. Mode of sale */}
            <div className="space-y-1.5">
              <Label htmlFor="pos-channel">Mode of sale</Label>
              <Select
                value={saleChannel}
                onValueChange={(v) => setSaleChannel(v as SaleChannel)}
              >
                <SelectTrigger
                  id="pos-channel"
                  data-testid="select-pos-channel"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SALE_CHANNEL_LABELS) as SaleChannel[]).map((c) => (
                    <SelectItem
                      key={c}
                      value={c}
                      data-testid={`option-pos-channel-${c}`}
                    >
                      {SALE_CHANNEL_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 2. Customer name */}
            <div className="space-y-1.5">
              <Label htmlFor="pos-walkin-name">Customer name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="pos-walkin-name"
                value={walkinName}
                onChange={(e) => setWalkinName(e.target.value.replace(/[0-9]/g, ""))}
                placeholder="e.g. Rahul Sharma"
                maxLength={200}
                data-testid="input-pos-walkin-name"
              />
            </div>

            {/* 3. Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="pos-walkin-phone">Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="pos-walkin-phone"
                type="tel"
                value={walkinPhone}
                onChange={(e) => setWalkinPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9876543210"
                maxLength={10}
                data-testid="input-pos-walkin-phone"
              />
            </div>

            {/* 4. Payment (split-capable) */}
            <div className="space-y-2">
              <Label>Payment</Label>
              {splits.map((split, idx) => (
                <div key={idx} className="rounded-md border p-2 space-y-2">
                  <div className="flex items-center gap-1">
                    <div className="grid grid-cols-3 gap-1 flex-1">
                      {(Object.keys(PAYMENT_LABELS) as PaymentMode[]).map((m) => (
                        <Button
                          key={m}
                          type="button"
                          size="sm"
                          variant={split.mode === m ? "default" : "outline"}
                          onClick={() =>
                            setSplits((prev) =>
                              prev.map((s, i) => (i === idx ? { ...s, mode: m } : s))
                            )
                          }
                          data-testid={`btn-pos-mode-${m}-${idx}`}
                        >
                          {PAYMENT_LABELS[m]}
                        </Button>
                      ))}
                    </div>
                    {splits.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() =>
                          setSplits((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label="Remove split"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={split.amount}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "" || /^\d*\.?\d*$/.test(raw))
                          setSplits((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, amount: raw } : s))
                          );
                      }}
                      placeholder={
                        idx === 0 && splits.length === 1
                          ? String(totals.total.toFixed(2))
                          : "0.00"
                      }
                      className="flex-1"
                      data-testid={`input-pos-amount-${idx}`}
                    />
                    {split.mode !== "cash" && (
                      <Input
                        value={split.ref}
                        onChange={(e) =>
                          setSplits((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, ref: e.target.value } : s))
                          )
                        }
                        placeholder="Txn / UTR"
                        className="flex-1"
                        data-testid={`input-pos-ref-${idx}`}
                      />
                    )}
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  setSplits((prev) => [...prev, { mode: "cash", amount: "", ref: "" }])
                }
                data-testid="btn-pos-add-split"
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add split payment
              </Button>
            </div>

            {/* 5b. Bag counter */}
            {bagItems.length > 0 && (
              <div className="space-y-1.5">
                <Label>Bags</Label>
                <div className="flex flex-col gap-1.5">
                  {bagItems.map((bag) => {
                    const qty = bagQtys.get(bag.id) ?? 0;
                    return (
                      <div key={bag.id} className="flex items-center gap-2">
                        <span className="flex-1 text-sm truncate" title={bag.name}>
                          {bag.name}
                          {Number(bag.salePrice) > 0 && (
                            <span className="ml-1 text-muted-foreground">
                              ({formatCurrency(Number(bag.salePrice))})
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() =>
                              setBagQtys((prev) => {
                                const next = new Map(prev);
                                next.set(bag.id, Math.max(0, (prev.get(bag.id) ?? 0) - 1));
                                return next;
                              })
                            }
                            disabled={qty === 0}
                          >
                            <span className="text-base leading-none">−</span>
                          </Button>
                          <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() =>
                              setBagQtys((prev) => {
                                const next = new Map(prev);
                                next.set(bag.id, (prev.get(bag.id) ?? 0) + 1);
                                return next;
                              })
                            }
                          >
                            <span className="text-base leading-none">+</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 6. Order-level discount */}
            {showOrderDiscount && (
            <div className="space-y-1.5">
              <Label>Order discount</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={
                    orderDiscountMode === "percent"
                      ? orderDiscountPercent || ""
                      : orderDiscountAmount || ""
                  }
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 0) return;
                    if (orderDiscountMode === "percent") {
                      const cap = maxOrderPct != null ? maxOrderPct : 100;
                      setOrderDiscountPercent(Math.min(cap, v));
                    } else {
                      const cap = maxOrderAmt != null ? maxOrderAmt : Infinity;
                      setOrderDiscountAmount(Math.min(cap, v));
                    }
                  }}
                  placeholder="0"
                  className="text-right"
                  data-testid="input-pos-order-discount"
                />
                <Select
                  value={orderDiscountMode}
                  onValueChange={(v) => {
                    setOrderDiscountMode(v as "percent" | "amount");
                    setOrderDiscountPercent(0);
                    setOrderDiscountAmount(0);
                  }}
                >
                  <SelectTrigger className="w-20 px-2" data-testid="select-pos-order-discount-mode">
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

            {/* 7. Summary */}
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5 tabular-nums">
              <Row label="Subtotal" value={totals.subtotal} />
              {totals.itemDiscount > 0 && (
                <Row label="Item Discount" value={-totals.itemDiscount} muted />
              )}
              {totals.orderDiscount > 0 && (
                <Row label="Order Discount" value={-totals.orderDiscount} muted />
              )}
              <Row label="Tax" value={totals.taxTotal} />
              <div className="border-t pt-1.5">
                <Row label="Total" value={totals.total} bold />
              </div>
              {splitTotal > 0 && remaining > 0 && (
                <Row label="Remaining" value={remaining} muted />
              )}
              {change > 0 && (
                <Row label="Change due" value={change} muted />
              )}
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={submitting || cart.length === 0}
              onClick={handleCheckout}
              data-testid="btn-pos-checkout"
            >
              {submitting ? "Recording…" : `Charge ${formatCurrency(totals.total)}`}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Sale recorded dialog ────────────────────────────────── */}
      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Sale recorded
            </DialogTitle>
            <DialogDescription>
              {receipt &&
                `${receipt.orderNumber} · ${formatCurrency(Number(receipt.total))}`}
            </DialogDescription>
          </DialogHeader>
          {receipt && (
            <div className="text-sm space-y-1">
              <p>Stock for the sold items has been reduced.</p>
              <p>
                <Link
                  href={`/sales-orders/${receipt.salesOrderId}`}
                  className="text-primary hover:underline"
                >
                  Open sales order #{receipt.salesOrderId}
                </Link>
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                if (!receipt) return;
                try {
                  const result = await recordPrintMutation.mutateAsync({
                    data: { documentType: "pos_receipt", documentId: receipt.salesOrderId },
                  });
                  if (!result.allowed) {
                    toast({
                      title: "Print limit reached",
                      description: "You've reached the 2-print limit. Contact your admin for additional copies.",
                      variant: "destructive",
                    });
                    return;
                  }
                } catch {
                  // Don't block if the check fails
                }
                window.print();
              }}
              disabled={!receipt}
              data-testid="btn-pos-thermal-print"
            >
              <Printer className="mr-2 h-4 w-4" />
              Thermal Print
            </Button>
            <Button
              variant="outline"
              onClick={handleDownloadReceipt}
              disabled={downloadingReceipt || !receipt}
              data-testid="btn-pos-download-receipt"
            >
              {downloadingReceipt ? "Downloading…" : "Download PDF"}
            </Button>
            <Button onClick={() => setReceipt(null)} data-testid="btn-pos-new-sale">
              New sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Hidden thermal receipt — only revealed by `@media print`.
        Width is 72mm (fits cleanly on 80mm rolls; also fits 58mm
        with a slight scale-down at the printer driver level).
      */}
      <ThermalReceipt receipt={receipt} />


      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Discount limit exceeded
            </DialogTitle>
            <DialogDescription>
              The following items have discounts above their allowed maximum. Proceed as admin override?
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-1 py-1">
            {discountViolations.map((l) => (
              <li key={l.itemId} className="flex items-center justify-between">
                <span className="font-medium truncate mr-2">{l.name}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {l.discountMode === "percent"
                    ? `${l.discountPercent}% (max ${l.maxDiscountPercent}%)`
                    : `₹${l.discountAmount} (max ${l.maxDiscountPercent}%)`}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doCheckout()}
              data-testid="btn-pos-override-checkout"
            >
              Override &amp; Charge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onDetected={handleCameraScanned}
        title="Scan item barcode"
        description="Point your camera at the item's barcode."
      />
    </div>
  );
}

type ThermalReceiptData = PosCheckoutResult & {
  _lines?: CartLine[];
  _payments?: { mode: PaymentMode; amount: number }[];
  _totalPaid?: number;
  _walkin?: { name: string; phone: string } | null;
  _channel?: SaleChannel;
  _orderDiscount?: number;
};

function formatReceiptDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  let h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(h)}.${pad(d.getMinutes())} ${ampm}`;
}

function ThermalReceipt({ receipt }: { receipt: PosCheckoutResult | null }) {
  const r = receipt as ThermalReceiptData | null;
  const { data: org } = useGetCurrentOrganization();
  const { data: me } = useGetMe();
  const orgAny = org as unknown as Record<string, string | null | undefined> | undefined;
  const { src: logoSrc } = useImageSrc(orgAny?.thermalLogoUrl ?? org?.logoUrl);

  const lines = r?._lines ?? [];
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  const cityLine = [org?.city, org?.state, org?.postalCode]
    .filter((p) => p && p.trim())
    .join(" ");
  const addressParts = [
    org?.addressLine1,
    org?.addressLine2,
    cityLine,
    org?.country,
  ].filter((p): p is string => !!p && p.trim().length > 0);

  const staffName = me?.user?.name || me?.user?.email || "";
  const tax = r ? Number(r.taxTotal) : 0;
  const total = r ? Number(r.total) : 0;
  const payments = r?._payments ?? [];
  const totalPaid = r?._totalPaid ?? (payments.length > 0 ? payments.reduce((s, p) => s + p.amount, 0) : total);
  const change = Math.max(0, totalPaid - total);
  const balanceDue = Math.max(0, total - totalPaid);
  const orderDiscount = r?._orderDiscount ?? 0;

  // Compute per-line numbers for the receipt
  const lineData = lines.map((l) => {
    const gross = l.quantity * l.unitPrice;
    const disc = effectiveDiscount(l);
    const lineTotal = gross - disc;
    return { ...l, gross, disc, lineTotal };
  });
  const grossSum = lineData.reduce((s, l) => s + l.gross, 0);
  const itemDiscSum = lineData.reduce((s, l) => s + l.disc, 0);
  const subtotalAfterItems = grossSum - itemDiscSum;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #pos-thermal-receipt, #pos-thermal-receipt * { visibility: visible !important; }
          #pos-thermal-receipt {
            display: block !important;
            position: absolute !important;
            left: 0; top: 0;
            width: 72mm;
            padding: 3mm 4mm;
            font-family: Georgia, 'Times New Roman', serif;
            font-size: 9pt;
            line-height: 1.35;
            color: #000;
            background: #fff;
          }
          @page { size: 72mm auto; margin: 0; }
        }
        #pos-thermal-receipt { display: none; }
        #pos-thermal-receipt .center { text-align: center; }
        #pos-thermal-receipt .bold { font-weight: 700; }
        #pos-thermal-receipt .small { font-size: 8pt; }
        #pos-thermal-receipt .xs { font-size: 7pt; }
        #pos-thermal-receipt .logo {
          max-width: 38mm; max-height: 20mm; object-fit: contain;
          display: inline-block; margin-bottom: 1mm;
        }
        #pos-thermal-receipt .biz-name {
          font-size: 15pt; font-weight: 700; letter-spacing: 0.3px; margin-top: 1mm;
        }
        #pos-thermal-receipt .title {
          font-size: 11pt; font-weight: 700; margin: 1.5mm 0 0.5mm;
        }
        #pos-thermal-receipt .sep { border-top: 1px dashed #000; margin: 1.5mm 0; }
        #pos-thermal-receipt .kv { display: flex; gap: 2mm; }
        #pos-thermal-receipt .kv > span:first-child { width: 28mm; flex-shrink: 0; }
        #pos-thermal-receipt table { width: 100%; border-collapse: collapse; }
        #pos-thermal-receipt th, #pos-thermal-receipt td {
          text-align: left; padding: 0.6mm 0; vertical-align: top;
        }
        #pos-thermal-receipt th.r, #pos-thermal-receipt td.r { text-align: right; padding-left: 3mm; }
        #pos-thermal-receipt thead th { border-bottom: 1px solid #000; }
        #pos-thermal-receipt tfoot td { padding-top: 1mm; }
        #pos-thermal-receipt .total-row td {
          border-top: 1px solid #000; font-size: 11.5pt; font-weight: 700; padding-top: 1mm;
        }
        #pos-thermal-receipt .disc-row td { font-size: 8pt; color: #444; }
        #pos-thermal-receipt .footer-web {
          font-weight: 700; font-size: 11pt; margin-top: 1mm;
        }
      `}</style>
      <div id="pos-thermal-receipt">
        {r && (
          <>
            {logoSrc && (
              <div className="center">
                <img src={logoSrc} alt="" className="logo" />
              </div>
            )}
            {org?.name && <div className="center biz-name">{org.name}</div>}
            {addressParts.map((p, i) => (
              <div className="center small" key={i}>{p}</div>
            ))}
            {org?.gstNumber && (
              <div className="center small">GSTIN : {org.gstNumber}</div>
            )}
            <div className="center title">Retail Invoice</div>
            <div className="sep" />
            <div className="kv">
              <span>Date</span>
              <span>: {formatReceiptDateTime(new Date())}</span>
            </div>
            <div className="kv">
              <span>Bill No</span>
              <span>: {r.orderNumber}</span>
            </div>
            {staffName && (
              <div className="kv">
                <span>Cashier</span>
                <span>: {staffName}</span>
              </div>
            )}
            {r._walkin?.name && (
              <div className="kv bold">
                <span>Customer</span>
                <span>: {r._walkin.name}</span>
              </div>
            )}
            {r._walkin?.phone && (
              <div className="kv bold">
                <span>Phone</span>
                <span>: {r._walkin.phone}</span>
              </div>
            )}
            {r._channel && r._channel !== "pos" && (
              <div className="kv small">
                <span>Channel</span>
                <span>: {SALE_CHANNEL_LABELS[r._channel]}</span>
              </div>
            )}
            <div className="sep" />
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">Qty</th>
                  <th className="r">Price</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineData.map((l) => (
                  <>
                    <tr key={l.itemId}>
                      <td>
                        {l.name}
                        <div className="xs">{l.sku}</div>
                      </td>
                      <td className="r">{l.quantity}</td>
                      <td className="r">{l.unitPrice.toFixed(2)}</td>
                      <td className="r">{l.gross.toFixed(2)}</td>
                    </tr>
                    {l.disc > 0 && (
                      <tr key={`${l.itemId}-disc`} className="disc-row">
                        <td colSpan={3} style={{ paddingLeft: "3mm" }}>(-) Item Discount</td>
                        <td className="r">-{l.disc.toFixed(2)}</td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="bold">Sub Total</td>
                  <td className="r bold">{totalQty}</td>
                  <td />
                  <td className="r bold">{subtotalAfterItems.toFixed(2)}</td>
                </tr>
                {orderDiscount > 0 && (
                  <tr>
                    <td colSpan={3}>(-) Order Discount</td>
                    <td className="r">-{orderDiscount.toFixed(2)}</td>
                  </tr>
                )}
                {tax > 0 && (
                  <tr>
                    <td colSpan={3}>Tax</td>
                    <td className="r">{tax.toFixed(2)}</td>
                  </tr>
                )}
                <tr className="total-row">
                  <td colSpan={3}>TOTAL</td>
                  <td className="r">RS {total.toFixed(2)}</td>
                </tr>
                {payments.length > 0 && (
                  <>
                    {payments.map((p, i) => (
                      <tr key={i}>
                        <td colSpan={3}>{PAYMENT_LABELS[p.mode] ?? p.mode}</td>
                        <td className="r">{p.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                    {change > 0 && (
                      <tr>
                        <td colSpan={3}>Change</td>
                        <td className="r">-{change.toFixed(2)}</td>
                      </tr>
                    )}
                    {balanceDue > 0 && (
                      <tr>
                        <td colSpan={3}>Balance Due</td>
                        <td className="r">{balanceDue.toFixed(2)}</td>
                      </tr>
                    )}
                  </>
                )}
              </tfoot>
            </table>
            <div className="sep" />
            {org?.invoiceFooter && (
              <div className="center footer-web">{org.invoiceFooter}</div>
            )}
            <div className="center small">Thank you for your purchase</div>
            {tax <= 0 && (
              <div className="center xs">
                All prices are inclusive of applicable taxes.
              </div>
            )}
            <div className="center xs">This is a Computer Generated Invoice</div>
          </>
        )}
      </div>
    </>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${bold ? "font-semibold text-base" : ""} ${muted ? "text-muted-foreground" : ""}`}
    >
      <span>{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );
}
