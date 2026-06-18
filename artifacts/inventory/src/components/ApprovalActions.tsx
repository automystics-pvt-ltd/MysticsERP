import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@/lib/queryKeys";
import {
  CheckCircle2,
  XCircle,
  CornerUpLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ActionType = "approve" | "reject" | "send_back";

interface ApprovalAction {
  id: number;
  actorId: number;
  actorName: string | number;
  action: string;
  level: number;
  comment: string | null;
  createdAt: string;
}

interface ApprovalRequestEntry {
  id: number;
  status: string;
  currentLevel: number;
  totalLevels: number;
  submittedBy: string | number;
  submittedById: number;
  createdAt: string;
  resolvedAt: string | null;
  actions: ApprovalAction[];
}

interface Props {
  module: string;
  recordId: number;
  canApprove: boolean;
  onApproved?: () => void;
  onRejected?: () => void;
}

const ACTION_COLORS: Record<string, string> = {
  approve: "text-green-700 bg-green-50 border-green-200",
  reject: "text-red-700 bg-red-50 border-red-200",
  send_back: "text-orange-700 bg-orange-50 border-orange-200",
};

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  approve: CheckCircle2,
  reject: XCircle,
  send_back: CornerUpLeft,
};

const ACTION_LABELS: Record<string, string> = {
  approve: "Approved",
  reject: "Rejected",
  send_back: "Sent Back",
};

export function ApprovalActions({
  module,
  recordId,
  canApprove,
  onApproved,
  onRejected,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const [dialogAction, setDialogAction] = useState<ActionType | null>(null);
  const [comment, setComment] = useState("");

  const { data: historyData, refetch } = useQuery<{
    requests: ApprovalRequestEntry[];
  }>({
    queryKey: ["approval-history", module, recordId],
    queryFn: () =>
      customFetch(`/api/approval-history?module=${module}&recordId=${recordId}`),
    enabled: !!module && !!recordId,
    staleTime: 15_000,
  });

  const requests = historyData?.requests ?? [];
  const latestPending = requests.find((r) => r.status === "pending");

  const actionMutation = useMutation({
    mutationFn: async ({
      action,
      requestId,
      comment,
    }: {
      action: ActionType;
      requestId: number;
      comment: string;
    }) => {
      return customFetch(`/api/approval-requests/${requestId}/${action.replace("_", "-")}`, {
        method: "POST",
        body: JSON.stringify({ comment: comment || undefined }),
      });
    },
    onSuccess: (_, { action }) => {
      setDialogAction(null);
      setComment("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["approval-status", module, recordId] });
      queryClient.invalidateQueries({ queryKey: ["approval-history", module, recordId] });
      queryClient.invalidateQueries({ queryKey: ["approval-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
      toast({
        title:
          action === "approve"
            ? "Request approved"
            : action === "reject"
            ? "Request rejected"
            : "Request sent back",
      });
      if (action === "approve") onApproved?.();
      if (action === "reject" || action === "send_back") onRejected?.();
    },
    onError: (e) => {
      const msg =
        (e as { data?: { message?: string; error?: string } }).data?.message ??
        (e as { data?: { error?: string } }).data?.error ??
        "An error occurred";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  if (requests.length === 0 && !latestPending) return null;

  const needsComment = dialogAction === "reject" || dialogAction === "send_back";

  return (
    <div className="space-y-3">
      {latestPending && canApprove && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 flex-1">
            Awaiting your approval — Level {latestPending.currentLevel + 1} of{" "}
            {latestPending.totalLevels}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-orange-300 text-orange-700 hover:bg-orange-50"
              onClick={() => setDialogAction("send_back")}
            >
              <CornerUpLeft className="h-3 w-3 mr-1" />
              Send Back
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => setDialogAction("reject")}
            >
              <XCircle className="h-3 w-3 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              className="h-7 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setDialogAction("approve")}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Approve
            </Button>
          </div>
        </div>
      )}

      {requests.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showHistory ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Approval History ({requests.reduce((a, r) => a + r.actions.length, 0)} actions)
          </button>

          {showHistory && (
            <div className="mt-2 space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="rounded-lg border bg-muted/30 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Submitted by{" "}
                      <span className="font-medium text-foreground">
                        {req.submittedBy}
                      </span>{" "}
                      on {new Date(req.createdAt).toLocaleDateString()}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        req.status === "approved" && "border-green-300 text-green-700 bg-green-50",
                        req.status === "pending" && "border-amber-300 text-amber-700 bg-amber-50",
                        req.status === "rejected" && "border-red-300 text-red-700 bg-red-50",
                        req.status === "sent_back" && "border-orange-300 text-orange-700 bg-orange-50",
                      )}
                    >
                      {req.status === "sent_back" ? "Sent Back" : req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                    </Badge>
                  </div>
                  {req.actions.length > 0 && (
                    <div className="space-y-1.5">
                      {req.actions.map((action) => {
                        const Icon = ACTION_ICONS[action.action] ?? User;
                        return (
                          <div
                            key={action.id}
                            className={cn(
                              "flex items-start gap-2 rounded border p-2 text-xs",
                              ACTION_COLORS[action.action] ?? "bg-muted/50 border-border",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <span className="font-medium">{action.actorName}</span>
                              <span className="mx-1 opacity-70">
                                {ACTION_LABELS[action.action] ?? action.action}
                              </span>
                              <span className="opacity-60">
                                (Level {action.level + 1}) ·{" "}
                                {new Date(action.createdAt).toLocaleString()}
                              </span>
                              {action.comment && (
                                <p className="mt-0.5 opacity-80 italic">
                                  &ldquo;{action.comment}&rdquo;
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={!!dialogAction}
        onOpenChange={(open) => {
          if (!open) {
            setDialogAction(null);
            setComment("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {dialogAction === "approve"
                ? "Confirm Approval"
                : dialogAction === "reject"
                ? "Reject Request"
                : "Send Back for Revision"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {dialogAction === "approve"
                ? "Approve this request? This will advance it to the next stage or mark it fully approved."
                : dialogAction === "reject"
                ? "Reject this request. Please provide a reason — it will be visible to the submitter."
                : "Send this request back for revision. Please explain what changes are needed."}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="approval-comment">
                Comment{needsComment ? " (required)" : " (optional)"}
              </Label>
              <Textarea
                id="approval-comment"
                placeholder={
                  needsComment
                    ? "Explain your decision..."
                    : "Add a note (optional)..."
                }
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogAction(null);
                setComment("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant={
                dialogAction === "approve"
                  ? "default"
                  : dialogAction === "reject"
                  ? "destructive"
                  : "outline"
              }
              disabled={
                actionMutation.isPending ||
                (needsComment && !comment.trim())
              }
              onClick={() => {
                if (!dialogAction || !latestPending) return;
                actionMutation.mutate({
                  action: dialogAction,
                  requestId: latestPending.id,
                  comment,
                });
              }}
            >
              {actionMutation.isPending
                ? "Saving..."
                : dialogAction === "approve"
                ? "Approve"
                : dialogAction === "reject"
                ? "Reject"
                : "Send Back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
