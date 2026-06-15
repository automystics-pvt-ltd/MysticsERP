import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  write_offs: (id) => `/write-offs`,
  goods_receipts: (id) => `/purchase-orders`, // GRN links back to PO list
};

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  sent_back: { label: "Sent Back", variant: "outline" },
};

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
      const params = new URLSearchParams({ pageSize: "100" });
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
          <DialogDescription>This will approve the request and advance it to the next level (or fully approve if it's the last level).</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Approving..." : "Approve"}
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
          <DialogDescription>A comment is required to {action === "reject" ? "reject" : "send back"} this request.</DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Enter reason..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={action === "reject" ? "destructive" : "outline"}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !comment.trim()}
          >
            {mutation.isPending ? `${label}ing...` : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestTable({
  requests,
  isLoading,
  showActions,
  onRefetch,
}: {
  requests: ApprovalRequest[];
  isLoading: boolean;
  showActions: boolean;
  onRefetch: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<{ requestId: number; type: "approve" | "reject" | "send_back" } | null>(null);

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

  const toggleAll = () => {
    const pendingIds = requests.filter((r) => r.status === "pending").map((r) => r.id);
    if (selected.size === pendingIds.length) setSelected(new Set());
    else setSelected(new Set(pendingIds));
  };

  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">
        No approval requests found.
      </div>
    );
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-3">
      {showActions && selected.size > 0 && (
        <Can module="approvals" action="approve">
          <div className="flex items-center gap-3 rounded-lg bg-muted px-4 py-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button
              size="sm"
              onClick={() => bulkApprove.mutate([...selected])}
              disabled={bulkApprove.isPending}
            >
              <CheckSquare className="h-4 w-4 mr-1.5" />
              {bulkApprove.isPending ? "Approving..." : "Bulk Approve"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </Can>
      )}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {showActions && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={selected.size === pendingCount && pendingCount > 0}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead>Reference</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Age</TableHead>
              {showActions && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => {
              const sb = STATUS_BADGE[r.status] ?? { label: r.status, variant: "outline" as const };
              const href = MODULE_HREFS[r.module]?.(r.recordId) ?? "#";
              return (
                <TableRow key={r.id} className={cn(r.isOverdue && "bg-red-50/50 dark:bg-red-950/20")}>
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
                    <Link href={href} className="font-medium text-primary hover:underline">
                      {r.recordRef}
                    </Link>
                    {r.isOverdue && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                        <AlertCircle className="h-3 w-3" />
                        Overdue
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {MODULE_LABELS[r.module] ?? r.module}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Layers className="h-3 w-3" />
                      {r.currentLevel + 1}/{r.totalLevels}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={sb.variant}>{sb.label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                    </div>
                  </TableCell>
                  {showActions && r.status === "pending" && (
                    <TableCell>
                      <Can module="approvals" action="approve">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => setDialog({ requestId: r.id, type: "approve" })}
                            title="Approve"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                            onClick={() => setDialog({ requestId: r.id, type: "send_back" })}
                            title="Send Back"
                          >
                            <CornerDownLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDialog({ requestId: r.id, type: "reject" })}
                            title="Reject"
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </Can>
                    </TableCell>
                  )}
                  {showActions && r.status !== "pending" && <TableCell />}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {dialog?.type === "approve" && (
        <ApproveDialog requestId={dialog.requestId} onClose={() => setDialog(null)} />
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
  const [moduleFilter, setModuleFilter] = useState("all");
  const { data, isLoading, refetch } = useApprovalRequests(tab, moduleFilter);

  const requests = data?.requests ?? [];

  const overdueCount = requests.filter((r) => r.isOverdue).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending Approvals"
        description="Review and act on approval requests across all modules."
      />

      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{overdueCount}</strong> request{overdueCount > 1 ? "s are" : " is"} overdue based on SLA thresholds.
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All modules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modules</SelectItem>
            {Object.entries(MODULE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mine">My Queue</TabsTrigger>
          <TabsTrigger value="all">All Pending</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          <RequestTable
            requests={requests}
            isLoading={isLoading}
            showActions
            onRefetch={refetch}
          />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <RequestTable
            requests={requests}
            isLoading={isLoading}
            showActions
            onRefetch={refetch}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab moduleFilter={moduleFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HistoryTab({ moduleFilter }: { moduleFilter: string }) {
  const { data, isLoading } = useQuery<{ requests: ApprovalRequest[]; total: number }>({
    queryKey: ["approval-requests-history", moduleFilter],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "100" });
      if (moduleFilter && moduleFilter !== "all") params.set("module", moduleFilter);
      return customFetch(`/api/approval-requests?${params}`);
    },
  });

  const allRequests = data?.requests ?? [];
  const resolved = allRequests.filter((r) => r.status !== "pending");

  return (
    <RequestTable
      requests={resolved}
      isLoading={isLoading}
      showActions={false}
      onRefetch={() => {}}
    />
  );
}
