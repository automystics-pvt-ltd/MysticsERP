import { useState } from "react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Plus,
  ArrowRight,
  CalendarDays,
  Clock,
  CheckCircle2,
  AlertCircle,
  Filter,
} from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { useListWarehouses } from "@/lib/queryKeys";
import { listSessions, listCounters, type PosSession } from "@/lib/posSessionApi";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default",
  closed: "secondary",
  pending_approval: "secondary",
  approved: "outline",
  rejected: "destructive",
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtCash(v: string | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function StatCard({
  icon: Icon,
  label,
  value,
  color = "text-foreground",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <Icon className={`h-4 w-4 flex-shrink-0 ${color}`} />
      <div>
        <div className={`text-xl font-bold leading-none ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

export default function PosSessionList() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [counterFilter, setCounterFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const { data: warehouses = [] } = useListWarehouses();
  const { data: counters = [] } = useQuery({
    queryKey: ["pos-counters"],
    queryFn: () => listCounters(),
  });

  const params: Parameters<typeof listSessions>[0] = { page, pageSize };
  if (statusFilter !== "all") params.status = statusFilter;
  if (warehouseFilter !== "all") params.warehouseId = Number(warehouseFilter);
  if (counterFilter !== "all") params.counterId = Number(counterFilter);
  if (from) params.from = from;
  if (to) params.to = to + "T23:59:59";

  const { data, isLoading } = useQuery({
    queryKey: ["pos-sessions", statusFilter, warehouseFilter, counterFilter, from, to, page, pageSize],
    queryFn: () => listSessions(params),
  });

  const sessions: PosSession[] = data?.sessions ?? [];
  const total = data?.total ?? 0;

  const openCount = sessions.filter((s) => s.status === "open").length;
  const pendingCount = sessions.filter((s) => s.status === "pending_approval").length;
  const approvedCount = sessions.filter((s) => s.status === "approved").length;
  const activeFilterCount = [
    statusFilter !== "all",
    warehouseFilter !== "all",
    counterFilter !== "all",
    !!from,
    !!to,
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  function resetPage() { setPage(1); }

  function clearFilters() {
    setStatusFilter("all");
    setWarehouseFilter("all");
    setCounterFilter("all");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title">Day Closing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage cashier sessions and end-of-day cash reconciliation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className={hasActiveFilters ? "border-primary text-primary" : ""}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Link href="/pos/sessions/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Open Session
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Clock} label="Open Sessions" value={openCount} color={openCount > 0 ? "text-green-600" : "text-foreground"} />
        <StatCard icon={AlertCircle} label="Awaiting Approval" value={pendingCount} color={pendingCount > 0 ? "text-amber-600" : "text-foreground"} />
        <StatCard icon={CheckCircle2} label="Approved" value={approvedCount} />
        <StatCard icon={CalendarDays} label="Total Shown" value={total} />
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Status</div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
              <SelectTrigger className="w-44 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="pending_approval">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Warehouse</div>
            <Select value={warehouseFilter} onValueChange={(v) => { setWarehouseFilter(v); resetPage(); }}>
              <SelectTrigger className="w-44 bg-background">
                <SelectValue placeholder="All Warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(warehouses as any[]).map((w: any) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Counter</div>
            <Select value={counterFilter} onValueChange={(v) => { setCounterFilter(v); resetPage(); }}>
              <SelectTrigger className="w-44 bg-background">
                <SelectValue placeholder="All Counters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Counters</SelectItem>
                {counters.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">From</div>
            <Input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); resetPage(); }}
              className="w-36 bg-background"
              max={to || todayISO()}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">To</div>
            <Input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); resetPage(); }}
              className="w-36 bg-background"
              min={from}
              max={todayISO()}
            />
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Pending approval banner */}
      {pendingCount > 0 && statusFilter === "all" && (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-600/30 dark:bg-amber-950/20 dark:text-amber-200 cursor-pointer"
          onClick={() => { setStatusFilter("pending_approval"); resetPage(); }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-500" />
          <span>
            <span className="font-semibold">{pendingCount} session{pendingCount !== 1 ? "s" : ""}</span>
            {" "}awaiting manager approval — click to filter
          </span>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session #</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead>Counter / Warehouse</TableHead>
              <TableHead>Opened</TableHead>
              <TableHead>Closed</TableHead>
              <TableHead className="text-right">Opening Cash</TableHead>
              <TableHead className="text-right">Closing Cash</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={8} cols={9} />
            ) : sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                  {hasActiveFilters
                    ? "No sessions match the current filters."
                    : "No sessions found. Open a session to start tracking."}
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((s: PosSession) => (
                <TableRow
                  key={s.id}
                  className={s.status === "pending_approval" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}
                >
                  <TableCell className="font-mono font-medium">{s.sessionNumber}</TableCell>
                  <TableCell>{s.cashierName ?? s.cashierEmail ?? `#${s.cashierId}`}</TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {s.counterName ? <span className="font-medium">{s.counterName}</span> : null}
                      {s.counterName && s.warehouseName ? <span className="text-muted-foreground"> · </span> : null}
                      {s.warehouseName ? <span className="text-muted-foreground">{s.warehouseName}</span> : "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{fmt(s.openedAt)}</TableCell>
                  <TableCell className="text-sm">{fmt(s.closedAt)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCash(s.openingCash)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCash(s.closingCash)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[s.status] ?? "secondary"}>
                      {STATUS_LABELS[s.status] ?? s.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/pos/sessions/${s.id}`}>
                      <Button size="sm" variant="ghost">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

      </div>

      <TablePagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        itemLabel="sessions"
      />
    </div>
  );
}
