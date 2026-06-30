import { useEffect, useState } from "react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { useListWarehouses } from "@/lib/queryKeys";
import { listSessions, listCounters, type PosSession } from "@/lib/posSessionApi";
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";
import { useCanI } from "@/hooks/usePermissions";

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

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

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
  const canCreate = useCanI("pos", "create");

  const { values, set, reset, debouncedSearch } = useListFilters({
    search: "",
    status: "all",
    warehouseId: "all",
    counterId: "all",
    from: "",
    to: "",
  });

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [debouncedSearch, values.status, values.warehouseId, values.counterId, values.from, values.to]);

  const { data: warehouses = [] } = useListWarehouses();
  const { data: counters = [] } = useQuery({
    queryKey: ["pos-counters"],
    queryFn: () => listCounters(),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warehouseOptions = (warehouses as any[]).map((w: any) => ({ value: String(w.id), label: w.name }));
  const counterOptions = counters.map((c) => ({ value: String(c.id), label: c.name }));

  const params: Parameters<typeof listSessions>[0] = { page, pageSize };
  if (values.status !== "all") params.status = values.status;
  if (values.warehouseId !== "all") params.warehouseId = Number(values.warehouseId);
  if (values.counterId !== "all") params.counterId = Number(values.counterId);
  if (values.from) params.from = values.from;
  if (values.to) params.to = values.to + "T23:59:59";
  if (debouncedSearch) params.search = debouncedSearch;

  const { data, isLoading } = useQuery({
    queryKey: ["pos-sessions", { ...params }],
    queryFn: () => listSessions(params),
  });

  const sessions: PosSession[] = data?.sessions ?? [];
  const total = data?.total ?? 0;

  const openCount = sessions.filter((s) => s.status === "open").length;
  const pendingCount = sessions.filter((s) => s.status === "pending_approval").length;
  const approvedCount = sessions.filter((s) => s.status === "approved").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title">Day Closing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage cashier sessions and end-of-day cash reconciliation
          </p>
        </div>
        {canCreate && (
          <Link href="/pos/sessions/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Open Session
            </Button>
          </Link>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Clock} label="Open Sessions" value={openCount} color={openCount > 0 ? "text-green-600" : "text-foreground"} />
        <StatCard icon={AlertCircle} label="Awaiting Approval" value={pendingCount} color={pendingCount > 0 ? "text-amber-600" : "text-foreground"} />
        <StatCard icon={CheckCircle2} label="Approved" value={approvedCount} />
        <StatCard icon={CalendarDays} label="Total Shown" value={total} />
      </div>

      <FilterBar
        search={values.search}
        onSearchChange={(v) => set("search", v)}
        searchPlaceholder="Search session number…"
        filterDefs={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: STATUS_OPTIONS,
          },
          {
            key: "warehouseId",
            label: "Warehouse",
            type: "select",
            options: warehouseOptions,
          },
          {
            key: "counterId",
            label: "Counter",
            type: "select",
            options: counterOptions,
          },
          {
            key: "sessionDate",
            label: "Opened Date",
            type: "daterange",
            fromKey: "from",
            toKey: "to",
          },
        ]}
        filterValues={values}
        onFilterChange={set}
        onReset={reset}
        data-testid="filter-bar-pos-sessions"
      />

      {/* Pending approval banner */}
      {pendingCount > 0 && values.status === "all" && (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-600/30 dark:bg-amber-950/20 dark:text-amber-200 cursor-pointer"
          onClick={() => { set("status", "pending_approval"); setPage(1); }}
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
                  No sessions match the current filters.
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
