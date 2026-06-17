import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListWarehouses } from "@/lib/queryKeys";
import { customFetch, type DashboardSummary, useGetLowStockReport, type LowStockRow } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import {
  Package, AlertTriangle, ShoppingCart, ShoppingBag,
  CreditCard, Banknote, Clock, Receipt, Store, ArrowLeftRight,
  BarChart3, Scissors, ChevronRight, CalendarDays, RefreshCw,
  ArrowUpRight, ArrowDownRight, Plus, CheckCircle2, Warehouse,
  TrendingDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Area, AreaChart, BarChart, Bar, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { getEinvoiceFixSummary } from "@/lib/einvoiceFixes";
import { cn } from "@/lib/utils";
import { DateRangePicker, getPresetRange, formatRangeLabel } from "@/components/DateRangePicker";

// ─── Period-over-period delta ─────────────────────────────────────────────────

function computeDeltaPct(current: number, prev: number): number | null {
  if (prev === 0) return current > 0 ? null : 0;
  return Math.round(((current - prev) / prev) * 100);
}

function formatCurrentPeriodDates(fromISO: string, toISO: string): string {
  const from = parseISO(fromISO);
  const to   = parseISO(toISO);
  const fromYear  = format(from, "yyyy");
  const toYear    = format(to,   "yyyy");
  const fromMonth = format(from, "MMM");
  const toMonth   = format(to,   "MMM");
  if (fromMonth === toMonth && fromYear === toYear) {
    return `${format(from, "MMM d")}–${format(to, "d, yyyy")}`;
  }
  if (fromYear === toYear) {
    return `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`;
  }
  return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
}

function formatPrevPeriodLabel(prevFromISO: string, prevToISO: string): string {
  const from = parseISO(prevFromISO);
  const to   = parseISO(prevToISO);
  const fromYear  = format(from, "yyyy");
  const toYear    = format(to,   "yyyy");
  const fromMonth = format(from, "MMM");
  const toMonth   = format(to,   "MMM");
  if (fromMonth === toMonth && fromYear === toYear) {
    return `vs. ${format(from, "MMM d")}–${format(to, "d")}`;
  }
  if (fromYear === toYear) {
    return `vs. ${format(from, "MMM d")} – ${format(to, "MMM d")}`;
  }
  return `vs. ${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
}


// ─── Data hook ───────────────────────────────────────────────────────────────

function useDashboardSummary(warehouseId: number | undefined, range: { from: string; to: string }) {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (warehouseId) params.set("warehouseId", warehouseId.toString());
  return useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", warehouseId ?? null, range.from, range.to],
    queryFn: ({ signal }) => customFetch<DashboardSummary>(`/api/dashboard/summary?${params}`, { signal }),
  });
}

// ─── Mini sparkline bar ───────────────────────────────────────────────────────

function MiniSparkBar({ data, color }: { data: { val: number }[]; color: string }) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={44}>
      <BarChart data={data} barSize={5} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Bar dataKey="val" radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === data.length - 1 ? color : `${color}60`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── KPI card with sparkline ──────────────────────────────────────────────────

function KpiCard({
  label, value, sub, trendPct, trendLabel, sparkData, sparkColor, href, accentColor,
}: {
  label: string; value: string | number; sub: string;
  trendPct: number | null; trendLabel: string;
  sparkData: { val: number }[]; sparkColor: string;
  href?: string; accentColor?: string;
}) {
  const trendUp = trendPct !== null && trendPct >= 0;
  const inner = (
    <Card className="shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden group cursor-pointer">
      {/* Colored accent stripe at top */}
      {accentColor && (
        <div
          className="h-[3px] w-full opacity-90 group-hover:opacity-100 transition-opacity"
          style={{ background: accentColor }}
        />
      )}
      <CardContent className={cn("p-5", accentColor ? "pt-4" : "")}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            {label}
          </span>
          <RefreshCw className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
        </div>

        <div className="flex items-end justify-between gap-2 mb-3">
          <div>
            <div className="text-[26px] font-bold tracking-tight leading-none mb-1 text-foreground group-hover:text-primary transition-colors">
              {value}
            </div>
            <div className="text-xs text-muted-foreground">{sub}</div>
          </div>
          <div className="w-[72px] shrink-0">
            <MiniSparkBar data={sparkData} color={sparkColor} />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2.5 border-t border-border/40">
          {trendPct !== null ? (
            <span className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full",
              trendUp
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
            )}>
              {trendUp
                ? <ArrowUpRight className="h-3 w-3" />
                : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(trendPct)}%
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground italic">New</span>
          )}
          <span className="text-[11px] text-muted-foreground">{trendLabel}</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
        </div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href} className="block h-full">{inner}</Link>;
  return inner;
}

// ─── Quick action chips ───────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  {
    label: "New Sale",
    icon: ShoppingCart,
    href: "/sales-orders/new",
    cls: "text-violet-700 bg-violet-50 border-violet-200/80 hover:bg-violet-100 dark:text-violet-300 dark:bg-violet-900/20 dark:border-violet-800/30",
    iconCls: "bg-violet-600",
  },
  {
    label: "New PO",
    icon: ShoppingBag,
    href: "/purchase-orders/new",
    cls: "text-amber-700 bg-amber-50 border-amber-200/80 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800/30",
    iconCls: "bg-amber-500",
  },
  {
    label: "Transfer",
    icon: ArrowLeftRight,
    href: "/warehouses",
    cls: "text-sky-700 bg-sky-50 border-sky-200/80 hover:bg-sky-100 dark:text-sky-300 dark:bg-sky-900/20 dark:border-sky-800/30",
    iconCls: "bg-sky-600",
  },
  {
    label: "Add Item",
    icon: Package,
    href: "/items?new=1",
    cls: "text-teal-700 bg-teal-50 border-teal-200/80 hover:bg-teal-100 dark:text-teal-300 dark:bg-teal-900/20 dark:border-teal-800/30",
    iconCls: "bg-teal-600",
  },
  {
    label: "Job Work",
    icon: Scissors,
    href: "/job-work/new",
    cls: "text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200/80 hover:bg-fuchsia-100 dark:text-fuchsia-300 dark:bg-fuchsia-900/20 dark:border-fuchsia-800/30",
    iconCls: "bg-fuchsia-600",
  },
] as const;

// ─── Bottom stat card ─────────────────────────────────────────────────────────

function BottomStatCard({
  icon: Icon, iconColor, iconBg, label, value, sub, href, subVariant,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string; iconBg: string;
  label: string; value: string | number; sub?: string; href?: string;
  subVariant?: "warning" | "danger" | "success" | "muted";
}) {
  const subCls = subVariant === "danger"
    ? "text-red-600 dark:text-red-400 font-medium"
    : subVariant === "warning"
    ? "text-amber-600 dark:text-amber-400 font-medium"
    : subVariant === "success"
    ? "text-emerald-600 dark:text-emerald-400 font-medium"
    : "text-muted-foreground";
  const inner = (
    <Card className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105",
          iconBg,
        )}>
          <Icon className={cn("h-[18px] w-[18px]", iconColor)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground mb-0.5 truncate">{label}</p>
          <p className="text-base font-bold tracking-tight leading-tight truncate group-hover:text-primary transition-colors">{value}</p>
          {sub && <p className={cn("text-[11px] mt-0.5 truncate", subCls)}>{sub}</p>}
        </div>
        {href && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors shrink-0" />
        )}
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href} className="block">{inner}</Link>;
  return inner;
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card shadow-lg px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1.5 font-medium">
        {label ? format(parseISO(label), "d MMM yyyy") : ""}
      </p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Low Stock Summary card ───────────────────────────────────────────────────

function LowStockSummaryCard({ warehouseId }: { warehouseId?: number }) {
  const { data: rows = [], isLoading } = useGetLowStockReport(
    warehouseId ? { warehouseId } : {},
    { query: { staleTime: 60_000 } as any },
  );

  const SHOW = 5;
  const preview = rows.slice(0, SHOW);
  const excess = rows.length - SHOW;

  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-4 w-52 rounded-full" />
          </div>
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200/70 dark:bg-emerald-900/15 dark:border-emerald-800/30">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          All items are well-stocked
        </span>
        <span className="text-sm text-emerald-600/70 dark:text-emerald-500/70 hidden sm:block">
          — no items below reorder point
        </span>
      </div>
    );
  }

  return (
    <Card className="shadow-sm border-amber-200/70 dark:border-amber-800/30" data-testid="card-low-stock-summary">
      <CardHeader className="pb-2 pt-4 px-5 flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2 flex-wrap">
              Low Stock Alert
              <Badge variant="outline" className="text-[10px] font-bold px-1.5 py-0 border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20">
                {rows.length} item{rows.length !== 1 ? "s" : ""}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Below reorder point{warehouseId ? " in this warehouse" : " across all warehouses"} — action needed
            </CardDescription>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="h-7 text-xs shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/30">
          <Link href="/reports/low-stock">View all →</Link>
        </Button>
      </CardHeader>

      <CardContent className="px-0 pb-4">
        {/* Column header */}
        <div className="grid grid-cols-12 gap-2 px-5 pb-2 border-b border-border/40 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          <div className="col-span-5">Item / SKU</div>
          <div className="col-span-3 hidden sm:block">Warehouse</div>
          <div className="col-span-2 text-right">On Hand</div>
          <div className="col-span-1 text-right hidden sm:block">Min.</div>
          <div className="col-span-2 sm:col-span-1 text-right">Gap</div>
        </div>

        <div className="divide-y divide-border/30">
          {preview.map((row: LowStockRow) => {
            const pct = row.reorderLevel > 0
              ? Math.min(100, Math.round((row.quantityOnHand / row.reorderLevel) * 100))
              : 100;
            const isCritical = row.quantityOnHand === 0;
            const isLow = pct <= 50;

            return (
              <Link
                key={`${row.itemId}-${row.warehouseId}`}
                href={`/items/${row.itemId}`}
                className="group grid grid-cols-12 gap-2 items-center px-5 py-2.5 hover:bg-amber-50/60 dark:hover:bg-amber-900/10 transition-colors"
                data-testid={`row-low-stock-${row.itemId}`}
              >
                {/* Item name + SKU */}
                <div className="col-span-5">
                  <p className="text-xs font-medium leading-tight truncate group-hover:text-primary transition-colors">
                    {row.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{row.sku}</p>
                </div>

                {/* Warehouse */}
                <div className="col-span-3 hidden sm:flex items-center gap-1.5">
                  <Warehouse className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <p className="text-xs text-muted-foreground truncate">{row.warehouseName}</p>
                </div>

                {/* On hand + mini bar */}
                <div className="col-span-2 text-right">
                  <span className={cn(
                    "text-xs font-bold tabular-nums",
                    isCritical
                      ? "text-red-600 dark:text-red-400"
                      : isLow
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground",
                  )}>
                    {row.quantityOnHand}
                  </span>
                  <div className="mt-1.5 h-1 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        isCritical ? "bg-red-500" : isLow ? "bg-amber-500" : "bg-emerald-500",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Min level */}
                <div className="col-span-1 text-right hidden sm:block">
                  <span className="text-xs text-muted-foreground tabular-nums">{row.reorderLevel}</span>
                </div>

                {/* Deficit */}
                <div className="col-span-2 sm:col-span-1 text-right">
                  <span className={cn(
                    "inline-flex items-center justify-end gap-0.5 text-[11px] font-bold tabular-nums",
                    isCritical ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
                  )}>
                    <TrendingDown className="h-3 w-3 shrink-0" />
                    {row.deficit}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {excess > 0 && (
          <div className="px-5 pt-3 border-t border-border/30 mt-1">
            <Link
              href="/reports/low-stock"
              className="text-xs text-primary hover:underline font-semibold inline-flex items-center gap-1"
            >
              <AlertTriangle className="h-3 w-3" />
              +{excess} more item{excess !== 1 ? "s" : ""} below reorder point
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Persist date range ───────────────────────────────────────────────────────

const LS_KEY = "dashboard:dateRange";

const PRESET_COMPAT: Record<string, Parameters<typeof getPresetRange>[0]> = {
  last_30_days: "last_30",
  this_week: "this_week",
  this_month: "this_month",
  last_month: "last_month",
  last_quarter: "last_quarter",
};

function loadPersistedRange(): { from: string; to: string } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return getPresetRange("this_month");
    const saved = JSON.parse(raw) as { preset?: string; from?: string; to?: string };
    if (saved?.preset && saved.preset !== "custom") {
      const mapped = PRESET_COMPAT[saved.preset];
      if (mapped) return getPresetRange(mapped);
    }
    if (
      saved?.from && saved?.to &&
      /^\d{4}-\d{2}-\d{2}$/.test(saved.from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(saved.to)
    ) {
      return { from: saved.from, to: saved.to };
    }
  } catch { /* ignore */ }
  return getPresetRange("this_month");
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [warehouseId, setWarehouseId] = useState<number | undefined>(undefined);
  const [range, setRange] = useState<{ from: string; to: string }>(() => loadPersistedRange());

  const { data: warehouses } = useListWarehouses();
  const { data: summary, isLoading, refetch } = useDashboardSummary(warehouseId, range);
  const visibleWarehouses = (warehouses ?? []).filter((w) => !w.isVirtual);

  function handleRangeChange(from: string, to: string) {
    setRange({ from, to });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ from, to }));
    } catch { /* ignore */ }
  }

  const periodLabel = formatRangeLabel(range.from, range.to);
  const prevPeriodLabel =
    summary?.prevFromISO && summary?.prevToISO
      ? formatPrevPeriodLabel(summary.prevFromISO, summary.prevToISO)
      : "";

  // Sparkline data derived from salesTrend (last 7 points)
  const sparkSlice = (summary?.salesTrend ?? []).slice(-7);
  const salesSpark  = sparkSlice.map((d) => ({ val: d.sales }));
  const purchSpark  = sparkSlice.map((d) => ({ val: d.purchases }));
  // For stock health: invert low-stock signal relative to total
  const stockHealthPct = summary
    ? Math.round(((summary.totalItems - summary.lowStockCount) / Math.max(summary.totalItems, 1)) * 100)
    : 0;

  // Deltas
  const salesDelta  = summary ? computeDeltaPct(summary.salesThisMonth, summary.salesPrevPeriod) : null;
  const soDelta     = summary ? computeDeltaPct(summary.newSalesOrdersThisPeriod, summary.newSalesOrdersPrevPeriod) : null;
  const purchDelta  = summary ? computeDeltaPct(summary.purchasesThisMonth, summary.purchasesPrevPeriod) : null;
  const lowDelta    = summary ? computeDeltaPct(summary.lowStockCount, summary.lowStockCountPrevPeriod) : null;
  // For stock health, invert the low-stock delta (fewer low-stock = healthier)
  const stockHealthDelta = lowDelta !== null ? -lowDelta : null;

  // ── Skeleton ──────────────────────────────────────────────────────────────

  if (isLoading || !summary) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-36 rounded-full" />
            <Skeleton className="h-8 w-56 rounded-lg" />
            <Skeleton className="h-4 w-72 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-24 rounded-full" />)}
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-5 gap-4">
          <Skeleton className="col-span-3 h-72 rounded-xl" />
          <Skeleton className="col-span-2 h-72 rounded-xl" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary mb-1.5">
            MMWEAR
          </p>
          <h1
            className="text-[28px] font-extrabold tracking-tight text-foreground leading-none mb-1.5"
            data-testid="text-page-title"
          >
            Inventory Dashboard
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-page-description">
            Live snapshot — orders, stock health, revenue, and alerts in one view.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0 pt-1">
          {/* Warehouse filter */}
          <Store className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
          <Select
            value={warehouseId ? warehouseId.toString() : "all"}
            onValueChange={(v) => setWarehouseId(v === "all" ? undefined : parseInt(v))}
          >
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-dashboard-warehouse">
              <SelectValue placeholder="All Warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {visibleWarehouses.map((w) => (
                <SelectItem key={w.id} value={w.id.toString()}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DateRangePicker
            from={range.from}
            to={range.to}
            onChange={handleRangeChange}
            presets={["this_week", "this_month", "last_month", "last_quarter", "last_30"]}
            align="end"
          />

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => refetch()}
            data-testid="btn-dashboard-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>

          <Button asChild size="sm" className="h-8 gap-1.5 text-xs font-semibold">
            <Link href="/sales-orders/new">
              <Plus className="h-3.5 w-3.5" />
              New Order
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Quick action chips ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {QUICK_ACTIONS.map(({ label, icon: Icon, href, cls, iconCls }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold",
              "transition-all duration-150 cursor-pointer active:scale-95 hover:shadow-sm",
              cls,
            )}
          >
            <span className={cn(
              "h-5 w-5 rounded-md flex items-center justify-center shrink-0 transition-transform duration-150",
              iconCls,
            )}>
              <Icon className="h-3 w-3 text-white" />
            </span>
            {label}
          </Link>
        ))}
      </div>

      {/* ── KPI cards ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={formatCurrency(summary.salesThisMonth)}
          sub={periodLabel}
          trendPct={salesDelta}
          trendLabel={prevPeriodLabel}
          sparkData={salesSpark}
          sparkColor="hsl(263 70% 50%)"
          accentColor="hsl(263 70% 50%)"
          href="/sales-orders"
        />
        <KpiCard
          label="Sales Orders"
          value={summary.openSalesOrders}
          sub={`${summary.newSalesOrdersThisPeriod} new this period`}
          trendPct={soDelta}
          trendLabel={prevPeriodLabel}
          sparkData={salesSpark}
          sparkColor="hsl(197 70% 45%)"
          accentColor="hsl(197 70% 45%)"
          href="/sales-orders?status=confirmed"
        />
        <KpiCard
          label="Purchase Orders"
          value={summary.openPurchaseOrders}
          sub={formatCurrency(summary.purchasesThisMonth) + " spend"}
          trendPct={purchDelta}
          trendLabel={prevPeriodLabel}
          sparkData={purchSpark}
          sparkColor="hsl(38 95% 55%)"
          accentColor="hsl(38 95% 55%)"
          href="/purchase-orders?status=ordered"
        />
        <KpiCard
          label="Stock Health"
          value={`${stockHealthPct}%`}
          sub={`${summary.totalItems - summary.lowStockCount} of ${summary.totalItems} items stocked`}
          trendPct={stockHealthDelta}
          trendLabel={prevPeriodLabel}
          sparkData={purchSpark.length ? purchSpark : [{ val: stockHealthPct }]}
          sparkColor="hsl(158 64% 38%)"
          accentColor="hsl(158 64% 38%)"
          href="/reports/low-stock"
        />
      </div>

      {/* ── Low stock summary card ── */}
      <LowStockSummaryCard warehouseId={warehouseId} />

      {/* ── Revenue chart + Activity feed ── */}
      <div className="grid gap-4 md:grid-cols-5">

        {/* Revenue trend chart */}
        <Card className="md:col-span-3 shadow-sm">
          <CardHeader className="pb-0 pt-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Revenue Trend</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Sales vs Purchases —{" "}
                  {`${periodLabel} · `}
                  {formatCurrentPeriodDates(range.from, range.to)}
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                {[
                  { label: "Sales", color: "hsl(var(--chart-1))" },
                  { label: "Purchases", color: "hsl(var(--chart-2))" },
                ].map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-5 rounded-full inline-block" style={{ background: l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-3 px-3 pb-3">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.salesTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gPurchases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => format(parseISO(v), "d MMM")}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    dy={6}
                  />
                  <YAxis
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    dx={-4}
                    width={48}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    name="Sales"
                    stroke="hsl(var(--chart-1))"
                    fillOpacity={1}
                    fill="url(#gSales)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--chart-1))" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="purchases"
                    name="Purchases"
                    stroke="hsl(var(--chart-2))"
                    fillOpacity={1}
                    fill="url(#gPurchases)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--chart-2))" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity feed */}
        <Card className="md:col-span-2 shadow-sm flex flex-col">
          <CardHeader className="pb-3 pt-5 px-5 flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Live Activity</CardTitle>
              <CardDescription className="text-xs mt-0.5">Latest transactions</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 -mr-1 text-muted-foreground">
              <Link href="/stock"><Clock className="h-3.5 w-3.5" />View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex-1 px-0 pb-4">
            {summary.recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-5">
                <Clock className="h-7 w-7 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              </div>
            ) : (
              <ScrollArea className="h-[260px] px-5">
                <div className="space-y-3">
                  {summary.recentActivity.map((activity) => {
                    const isSO = activity.kind === "sales_order";
                    const isPO = activity.kind === "purchase_order";
                    return (
                      <div
                        key={activity.id}
                        className="flex items-start gap-3"
                        data-testid={`row-activity-${activity.id}`}
                      >
                        <div className={cn(
                          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                          isSO
                            ? "bg-violet-100 dark:bg-violet-900/40"
                            : isPO
                            ? "bg-amber-100 dark:bg-amber-900/40"
                            : "bg-sky-100 dark:bg-sky-900/40",
                        )}>
                          {isSO
                            ? <ShoppingCart className="h-4 w-4 text-violet-700 dark:text-violet-400" />
                            : isPO
                            ? <ShoppingBag className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                            : <Package className="h-4 w-4 text-sky-700 dark:text-sky-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground leading-snug truncate">
                            {activity.title}
                          </p>
                          {activity.subtitle && (
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {activity.subtitle}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right pl-1">
                          {activity.amount !== null && (
                            <p className="text-xs font-semibold text-foreground">
                              {formatCurrency(activity.amount)}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {activity.timestamp
                              ? formatDistanceToNow(parseISO(activity.timestamp), { addSuffix: true })
                              : ""}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom stat strip ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <BottomStatCard
          icon={CreditCard}
          iconColor="text-violet-700 dark:text-violet-400"
          iconBg="bg-violet-100 dark:bg-violet-900/40"
          label="Outstanding Receivables"
          value={formatCurrency(summary.outstandingReceivables)}
          sub={Number(summary.overdueReceivables) > 0 ? `${formatCurrency(summary.overdueReceivables)} overdue` : "All current"}
          subVariant={Number(summary.overdueReceivables) > 0 ? "danger" : "success"}
          href={Number(summary.overdueReceivables) > 0 ? "/sales-orders?overdue=true" : "/sales-orders?status=outstanding"}
        />
        <BottomStatCard
          icon={Clock}
          iconColor="text-amber-700 dark:text-amber-400"
          iconBg="bg-amber-100 dark:bg-amber-900/40"
          label="Outstanding Payables"
          value={formatCurrency(summary.outstandingPayables)}
          sub={Number(summary.overduePayables) > 0 ? `${formatCurrency(summary.overduePayables)} overdue` : "All current"}
          subVariant={Number(summary.overduePayables) > 0 ? "danger" : "success"}
          href={Number(summary.overduePayables) > 0 ? "/purchase-orders?overdue=true" : "/purchase-orders?status=outstanding"}
        />
        <BottomStatCard
          icon={Banknote}
          iconColor="text-emerald-700 dark:text-emerald-400"
          iconBg="bg-emerald-100 dark:bg-emerald-900/40"
          label="Total Stock Value"
          value={formatCurrency(summary.totalStockValue)}
          sub="All warehouses"
          subVariant="muted"
        />
        <BottomStatCard
          icon={Package}
          iconColor="text-sky-700 dark:text-sky-400"
          iconBg="bg-sky-100 dark:bg-sky-900/40"
          label="Total Items"
          value={summary.totalItems.toLocaleString("en-IN")}
          sub={summary.lowStockCount > 0 ? `${summary.lowStockCount} low stock` : "All well-stocked"}
          subVariant={summary.lowStockCount > 0 ? "warning" : "success"}
          href="/items"
        />
      </div>

      {/* ── Top selling items + Failed e-invoices ── */}
      <div className={cn("grid gap-4", summary.failedEinvoices.length > 0 ? "md:grid-cols-2" : "")}>

        {/* Top selling items */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 pt-5 px-5 flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Top Selling Items</CardTitle>
              <CardDescription className="text-xs mt-0.5">By revenue — {periodLabel}</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 -mr-1 text-muted-foreground">
              <Link href="/reports/sales-summary">
                <BarChart3 className="h-3.5 w-3.5" />Report
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {summary.topItems.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <BarChart3 className="h-7 w-7 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No sales data yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {summary.topItems.slice(0, 6).map((item, i) => (
                  <Link
                    key={item.itemId}
                    href={`/items/${item.itemId}`}
                    className="group flex items-center gap-3 hover:bg-muted/40 rounded-lg p-1.5 -mx-1.5 transition-colors"
                    data-testid={`row-top-item-${item.itemId}`}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs shrink-0">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight truncate group-hover:text-primary transition-colors">
                        {item.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{item.sku}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{formatCurrency(item.revenue)}</p>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Failed e-invoices */}
        {summary.failedEinvoices.length > 0 && (
          <Card className="border-destructive/40 shadow-sm" data-testid="card-failed-einvoices">
            <CardHeader className="pt-5 px-5">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                  <Receipt className="h-4.5 w-4.5 text-destructive" />
                </div>
                <div>
                  <CardTitle className="text-sm">Failed e-Invoices</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    These orders couldn't be registered with the IRP. Click the link to fix each one.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <ul className="divide-y divide-border/50">
                {summary.failedEinvoices.map((entry) => {
                  const fix = getEinvoiceFixSummary(
                    { errorCode: entry.errorCode, errorContext: entry.errorContext },
                    { customerId: entry.customerId, customerName: entry.customerName },
                  );
                  const fixSummary = fix?.title ?? entry.error ?? "IRP submission failed";
                  return (
                    <li
                      key={entry.salesOrderId}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                      data-testid={`failed-einvoice-${entry.salesOrderId}`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Link
                            href={`/sales-orders/${entry.salesOrderId}`}
                            className="font-mono font-semibold text-primary hover:underline"
                          >
                            {entry.orderNumber}
                          </Link>
                          <span className="text-muted-foreground">·</span>
                          <span className="truncate text-muted-foreground text-xs">{entry.customerName}</span>
                        </div>
                        <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="break-words">{fixSummary}</span>
                        </p>
                      </div>
                      {fix && (
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="shrink-0 h-7 text-xs"
                          data-testid={`btn-failed-einvoice-fix-${entry.salesOrderId}`}
                        >
                          <Link href={fix.href}>{fix.cta}</Link>
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
