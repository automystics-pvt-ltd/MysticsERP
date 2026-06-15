import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import {
  useListWarehouses,
  fetchWriteOffMovements,
  getListStockMovementsQueryKey,
} from "@/lib/queryKeys";
import { WriteOffDialog } from "@/components/WriteOffDialog";
import { WRITE_OFF_REASONS, reasonLabel, reasonColorCls } from "@/lib/writeOffUtils";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/TablePagination";
import { Can } from "@/components/Can";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useCanI } from "@/hooks/usePermissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  Search,
  X,
  FileDown,
  Package,
  Filter,
  CalendarRange,
  Warehouse,
  TrendingDown,
  BarChart3,
  ArrowUpDown,
  Flame,
  Clock,
  ShieldAlert,
  HelpCircle,
  SlidersHorizontal,
  Info,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  IndianRupee,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, isAfter, isBefore, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { StockMovement } from "@workspace/api-client-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const WRITE_OFF_TYPES = new Set(["damage", "expired", "lost", "theft"]);
const ALL_WRITE_OFF_TYPES = [...WRITE_OFF_TYPES, "adjustment"] as const;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function isWriteOff(m: StockMovement): boolean {
  if (WRITE_OFF_TYPES.has(m.movementType)) return true;
  if (m.movementType === "adjustment" && m.quantity < 0) return true;
  return false;
}

function reasonIcon(type: string): React.ElementType {
  switch (type) {
    case "damage": return Flame;
    case "expired": return Clock;
    case "theft": return ShieldAlert;
    case "lost": return HelpCircle;
    case "adjustment": return SlidersHorizontal;
    default: return AlertTriangle;
  }
}

function fmtRupees(value: number): string {
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)}Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(2)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const esc = (v: string | number | null | undefined) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  const content = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  colorCls,
  loading,
  delta,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  colorCls: string;
  loading?: boolean;
  delta?: { value: number; label: string } | null;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm flex flex-col gap-2.5 min-h-[104px] h-full">
      {/* Label row + icon */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground leading-tight">
          {label}
        </p>
        <div className={cn("h-7 w-7 shrink-0 rounded-md flex items-center justify-center", colorCls)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      {/* Value */}
      <div className="flex-1 flex items-end">
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p className="text-2xl font-bold tracking-tight leading-none truncate">{value}</p>
        )}
      </div>
      {/* Sub + delta */}
      <div className="flex items-center gap-1.5 flex-wrap min-h-[14px]">
        {loading ? (
          <Skeleton className="h-3 w-16" />
        ) : (
          <>
            {sub && <p className="text-[11px] text-muted-foreground leading-none truncate">{sub}</p>}
            {delta !== null && delta !== undefined && (
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[10px] font-semibold shrink-0",
                delta.value > 0 ? "text-red-600 dark:text-red-400" : delta.value < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
              )}>
                {delta.value > 0
                  ? <ArrowUp className="h-2.5 w-2.5" />
                  : delta.value < 0
                  ? <ArrowDown className="h-2.5 w-2.5" />
                  : null}
                {Math.abs(delta.value)}% {delta.label}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Reason breakdown card ────────────────────────────────────────────────────

function ReasonBreakdown({
  movements,
  loading,
  activeReason,
  onReasonClick,
}: {
  movements: StockMovement[];
  loading: boolean;
  activeReason: string;
  onReasonClick: (reason: string) => void;
}) {
  const [barMode, setBarMode] = useState<"count" | "value">("count");

  const breakdown = useMemo(() => {
    const m = new Map<string, { count: number; units: number; valueLost: number }>();
    movements.forEach((mv) => {
      const key = mv.movementType;
      const cur = m.get(key) ?? { count: 0, units: 0, valueLost: 0 };
      m.set(key, {
        count: cur.count + 1,
        units: cur.units + Math.abs(mv.quantity),
        valueLost: cur.valueLost + Math.abs(mv.quantity) * (mv.itemUnitCost ?? 0),
      });
    });
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [movements]);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm h-full">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">By Reason</p>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setBarMode(barMode === "count" ? "value" : "count")}
                className={cn(
                  "text-[10px] flex items-center gap-0.5 rounded px-1.5 py-0.5 border transition-colors",
                  barMode === "value"
                    ? "border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <IndianRupee className="h-3 w-3" />
                {barMode === "value" ? "by value" : "by count"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {barMode === "value" ? "Bar weighted by value — click for count" : "Bar weighted by count — click for value"}
            </TooltipContent>
          </Tooltip>
          {activeReason !== "all" && (
            <button
              onClick={() => onReasonClick("all")}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : breakdown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <div className="space-y-1.5">
          {breakdown.map(([reason, { count, units, valueLost }]) => {
            const maxVal = barMode === "value"
              ? Math.max(breakdown[0]![1].valueLost, 1)
              : Math.max(breakdown[0]![1].count, 1);
            const barVal = barMode === "value" ? valueLost : count;
            const pct = Math.round((barVal / maxVal) * 100);
            const Icon = reasonIcon(reason);
            const isActive = activeReason === reason;
            return (
              <button
                key={reason}
                onClick={() => onReasonClick(isActive ? "all" : reason)}
                className={cn(
                  "w-full text-left rounded-lg px-2.5 py-2 transition-colors group",
                  isActive
                    ? "bg-muted ring-1 ring-border"
                    : "hover:bg-muted/60"
                )}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", reasonColorCls(reason))}>
                      {reasonLabel(reason)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground font-mono text-[10px]">{count} · {units} units</span>
                    {valueLost > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400 cursor-default">
                            {fmtRupees(valueLost)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          ₹{valueLost.toLocaleString("en-IN", { maximumFractionDigits: 0 })} estimated value lost
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 dark:bg-amber-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
      {breakdown.length > 0 && !loading && (
        <p className="text-[10px] text-muted-foreground mt-3 text-center">Click a reason to filter</p>
      )}
    </div>
  );
}

// ─── Active filter chip ───────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] bg-muted border border-border rounded-full px-2.5 py-0.5 font-medium">
      {label}
      <button onClick={onRemove} className="text-muted-foreground hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WriteOffs() {
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const queryClient = useQueryClient();
  const canApproveWriteOffs = useCanI("write_offs", "approve");

  const { data: warehouses } = useListWarehouses();

  const warehouseId =
    warehouseFilter !== "all" ? Number(warehouseFilter) : undefined;

  const { data: pendingData, refetch: refetchPending } = useQuery({
    queryKey: ["write-offs", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/stock-movements/pending-write-offs");
      if (!res.ok) throw new Error("Failed to fetch pending write-offs");
      return res.json() as Promise<{ pendingWriteOffs: Array<{
        id: number;
        itemId: number;
        warehouseId: number;
        movementType: string;
        quantity: string;
        notes: string | null;
        status: string;
        createdAt: string;
        itemName: string;
        itemSku: string;
        warehouseName: string;
      }> }>;
    },
    staleTime: 30_000,
  });
  const pendingWriteOffs = pendingData?.pendingWriteOffs ?? [];

  const { data: allMovements, isLoading } = useQuery({
    queryKey: [...getListStockMovementsQueryKey({ warehouseId }), "write-offs-only"],
    queryFn: () => fetchWriteOffMovements({ warehouseId }),
    staleTime: 60_000,
  });

  // ── Derive all write-offs (full, unfiltered for stats) ─────────────────────
  const allWriteOffs = useMemo(
    () => (allMovements ?? []).filter(isWriteOff),
    [allMovements],
  );

  // ── Stats over all write-offs (not affected by UI filters) ─────────────────
  const stats = useMemo(() => {
    const totalEvents = allWriteOffs.length;
    const totalUnits = allWriteOffs.reduce((s, m) => s + Math.abs(m.quantity), 0);
    const totalValueLost = allWriteOffs.reduce((s, m) => {
      const cost = m.itemUnitCost ?? 0;
      return s + Math.abs(m.quantity) * cost;
    }, 0);
    const monthStart = startOfMonth(new Date());
    const thisMonth = allWriteOffs.filter((m) => isAfter(parseISO(m.createdAt), monthStart)).length;
    const lastMonthStart = startOfMonth(subMonths(new Date(), 1));
    const lastMonthEnd = endOfMonth(subMonths(new Date(), 1));
    const lastMonth = allWriteOffs.filter((m) => {
      const d = parseISO(m.createdAt);
      return !isBefore(d, lastMonthStart) && !isAfter(d, lastMonthEnd);
    }).length;
    const thisMonthDelta =
      lastMonth > 0
        ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
        : null;
    const topReason = (() => {
      const counts = new Map<string, number>();
      allWriteOffs.forEach((m) => counts.set(m.movementType, (counts.get(m.movementType) ?? 0) + 1));
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top ? reasonLabel(top[0]) : "—";
    })();
    return { totalEvents, totalUnits, totalValueLost, thisMonth, lastMonth, thisMonthDelta, topReason };
  }, [allWriteOffs]);

  // ── Filtered + sorted for table ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = allWriteOffs;

    if (reasonFilter !== "all") {
      list = list.filter((m) => m.movementType === reasonFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.itemName.toLowerCase().includes(q) ||
          (m.itemSku ?? "").toLowerCase().includes(q) ||
          (m.itemCategory ?? "").toLowerCase().includes(q) ||
          (m.warehouseName ?? "").toLowerCase().includes(q),
      );
    }

    if (fromDate) {
      const from = parseISO(fromDate);
      list = list.filter((m) => !isBefore(parseISO(m.createdAt), from));
    }
    if (toDate) {
      const to = parseISO(toDate + "T23:59:59");
      list = list.filter((m) => !isAfter(parseISO(m.createdAt), to));
    }

    list = [...list].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "desc" ? -diff : diff;
    });

    return list;
  }, [allWriteOffs, reasonFilter, search, fromDate, toDate, sortDir]);

  const pagedRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setSearch("");
    setWarehouseFilter("all");
    setReasonFilter("all");
    setFromDate("");
    setToDate("");
    resetPage();
  };
  const hasFilters =
    search || warehouseFilter !== "all" || reasonFilter !== "all" || fromDate || toDate;

  const handleExport = (which: "filtered" | "all") => {
    const rows = which === "all" ? allWriteOffs : filtered;
    downloadCSV(
      `write-offs-${format(new Date(), "yyyy-MM-dd")}.csv`,
      ["Date", "Item", "SKU", "Category", "Warehouse", "Reason", "Quantity Written Off", "Unit Cost (₹)", "Estimated Value Lost (₹)", "Notes"],
      rows.map((m) => {
        const qty = Math.abs(m.quantity);
        const unitCost = m.itemUnitCost ?? null;
        const valueLost = unitCost !== null ? qty * unitCost : null;
        return [
          format(parseISO(m.createdAt), "yyyy-MM-dd HH:mm"),
          m.itemName,
          m.itemSku,
          m.itemCategory,
          m.warehouseName,
          reasonLabel(m.movementType),
          qty,
          unitCost,
          valueLost,
          m.notes,
        ];
      }),
    );
  };

  const filteredUnits = filtered.reduce((s, m) => s + Math.abs(m.quantity), 0);
  const filteredValueLost = filtered.reduce((s, m) => {
    const cost = m.itemUnitCost ?? 0;
    return s + Math.abs(m.quantity) * cost;
  }, 0);

  // Warehouse name for chip label
  const warehouseName =
    warehouseFilter !== "all"
      ? (warehouses ?? []).find((w) => String(w.id) === warehouseFilter)?.name ?? "Warehouse"
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Write-offs"
        description="Record and track inventory losses with a full audit trail."
        actions={
          <div className="flex items-center gap-2">
            <Can module="write_offs" action="export">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <FileDown className="h-4 w-4" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport("filtered")}>
                    Export filtered ({filtered.length})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("all")}>
                    Export all ({allWriteOffs.length})
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Can>
            <Can module="write_offs" action="create">
              <Button
                onClick={() => setWriteOffOpen(true)}
                className="gap-2 bg-amber-600 hover:bg-amber-700 border-0 text-white"
              >
                <AlertTriangle className="h-4 w-4" />
                New Write-off
              </Button>
            </Can>
          </div>
        }
      />

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard
          label="Total Events"
          value={stats.totalEvents.toLocaleString()}
          sub="all time"
          icon={AlertTriangle}
          colorCls="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          loading={isLoading}
        />
        <SummaryCard
          label="Units Written Off"
          value={stats.totalUnits.toLocaleString()}
          sub="all time"
          icon={TrendingDown}
          colorCls="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          loading={isLoading}
        />
        <SummaryCard
          label="Estimated Value Lost"
          value={isLoading ? "—" : fmtRupees(stats.totalValueLost)}
          sub="avg. cost basis"
          icon={IndianRupee}
          colorCls="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
          loading={isLoading}
        />
        <SummaryCard
          label="This Month"
          value={stats.thisMonth}
          sub="write-off events"
          icon={CalendarRange}
          colorCls="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          loading={isLoading}
          delta={
            stats.thisMonthDelta !== null
              ? { value: stats.thisMonthDelta, label: "vs last month" }
              : null
          }
        />
        {/* 5th card spans full width on mobile so it isn't orphaned */}
        <div className="col-span-2 md:col-span-1 flex flex-col">
          <SummaryCard
            label="Top Reason"
            value={isLoading ? "—" : stats.topReason}
            sub="most frequent"
            icon={BarChart3}
            colorCls="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
            loading={isLoading}
          />
        </div>
      </div>

      {/* ── Pending Approval ─────────────────────────────────────────────── */}
      {pendingWriteOffs.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-amber-800 dark:text-amber-400 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending Approval ({pendingWriteOffs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingWriteOffs.map((wo) => (
              <div
                key={wo.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-background p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/items/${wo.itemId}`} className="text-sm font-medium hover:underline">
                      {wo.itemName}
                    </Link>
                    <span className="text-xs text-muted-foreground font-mono">{wo.itemSku}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 capitalize gap-1 inline-flex items-center", reasonColorCls(wo.movementType))}>
                      {reasonLabel(wo.movementType)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {wo.quantity} units · {wo.warehouseName}
                    {wo.notes && <span> · {wo.notes}</span>}
                  </div>
                </div>
                <ApprovalActions
                  module="write_offs"
                  recordId={wo.id}
                  canApprove={canApproveWriteOffs}
                  onApproved={() => {
                    void refetchPending();
                    void queryClient.invalidateQueries({ queryKey: ["write-offs"] });
                  }}
                  onRejected={() => {
                    void refetchPending();
                  }}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Breakdown + Filter panel ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Reason breakdown — clicking filters the table */}
        <div className="lg:col-span-1">
          <ReasonBreakdown
            movements={allWriteOffs}
            loading={isLoading}
            activeReason={reasonFilter}
            onReasonClick={(r) => { setReasonFilter(r); resetPage(); }}
          />
        </div>

        <div className="lg:col-span-3 space-y-3">
          {/* Filters */}
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Filters</p>
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 ml-auto" onClick={clearFilters}>
                  <X className="h-3 w-3" /> Clear all
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {/* Search */}
              <div className="col-span-2 relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search item name, SKU, category or warehouse…"
                  className="pl-8 h-8 text-sm"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                />
                {search && (
                  <button onClick={() => { setSearch(""); resetPage(); }} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>

              {/* Warehouse */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Warehouse</p>
                <Select value={warehouseFilter} onValueChange={(v) => { setWarehouseFilter(v); resetPage(); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <Warehouse className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="All Warehouses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Warehouses</SelectItem>
                    {(warehouses ?? []).filter((w) => !w.isVirtual).map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reason */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Reason</p>
                <Select value={reasonFilter} onValueChange={(v) => { setReasonFilter(v); resetPage(); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="All Reasons" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reasons</SelectItem>
                    {WRITE_OFF_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date from */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">From</p>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => { setFromDate(e.target.value); resetPage(); }}
                />
              </div>

              {/* Date to */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">To</p>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => { setToDate(e.target.value); resetPage(); }}
                />
              </div>
            </div>

            {/* Active filter chips */}
            {hasFilters && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
                {reasonFilter !== "all" && (
                  <FilterChip
                    label={reasonLabel(reasonFilter)}
                    onRemove={() => { setReasonFilter("all"); resetPage(); }}
                  />
                )}
                {warehouseName && (
                  <FilterChip
                    label={warehouseName}
                    onRemove={() => { setWarehouseFilter("all"); resetPage(); }}
                  />
                )}
                {search && (
                  <FilterChip
                    label={`"${search}"`}
                    onRemove={() => { setSearch(""); resetPage(); }}
                  />
                )}
                {fromDate && (
                  <FilterChip
                    label={`From ${format(parseISO(fromDate), "dd MMM yyyy")}`}
                    onRemove={() => { setFromDate(""); resetPage(); }}
                  />
                )}
                {toDate && (
                  <FilterChip
                    label={`To ${format(parseISO(toDate), "dd MMM yyyy")}`}
                    onRemove={() => { setToDate(""); resetPage(); }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Table toolbar */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Loading…" : (
                <>
                  <span className="font-medium text-foreground">{filtered.length.toLocaleString()}</span>
                  {" "}event{filtered.length !== 1 ? "s" : ""}
                  {hasFilters ? " (filtered)" : ""}
                  {filtered.length > 0 && (
                    <>
                      {" "}· <span className="font-medium text-red-600 dark:text-red-400">
                        {filteredUnits.toLocaleString()} units
                      </span> lost
                      {filteredValueLost > 0 && (
                        <> · <span className="font-medium text-rose-600 dark:text-rose-400">
                          {fmtRupees(filteredValueLost)}
                        </span> est. value</>
                      )}
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortDir === "desc" ? "Newest first" : "Oldest first"}
            </Button>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); resetPage(); }}>
              <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[120px]">Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="w-[110px]">SKU</TableHead>
                <TableHead className="w-[120px]">Warehouse</TableHead>
                <TableHead className="w-[130px]">Reason</TableHead>
                <TableHead className="text-right w-[90px]">Units Lost</TableHead>
                <TableHead className="text-right w-[110px]">Value Lost</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
                        <Package className="h-7 w-7 opacity-40" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {hasFilters ? "No write-offs match your filters" : "No write-offs recorded yet"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {hasFilters
                            ? "Try adjusting or clearing the active filters."
                            : "Record your first stock write-off to start tracking losses."}
                        </p>
                      </div>
                      {!hasFilters && (
                        <Can module="write_offs" action="create">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setWriteOffOpen(true)}
                            className="gap-2"
                          >
                            <AlertTriangle className="h-4 w-4" />
                            Record first write-off
                          </Button>
                        </Can>
                      )}
                      {hasFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-xs">
                          <X className="h-3.5 w-3.5" /> Clear filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedRows.map((m) => {
                  const Icon = reasonIcon(m.movementType);
                  const qty = Math.abs(m.quantity);
                  return (
                    <TableRow key={m.id} className="hover:bg-muted/30 transition-colors group">
                      {/* Date */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap py-3 align-top">
                        <div className="font-medium text-foreground/80">
                          {format(parseISO(m.createdAt), "dd MMM yyyy")}
                        </div>
                        <div className="text-[10px] opacity-60 mt-0.5">
                          {format(parseISO(m.createdAt), "HH:mm")}
                        </div>
                      </TableCell>

                      {/* Item */}
                      <TableCell className="py-3 align-top">
                        <Link
                          href={`/items/${m.itemId}`}
                          className="text-sm font-medium text-foreground hover:text-primary hover:underline inline-flex items-center gap-1 group/link"
                        >
                          {m.itemName}
                          <ChevronRight className="h-3 w-3 opacity-0 group-hover/link:opacity-60 transition-opacity" />
                        </Link>
                        {m.itemCategory && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{m.itemCategory}</p>
                        )}
                        {m.notes && (
                          <p
                            className="text-[11px] text-muted-foreground/70 mt-1 italic truncate max-w-[220px]"
                            title={m.notes}
                          >
                            {m.notes}
                          </p>
                        )}
                      </TableCell>

                      {/* SKU */}
                      <TableCell className="font-mono text-xs text-muted-foreground py-3 align-top">
                        {m.itemSku ?? <span className="opacity-40">—</span>}
                      </TableCell>

                      {/* Warehouse */}
                      <TableCell className="text-xs py-3 align-top">
                        <div className="flex items-center gap-1">
                          <Warehouse className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span>{m.warehouseName}</span>
                        </div>
                      </TableCell>

                      {/* Reason */}
                      <TableCell className="py-3 align-top">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-2 py-0.5 capitalize whitespace-nowrap gap-1 inline-flex items-center",
                            reasonColorCls(m.movementType),
                          )}
                        >
                          <Icon className="h-2.5 w-2.5 shrink-0" />
                          {reasonLabel(m.movementType)}
                        </Badge>
                      </TableCell>

                      {/* Units lost */}
                      <TableCell className="text-right py-3 align-top">
                        <span className={cn(
                          "inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-bold tabular-nums",
                          qty >= 50
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : qty >= 10
                            ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          -{qty}
                        </span>
                      </TableCell>

                      {/* Value lost */}
                      <TableCell className="text-right py-3 align-top tabular-nums">
                        {m.itemUnitCost !== null && m.itemUnitCost !== undefined ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium text-rose-700 dark:text-rose-400 cursor-default">
                                {fmtRupees(qty * m.itemUnitCost)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              {qty} × ₹{m.itemUnitCost.toLocaleString("en-IN", { maximumFractionDigits: 2 })} unit cost
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground opacity-40">—</span>
                        )}
                      </TableCell>

                      {/* Notes tooltip */}
                      <TableCell className="py-3 align-top pr-3">
                        {m.notes ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="text-muted-foreground hover:text-foreground transition-colors">
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[220px] text-xs">
                              {m.notes}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="h-3.5 w-3.5 block" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>
        </div>

        {filtered.length > 0 && (
          <TablePagination
            total={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
            itemLabel="write-offs"
          />
        )}
      </div>

      <WriteOffDialog
        open={writeOffOpen}
        onOpenChange={setWriteOffOpen}
      />
    </div>
  );
}
