import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FilterBar } from "@/components/FilterBar";
import { TablePagination } from "@/components/TablePagination";
import { useListFilters } from "@/hooks/use-list-filters";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Can } from "@/components/Can";
import {
  CheckCircle2,
  XCircle,
  CornerDownLeft,
  AlertCircle,
  Clock,
  Layers,
  CheckSquare,
  ClipboardCheck,
  ListChecks,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const MODULE_LABELS: Record<string, string> = {
  purchase_orders: "Purchase Orders",
  stock_transfers: "Stock Transfers",
  supplier_payments: "Supplier Payments",
  write_offs: "Write-offs",
  goods_receipts: "Goods Receipts",
};

const MODULE_HREFS: Record<string, (id: number) => string> = {
  purchase_orders: (id) => `/purchase-orders/${id}`,
  stock_transfers: (id) => `/transfers/${id}`,
  supplier_payments: (id) => `/supplier-payments/${id}`,
  write_offs: () => `/write-offs`,
  goods_receipts: () => `/purchase-orders`,
};

const PAGE_SIZE_OPTIONS = [15, 25, 50];

interface ApprovalRequest {
  id: number;
  module: string;
  recordId: number;
  recordRef: string;
  currentLevel: number;
  totalLevels: number;
  status: string;
  submittedById: number;
  isOverdue: boolean;
  createdAt: string;
  resolvedAt: string | null;
  workflowId: number | null;
}

function useApprovalRequests(tab: string, moduleFilter: string) {
  const statusParam = tab === "mine" || tab === "all" ? "pending" : undefined;
  const assigneeParam = tab === "mine" ? "me" : undefined;

  return useQuery<{ requests: ApprovalRequest[]; total: number }>({
    queryKey: ["approval-requests", tab, moduleFilter],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "500" });
      if (statusParam) params.set("status", statusParam);
      if (assigneeParam) params.set("assignee", assigneeParam);
      if (moduleFilter && moduleFilter !== "all") params.set("module", moduleFilter);
      return customFetch(`/api/approval-requests?${params}`);
    },
    refetchInterval: 30000,
  });
}

function ApproveDialog({
  requestId,
  onClose,
}: {
  requestId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      customFetch(`/api/approval-requests/${requestId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
      queryClient.invalidateQueries({ queryKey: ["approval-notifications"] });
      toast({ title: "Request approved" });
      onClose();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve Request</DialogTitle>
          <DialogDescription>
            This will approve the request and advance it to the next level (or
            fully approve if it is the last level).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Approving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({
  requestId,
  action,
  onClose,
}: {
  requestId: number;
  action: "reject" | "send_back";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const endpoint = action === "reject" ? "reject" : "send-back";
  const label = action === "reject" ? "Reject" : "Send Back";

  const mutation = useMutation({
    mutationFn: () =>
      customFetch(`/api/approval-requests/${requestId}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
      queryClient.invalidateQueries({ queryKey: ["approval-notifications"] });
      toast({ title: `Request ${action === "reject" ? "rejected" : "sent back"}` });
      onClose();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} Request</DialogTitle>
          <DialogDescription>
            A comment is required to{" "}
            {action === "reject" ? "reject" : "send back"} this request.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Enter reason…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === "reject" ? "destructive" : "outline"}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !comment.trim()}
          >
            {mutation.isPending ? `${label}ing…` : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const COL_COUNT_WITH_ACTIONS = 7;
const COL_COUNT_NO_ACTIONS = 6;

function RequestTable({
  requests,
  isLoading,
  showActions,
  search,
}: {
  requests: ApprovalRequest[];
  isLoading: boolean;
  showActions: boolean;
  search: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<{
    requestId: number;
    type: "approve" | "reject" | "send_back";
  } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const bulkApprove = useMutation({
    mutationFn: (ids: number[]) =>
      customFetch("/api/approval-requests/bulk-approve", {
        method: "PATCH",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
      queryClient.invalidateQueries({ queryKey: ["approval-notifications"] });
      setSelected(new Set());
      toast({ title: `Bulk approved ${selected.size} request(s)` });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const q = search.toLowerCase().trim();
  const filtered = q
    ? requests.filter(
        (r) =>
          r.recordRef.toLowerCase().includes(q) ||
          (MODULE_LABELS[r.module] ?? r.module).toLowerCase().includes(q),
      )
    : requests;

  const total = filtered.length;
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const pendingIds = filtered.filter((r) => r.status === "pending").map((r) => r.id);
  const allPendingSelected =
    pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allPendingSelected) setSelected(new Set());
    else setSelected(new Set(pendingIds));
  };

  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const colSpan = showActions ? COL_COUNT_WITH_ACTIONS : COL_COUNT_NO_ACTIONS;

  return (
    <div className="space-y-4">
      {showActions && selected.size > 0 && (
        <Can module="approvals" action="approve">
          <div className="flex items-center gap-3 rounded-lg bg-muted px-4 py-2.5">
            <span className="text-sm font-medium text-foreground">
              {selected.size} selected
            </span>
            <Button
              size="sm"
              onClick={() => bulkApprove.mutate([...selected])}
              disabled={bulkApprove.isPending}
              data-testid="btn-bulk-approve"
            >
              <CheckSquare className="h-4 w-4 mr-1.5" />
              {bulkApprove.isPending ? "Approving…" : "Bulk Approve"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          </div>
        </Can>
      )}

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {showActions && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPendingSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all pending"
                    disabled={pendingIds.length === 0}
                  />
                </TableHead>
              )}
              <TableHead>Reference</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Age</TableHead>
              {showActions && <TableHead className="w-28">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={8} cols={colSpan} />
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="h-24 text-center text-muted-foreground"
                >
                  {q
                    ? "No requests match the current search."
                    : "No approval requests found."}
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((r) => {
                const href = MODULE_HREFS[r.module]?.(r.recordId) ?? "#";
                return (
                  <TableRow
                    key={r.id}
                    data-testid={`row-approval-${r.id}`}
                    className={cn(
                      r.isOverdue &&
                        "bg-red-50/50 dark:bg-red-950/20",
                    )}
                  >
                    {showActions && (
                      <TableCell>
                        {r.status === "pending" && (
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={() => toggleOne(r.id)}
                            aria-label={`Select ${r.recordRef}`}
                          />
                        )}
                      </TableCell>
                    )}

                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={href}
                          className="font-mono font-medium text-primary hover:underline"
                        >
                          {r.recordRef}
                        </Link>
                        {r.isOverdue && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] px-1.5 py-0 font-semibold"
                          >
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                            Overdue
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">
                      {MODULE_LABELS[r.module] ?? r.module}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Layers className="h-3 w-3 shrink-0" />
                        <span>
                          {r.currentLevel + 1}/{r.totalLevels}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" />
                        {formatDistanceToNow(new Date(r.createdAt), {
                          addSuffix: true,
                        })}
                      </div>
                    </TableCell>

                    {showActions && (
                      <TableCell>
                        {r.status === "pending" ? (
                          <Can module="approvals" action="approve">
                            <div className="flex items-center gap-0.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                                    onClick={() =>
                                      setDialog({ requestId: r.id, type: "approve" })
                                    }
                                    data-testid={`btn-approve-${r.id}`}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Approve</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                                    onClick={() =>
                                      setDialog({ requestId: r.id, type: "send_back" })
                                    }
                                    data-testid={`btn-send-back-${r.id}`}
                                  >
                                    <CornerDownLeft className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Send Back</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    onClick={() =>
                                      setDialog({ requestId: r.id, type: "reject" })
                                    }
                                    data-testid={`btn-reject-${r.id}`}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reject</TooltipContent>
                              </Tooltip>
                            </div>
                          </Can>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
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
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        itemLabel="requests"
      />

      {dialog?.type === "approve" && (
        <ApproveDialog
          requestId={dialog.requestId}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.type === "reject" || dialog?.type === "send_back") && (
        <ActionDialog
          requestId={dialog.requestId}
          action={dialog.type}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export default function PendingApprovals() {
  const [tab, setTab] = useState("mine");
  const { values, set, reset } = useListFilters({ search: "", module: "all" });

  const { data: mineData, isLoading: mineLoading } = useApprovalRequests(
    "mine",
    values.module,
  );
  const { data: allData, isLoading: allLoading } = useApprovalRequests(
    "all",
    values.module,
  );
  const { data: historyData, isLoading: historyLoading } = useQuery<{
    requests: ApprovalRequest[];
    total: number;
  }>({
    queryKey: ["approval-requests-history", values.module],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "500" });
      if (values.module && values.module !== "all")
        params.set("module", values.module);
      return customFetch(`/api/approval-requests?${params}`);
    },
  });

  const mineRequests = mineData?.requests ?? [];
  const allRequests = allData?.requests ?? [];
  const historyResolved = (historyData?.requests ?? []).filter(
    (r) => r.status !== "pending",
  );

  const overdueCount =
    tab === "mine"
      ? mineRequests.filter((r) => r.isOverdue).length
      : allRequests.filter((r) => r.isOverdue).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Review and act on approval requests across all modules."
      />

      {/* Summary stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ClipboardCheck className="h-4 w-4 shrink-0" />
            <span className="text-xs font-medium">My Queue</span>
          </div>
          <p
            className="text-2xl font-bold tabular-nums"
            data-testid="text-stat-value-my-queue"
          >
            {mineLoading ? "—" : mineRequests.length}
          </p>
        </div>

        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ListChecks className="h-4 w-4 shrink-0" />
            <span className="text-xs font-medium">All Pending</span>
          </div>
          <p
            className="text-2xl font-bold tabular-nums"
            data-testid="text-stat-value-all-pending"
          >
            {allLoading ? "—" : allRequests.length}
          </p>
        </div>
      </div>

      {/* Overdue banner */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{overdueCount}</strong> request
            {overdueCount !== 1 ? "s are" : " is"} overdue based on SLA
            thresholds.
          </span>
        </div>
      )}

      <FilterBar
        search={values.search}
        onSearchChange={(v) => set("search", v)}
        searchPlaceholder="Search by reference or module…"
        filterDefs={[
          {
            key: "module",
            label: "Module",
            type: "select",
            options: Object.entries(MODULE_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
        filterValues={values}
        onFilterChange={(k, v) => set(k, v)}
        onReset={reset}
        data-testid="filter-bar-approvals"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mine" data-testid="tab-mine">
            My Queue
            {!mineLoading && mineRequests.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-2 h-5 px-1.5 text-[10px] font-semibold"
              >
                {mineRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">
            All Pending
            {!allLoading && allRequests.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-2 h-5 px-1.5 text-[10px] font-semibold"
              >
                {allRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          <RequestTable
            requests={mineRequests}
            isLoading={mineLoading}
            showActions
            search={values.search}
          />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <RequestTable
            requests={allRequests}
            isLoading={allLoading}
            showActions
            search={values.search}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <RequestTable
            requests={historyResolved}
            isLoading={historyLoading}
            showActions={false}
            search={values.search}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
