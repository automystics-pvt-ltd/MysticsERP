import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, CheckCircle2, XCircle, CornerUpLeft, AlertTriangle } from "lucide-react";
import { customFetch } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "sent_back";

interface ApprovalInfo {
  requestId: number;
  status: ApprovalStatus;
  currentLevel: number;
  totalLevels: number;
  isOverdue: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

interface Props {
  module: string;
  recordId: number;
  className?: string;
}

const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; icon: React.ComponentType<{ className?: string }>; variant: string }
> = {
  pending: {
    label: "Pending Approval",
    icon: Clock,
    variant: "amber",
  },
  approved: {
    label: "Approved",
    icon: CheckCircle2,
    variant: "green",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    variant: "red",
  },
  sent_back: {
    label: "Sent Back",
    icon: CornerUpLeft,
    variant: "orange",
  },
};

export function ApprovalStatusBadge({ module, recordId, className }: Props) {
  const { data } = useQuery<{ approval: ApprovalInfo | null }>({
    queryKey: ["approval-status", module, recordId],
    queryFn: () =>
      customFetch(`/api/approval-status?module=${module}&recordId=${recordId}`),
    enabled: !!module && !!recordId,
    staleTime: 30_000,
  });

  const approval = data?.approval;
  if (!approval) return null;

  const config = STATUS_CONFIG[approval.status];
  const Icon = config.icon;

  const variantClasses: Record<string, string> = {
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    green: "bg-green-100 text-green-800 border-green-200",
    red: "bg-red-100 text-red-800 border-red-200",
    orange: "bg-orange-100 text-orange-800 border-orange-200",
  };

  const tooltipText =
    approval.status === "pending"
      ? `Level ${approval.currentLevel + 1} of ${approval.totalLevels} — ${approval.isOverdue ? "Overdue" : "Awaiting approver"}`
      : `${config.label}${approval.resolvedAt ? ` on ${new Date(approval.resolvedAt).toLocaleDateString()}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            variantClasses[config.variant],
            approval.isOverdue && approval.status === "pending" && "ring-1 ring-amber-400",
            className,
          )}
        >
          {approval.isOverdue && approval.status === "pending" ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <Icon className="h-3 w-3" />
          )}
          {approval.isOverdue && approval.status === "pending"
            ? "Overdue"
            : config.label}
          {approval.status === "pending" && approval.totalLevels > 1 && (
            <span className="opacity-60">
              {approval.currentLevel + 1}/{approval.totalLevels}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
