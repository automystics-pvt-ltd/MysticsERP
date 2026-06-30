import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@/lib/queryKeys";
import {
  getSession,
  getSessionReport,
  closeSession,
  approveSession,
  rejectSession,
  submitSession,
  resubmitSession,
  reopenSession,
  addExpense,
  deleteExpense,
  type PosSessionDetail as SessionDetail,
  type PosSessionReport,
} from "@/lib/posSessionApi";
import {
  ArrowLeft,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Lock,
  Plus,
  Trash2,
  Clock,
  TrendingUp,
  Banknote,
  AlertTriangle,
  RotateCcw,
  ShoppingBag,
  ChevronRight,
  ChevronLeft,
  Activity,
  Receipt,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

function fmtCash(v: string | number | null | undefined, prefix = "₹") {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  const formatted = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "−" : ""}${prefix}${formatted}`;
}

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card / POS Machine",
  upi: "UPI",
  bank: "Bank Transfer",
  other: "Other",
};

const MODE_COLORS: Record<string, string> = {
  cash: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  card: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  upi: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  bank: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  opened: "Session opened",
  closed: "Session closed by cashier",
  submitted: "Submitted for manager approval",
  approved: "Session approved",
  rejected: "Session rejected by manager",
  resubmitted: "Resubmitted for approval",
  reopened: "Session manually reopened",
  expense_added: "Expense recorded",
  expense_deleted: "Expense removed",
};

const EXPENSE_CATEGORIES = [
  "Transport",
  "Stationery",
  "Cleaning",
  "Electricity",
  "Refreshments",
  "Maintenance",
  "Other",
];

// ─── Close Session Wizard ─────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3;

function CloseWizard({
  open,
  onClose,
  report,
  sessionNotes,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  report: PosSessionReport | undefined;
  sessionNotes: string | null;
  onConfirm: (closingCash: number, notes: string) => void;
  isPending: boolean;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [closingCash, setClosingCash] = useState("");
  const [notes, setNotes] = useState(sessionNotes ?? "");
  const { toast } = useToast();

  const cashInput = Number(closingCash);
  const expected = report ? Number(report.expectedClosingCash) : 0;
  const liveVariance = closingCash !== "" && !isNaN(cashInput) ? cashInput - expected : null;
  const hasLargeVariance = liveVariance !== null && Math.abs(liveVariance) > 500;

  function reset() {
    setStep(1);
    setClosingCash("");
    setNotes(sessionNotes ?? "");
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit() {
    const v = Number(closingCash);
    if (isNaN(v) || v < 0) {
      toast({ title: "Enter a valid cash amount", variant: "destructive" });
      return;
    }
    onConfirm(v, notes.trim());
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Close Session
          </DialogTitle>
          <DialogDescription>
            Step {step} of 3 — {
              step === 1 ? "Review your session summary" :
              step === 2 ? "Count cash in drawer" :
              "Add remarks and confirm"
            }
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center gap-1.5 -mt-1">
          {([1, 2, 3] as WizardStep[]).map((s) => (
            <div
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                step >= s ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>

        {/* Step 1: Summary */}
        {step === 1 && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Orders</span>
                <span className="font-medium">{report?.activeOrders ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Sales</span>
                <span className="font-mono font-semibold">{report ? fmtCash(report.totalSales) : "—"}</span>
              </div>
              {report && Number(report.totalDiscounts) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Discounts Given</span>
                  <span className="font-mono text-amber-600">{fmtCash(report.totalDiscounts)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment Modes</span>
                <span />
              </div>
              {report?.paymentsByMode.map((p) => (
                <div key={p.mode} className="flex justify-between pl-3">
                  <span className="text-muted-foreground">{MODE_LABELS[p.mode] ?? p.mode}</span>
                  <span className="font-mono">{fmtCash(p.total)}</span>
                </div>
              ))}
              {report && Number(report.cashReturns) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cash Refunded (Cancellations)</span>
                  <span className="font-mono text-destructive">−{fmtCash(report.cashReturns)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expenses</span>
                <span className="font-mono text-destructive">{report ? fmtCash(report.totalExpenses) : "—"}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Expected Cash in Drawer</span>
                <span className="font-mono">{report ? fmtCash(report.expectedClosingCash) : "—"}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Review the above summary before proceeding to count physical cash.
            </p>
          </div>
        )}

        {/* Step 2: Cash count */}
        {step === 2 && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border bg-muted/30 p-3 flex justify-between text-sm items-center">
              <span className="text-muted-foreground">Expected cash in drawer</span>
              <span className="font-mono font-semibold">{report ? fmtCash(report.expectedClosingCash) : "—"}</span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="closing-cash">Actual Cash Counted (₹) *</Label>
              <Input
                id="closing-cash"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                autoFocus
              />
            </div>

            {liveVariance !== null && (
              <div className={cn(
                "flex items-center justify-between rounded-md px-4 py-3 text-sm",
                liveVariance >= 0
                  ? "border border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950/30 dark:text-green-200"
                  : hasLargeVariance
                    ? "border border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200"
                    : "border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
              )}>
                <div className="flex items-center gap-2">
                  {liveVariance >= 0
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : <AlertTriangle className="h-4 w-4" />}
                  <span className="font-medium">
                    {liveVariance >= 0 ? "Surplus" : "Shortage"}:{" "}
                    {fmtCash(Math.abs(liveVariance))}
                  </span>
                </div>
                {hasLargeVariance && liveVariance < 0 && (
                  <span className="text-xs">Large discrepancy — review before closing</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Remarks & confirm */}
        {step === 3 && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected</span>
                <span className="font-mono">{report ? fmtCash(report.expectedClosingCash) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Actual</span>
                <span className="font-mono">{fmtCash(Number(closingCash))}</span>
              </div>
              {liveVariance !== null && (
                <div className={cn(
                  "flex justify-between font-semibold",
                  liveVariance < 0 ? "text-destructive" : "text-green-600",
                )}>
                  <span>Variance</span>
                  <span className="font-mono">{liveVariance >= 0 ? "+" : "−"}{fmtCash(Math.abs(liveVariance))}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Cashier Remarks <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                rows={3}
                placeholder="Explain any discrepancy, unusual events, or notes for the manager…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Once closed, this session will be sent to a manager for approval.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as WizardStep)}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {step < 3 ? (
            <Button
              onClick={() => {
                if (step === 2) {
                  const v = Number(closingCash);
                  if (isNaN(v) || closingCash === "") {
                    toast({ title: "Enter the cash amount in drawer", variant: "destructive" });
                    return;
                  }
                }
                setStep((s) => (s + 1) as WizardStep);
              }}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isPending}>
              <Lock className="h-4 w-4 mr-2" />
              {isPending ? "Closing…" : "Close Session"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PosSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();

  const isManager = ["owner", "admin", "manager"].includes(me?.role ?? "");
  const isApprover = isManager;

  const { data: session, isLoading } = useQuery({
    queryKey: ["pos-session", sessionId],
    queryFn: () => getSession(sessionId),
    enabled: !!sessionId,
  });

  const { data: report } = useQuery({
    queryKey: ["pos-session-report", sessionId],
    queryFn: () => getSessionReport(sessionId),
    enabled: !!sessionId && !!session,
    refetchInterval: session?.status === "open" ? 30_000 : false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pos-session", sessionId] });
    qc.invalidateQueries({ queryKey: ["pos-session-report", sessionId] });
    qc.invalidateQueries({ queryKey: ["pos-sessions"] });
    qc.invalidateQueries({ queryKey: ["pos-session-active"] });
  };

  // Close wizard
  const [showClose, setShowClose] = useState(false);

  const closeMut = useMutation({
    mutationFn: (data: { closingCash: number; notes?: string }) =>
      closeSession(sessionId, data),
    onSuccess: () => {
      invalidate();
      setShowClose(false);
      toast({ title: "Session closed", description: "Awaiting manager approval" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  // Approve with remarks
  const [showApprove, setShowApprove] = useState(false);
  const [approvalRemarks, setApprovalRemarks] = useState("");

  const approveMut = useMutation({
    mutationFn: (remarks?: string) => approveSession(sessionId, { remarks }),
    onSuccess: () => {
      invalidate();
      setShowApprove(false);
      setApprovalRemarks("");
      toast({ title: "Session approved ✓" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  // Reject dialog
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const rejectMut = useMutation({
    mutationFn: (reason: string) => rejectSession(sessionId, { reason }),
    onSuccess: () => {
      invalidate();
      setShowReject(false);
      setRejectReason("");
      toast({ title: "Session rejected", description: "The cashier can review and resubmit." });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  // Submit for approval (cashier)
  const submitMut = useMutation({
    mutationFn: () => submitSession(sessionId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Submitted for approval", description: "A manager will review your session." });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  // Resubmit after rejection (cashier)
  const resubmitMut = useMutation({
    mutationFn: () => resubmitSession(sessionId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Resubmitted for approval" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  // Reopen (manager overrides approved)
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const reopenMut = useMutation({
    mutationFn: (reason: string) => reopenSession(sessionId, { reason }),
    onSuccess: () => {
      invalidate();
      setShowReopen(false);
      setReopenReason("");
      toast({ title: "Session reopened" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  // Expense dialog
  const [showExpense, setShowExpense] = useState(false);
  const [expLabel, setExpLabel] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expCategory, setExpCategory] = useState("");

  const addExpMut = useMutation({
    mutationFn: (data: { label: string; amount: number; category?: string }) =>
      addExpense(sessionId, data),
    onSuccess: () => {
      invalidate();
      setShowExpense(false);
      setExpLabel(""); setExpAmount(""); setExpCategory("");
      toast({ title: "Expense recorded" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  const delExpMut = useMutation({
    mutationFn: (expId: number) => deleteExpense(sessionId, expId),
    onSuccess: () => { invalidate(); toast({ title: "Expense removed" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (!session) {
    return <div className="text-center py-24 text-muted-foreground">Session not found.</div>;
  }

  const cashVarianceNum =
    report?.cashVariance !== null && report?.cashVariance !== undefined
      ? Number(report.cashVariance)
      : null;
  const variance = cashVarianceNum !== null ? Math.abs(cashVarianceNum) : null;
  const varianceIsGood = cashVarianceNum !== null && cashVarianceNum >= 0;
  const hasLargeShortage = cashVarianceNum !== null && cashVarianceNum < -500;

  const isOpen = session.status === "open";
  const isClosed = session.status === "closed";
  const isPendingApproval = session.status === "pending_approval";
  const isApproved = session.status === "approved";
  const isRejected = session.status === "rejected";

  const durationMs = session.closedAt
    ? new Date(session.closedAt).getTime() - new Date(session.openedAt).getTime()
    : Date.now() - new Date(session.openedAt).getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMins = Math.floor((durationMs % 3_600_000) / 60_000);
  const durationStr = durationHours > 0
    ? `${durationHours}h ${durationMins}m`
    : `${durationMins}m`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Link href="/pos/sessions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-page-title">{session.sessionNumber}</h1>
              <Badge variant={STATUS_VARIANT[session.status] ?? "secondary"}>
                {STATUS_LABELS[session.status] ?? session.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {session.cashierName ?? session.cashierEmail}
              {session.counterName ? ` · ${session.counterName}` : ""}
              {session.warehouseName ? ` · ${session.warehouseName}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isOpen && (
            <Button variant="outline" onClick={() => setShowExpense(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Expense
            </Button>
          )}
          {isOpen && (
            <Button onClick={() => setShowClose(true)}>
              <Lock className="h-4 w-4 mr-2" />
              Close Session
            </Button>
          )}
          {isClosed && (
            <Button
              onClick={() => submitMut.mutate()}
              disabled={submitMut.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {submitMut.isPending ? "Submitting…" : "Submit for Approval"}
            </Button>
          )}
          {isPendingApproval && isApprover && (
            <>
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/5"
                onClick={() => setShowReject(true)}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <Button onClick={() => setShowApprove(true)}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve
              </Button>
            </>
          )}
          {isRejected && (
            <Button
              variant="outline"
              onClick={() => resubmitMut.mutate()}
              disabled={resubmitMut.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {resubmitMut.isPending ? "Resubmitting…" : "Resubmit for Approval"}
            </Button>
          )}
          {isRejected && isApprover && (
            <Button
              variant="outline"
              className="text-muted-foreground"
              onClick={() => setShowReopen(true)}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reopen
            </Button>
          )}
          {isApproved && isApprover && (
            <Button
              variant="outline"
              className="text-muted-foreground"
              onClick={() => setShowReopen(true)}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* Rejection reason banner */}
      {session.rejectionReason && !isApproved && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-medium">Returned for correction: </span>
            {session.rejectionReason}
          </div>
        </div>
      )}

      {/* Cash discrepancy alert */}
      {!isOpen && cashVarianceNum !== null && hasLargeShortage && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-500" />
          <div>
            <span className="font-semibold">Large cash shortage: {fmtCash(variance)}</span>
            <span className="text-muted-foreground dark:text-red-300"> — This session has a significant cash discrepancy that requires manager attention.</span>
          </div>
        </div>
      )}

      {/* Approval info */}
      {isApproved && (
        <div className="flex items-start gap-2 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-950/30 dark:text-green-200">
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-500" />
          <div>
            <span className="font-medium">Approved by {session.approvedByName}</span>
            {session.approvedAt && <span className="text-muted-foreground dark:text-green-300"> on {fmt(session.approvedAt)}</span>}
            {session.approvalRemarks && (
              <div className="mt-1 text-muted-foreground dark:text-green-300">"{session.approvalRemarks}"</div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="overview" className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="sales" className="flex items-center gap-1.5">
            <ShoppingBag className="h-3.5 w-3.5" />
            Sales
            {report && report.activeOrders > 0 && (
              <span className="ml-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold px-1.5">
                {report.activeOrders}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Expenses
            {session.expenses.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold px-1.5">
                {session.expenses.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="log" className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* Key stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                  <Clock className="h-4 w-4" />
                  Session Timing
                </div>
                <div className="font-medium text-sm">{fmt(session.openedAt)}</div>
                {session.closedAt && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Closed {fmt(session.closedAt)}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  Duration: <span className="font-medium text-foreground">{durationStr}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                  <TrendingUp className="h-4 w-4" />
                  Total Sales
                </div>
                <div className="text-xl font-bold">
                  {report ? fmtCash(report.totalSales) : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {report ? `${report.activeOrders} order${report.activeOrders !== 1 ? "s" : ""}` : ""}
                  {report && Number(report.totalDiscounts) > 0 && (
                    <span className="ml-1 text-amber-600">· {fmtCash(report.totalDiscounts)} discounts</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                  <Banknote className="h-4 w-4" />
                  Cash Position
                </div>
                <div className="font-medium">{fmtCash(session.openingCash)}</div>
                <div className="text-xs text-muted-foreground mt-1">Opening cash</div>
                {session.closingCash !== null && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Closing: <span className="text-foreground font-medium">{fmtCash(session.closingCash)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                  {cashVarianceNum !== null && cashVarianceNum < 0
                    ? <AlertTriangle className="h-4 w-4 text-destructive" />
                    : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  Cash Variance
                </div>
                {cashVarianceNum !== null ? (
                  <>
                    <div className={cn(
                      "text-xl font-bold",
                      cashVarianceNum < 0 ? "text-destructive" : "text-green-600",
                    )}>
                      {cashVarianceNum >= 0 ? "+" : "−"}{fmtCash(variance)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Expected: {fmtCash(report?.expectedClosingCash)}
                    </div>
                  </>
                ) : (
                  <div className="font-medium text-muted-foreground">
                    {isOpen ? "Session open" : "—"}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payments by Mode</CardTitle>
                <CardDescription>Collections recorded during this session</CardDescription>
              </CardHeader>
              <CardContent>
                {!report || report.paymentsByMode.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No payments recorded yet</p>
                ) : (
                  <div className="space-y-3">
                    {report.paymentsByMode.map((p) => {
                      const pct = Number(report.totalSales) > 0
                        ? Math.round((Number(p.total) / Number(report.totalSales)) * 100)
                        : 0;
                      return (
                        <div key={p.mode} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                MODE_COLORS[p.mode] ?? MODE_COLORS.other,
                              )}>
                                {p.mode}
                              </span>
                              <span>{MODE_LABELS[p.mode] ?? p.mode}</span>
                            </div>
                            <span className="font-mono font-medium">{fmtCash(p.total)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <Separator />
                    <div className="flex items-center justify-between font-semibold text-sm">
                      <span>Total Collected</span>
                      <span className="font-mono">{fmtCash(report.totalSales)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cash reconciliation */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cash Reconciliation</CardTitle>
                <CardDescription>Expected vs actual cash in drawer</CardDescription>
              </CardHeader>
              <CardContent>
                {!report ? (
                  <p className="text-sm text-muted-foreground py-4">Loading…</p>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Opening Cash</span>
                      <span className="font-mono">{fmtCash(report.openingCash)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">+ Cash Sales</span>
                      <span className="font-mono">
                        {fmtCash(report.paymentsByMode.find((m) => m.mode === "cash")?.total ?? "0")}
                      </span>
                    </div>
                    {Number(report.totalExpenses) > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">− Expenses</span>
                        <span className="font-mono text-destructive">{fmtCash(report.totalExpenses)}</span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex items-center justify-between font-semibold">
                      <span>Expected in Drawer</span>
                      <span className="font-mono">{fmtCash(report.expectedClosingCash)}</span>
                    </div>
                    {report.actualClosingCash !== null && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Actual Counted</span>
                          <span className="font-mono">{fmtCash(report.actualClosingCash)}</span>
                        </div>
                        <div className={cn(
                          "flex items-center justify-between font-semibold rounded-md px-3 py-2",
                          cashVarianceNum !== null && cashVarianceNum < 0
                            ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                            : "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300",
                        )}>
                          <span className="flex items-center gap-1.5">
                            {cashVarianceNum !== null && cashVarianceNum < 0
                              ? <AlertTriangle className="h-3.5 w-3.5" />
                              : <CheckCircle2 className="h-3.5 w-3.5" />}
                            Variance
                          </span>
                          <span className="font-mono">
                            {cashVarianceNum !== null
                              ? `${cashVarianceNum >= 0 ? "+" : "−"}${fmtCash(variance)}`
                              : "—"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Session notes */}
          {session.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Cashier Remarks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{session.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Sales ───────────────────────────────────────────────────── */}
        <TabsContent value="sales" className="mt-6 space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5 text-sm">
                <div className="text-muted-foreground mb-1">Total Orders</div>
                <div className="text-2xl font-bold">{report?.activeOrders ?? "—"}</div>
                {report && report.cancelledOrders > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {report.cancelledOrders} cancelled
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 text-sm">
                <div className="text-muted-foreground mb-1">Gross Sales</div>
                <div className="text-2xl font-bold">{report ? fmtCash(report.totalSales) : "—"}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 text-sm">
                <div className="text-muted-foreground mb-1">Total Discounts Given</div>
                <div className={cn(
                  "text-2xl font-bold",
                  report && Number(report.totalDiscounts) > 0 ? "text-amber-600" : "",
                )}>
                  {report ? fmtCash(report.totalDiscounts) : "—"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top items */}
          {report && report.topItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Items Sold</CardTitle>
                <CardDescription>By quantity during this session</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qty Sold</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.topItems.map((item, idx) => (
                      <TableRow key={item.itemId}>
                        <TableCell className="text-muted-foreground text-sm w-8">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{item.itemName}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{item.itemSku}</TableCell>
                        <TableCell className="text-right font-mono">{Number(item.totalQty).toFixed(0)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtCash(item.totalAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Order list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Orders in this Session</CardTitle>
              <CardDescription>
                {report?.activeOrders ?? 0} order{(report?.activeOrders ?? 0) !== 1 ? "s" : ""}
                {report && Number(report.totalDiscounts) > 0 && " · discounts applied"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!report || report.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No orders recorded in this session yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <Link href={`/sales-orders/${o.id}`}>
                            <span className="font-mono font-medium text-primary hover:underline">
                              {o.orderNumber}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmt(o.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={o.status === "cancelled" ? "destructive" : "secondary"} className="text-xs">
                            {o.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{fmtCash(o.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Expenses ─────────────────────────────────────────────────── */}
        <TabsContent value="expenses" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Cash Expenses</CardTitle>
                <CardDescription>
                  Petty cash outflows recorded during this session
                  {session.expenses.length > 0 && (
                    <span className="ml-1">
                      · Total: <span className="font-semibold text-foreground">
                        {fmtCash(session.expenses.reduce((s, e) => s + Number(e.amount), 0))}
                      </span>
                    </span>
                  )}
                </CardDescription>
              </div>
              {isOpen && (
                <Button size="sm" variant="outline" onClick={() => setShowExpense(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {session.expenses.length === 0 ? (
                <div className="py-8 text-center">
                  <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No expenses recorded</p>
                  {isOpen && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => setShowExpense(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Record first expense
                    </Button>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      {isOpen && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {session.expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.label}</TableCell>
                        <TableCell>
                          {e.category ? (
                            <span className="inline-block rounded bg-muted px-2 py-0.5 text-xs">
                              {e.category}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmt(e.createdAt)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtCash(e.amount)}</TableCell>
                        {isOpen && (
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                if (confirm(`Delete expense "${e.label}"?`)) delExpMut.mutate(e.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit Log ────────────────────────────────────────────────── */}
        <TabsContent value="log" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit Trail</CardTitle>
              <CardDescription>Every action on this session, in order</CardDescription>
            </CardHeader>
            <CardContent>
              {session.auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-3.5 top-2 bottom-2 w-px bg-border" />
                  <div className="space-y-6">
                    {session.auditLogs.map((log, idx) => (
                      <div key={log.id} className="flex items-start gap-4 pl-8 relative">
                        <div className={cn(
                          "absolute left-0 top-1 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-background text-xs font-bold",
                          log.action === "approved"
                            ? "border-green-400 text-green-600"
                            : log.action === "rejected" || log.action === "reopened"
                              ? "border-amber-400 text-amber-600"
                              : log.action === "closed"
                                ? "border-blue-400 text-blue-600"
                                : "border-border text-muted-foreground",
                        )}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div>
                              <span className="font-medium text-sm">
                                {AUDIT_ACTION_LABELS[log.action] ?? log.action.replace(/_/g, " ")}
                              </span>
                              {log.performedByName && (
                                <span className="text-muted-foreground text-sm"> by {log.performedByName}</span>
                              )}
                            </div>
                            <time className="text-xs text-muted-foreground whitespace-nowrap">
                              {fmt(log.createdAt)}
                            </time>
                          </div>
                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <div className="mt-1 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 space-y-0.5">
                              {Object.entries(log.metadata)
                                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                                .map(([k, v]) => (
                                  <div key={k}>
                                    <span className="capitalize">{k.replace(/_/g, " ")}: </span>
                                    <span className="font-medium">{String(v)}</span>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Close Session Wizard ─────────────────────────────────────── */}
      <CloseWizard
        open={showClose}
        onClose={() => setShowClose(false)}
        report={report}
        sessionNotes={session.notes}
        onConfirm={(closingCash, notes) =>
          closeMut.mutate({ closingCash, notes: notes || undefined })
        }
        isPending={closeMut.isPending}
      />

      {/* ── Approve Dialog ───────────────────────────────────────────── */}
      <Dialog open={showApprove} onOpenChange={setShowApprove}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Session</DialogTitle>
            <DialogDescription>
              Review the reconciliation before approving.
            </DialogDescription>
          </DialogHeader>

          {report && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Sales</span>
                <span className="font-mono font-semibold">{fmtCash(report.totalSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expenses</span>
                <span className="font-mono">{fmtCash(report.totalExpenses)}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected Cash</span>
                <span className="font-mono">{fmtCash(report.expectedClosingCash)}</span>
              </div>
              {report.actualClosingCash !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Actual Cash</span>
                  <span className="font-mono">{fmtCash(report.actualClosingCash)}</span>
                </div>
              )}
              {cashVarianceNum !== null && (
                <div className={cn(
                  "flex justify-between font-semibold rounded px-2 py-1",
                  cashVarianceNum < 0 ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300",
                )}>
                  <span>Variance</span>
                  <span className="font-mono">{cashVarianceNum >= 0 ? "+" : "−"}{fmtCash(variance)}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Manager Remarks <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              rows={2}
              placeholder="Any notes about this approval…"
              value={approvalRemarks}
              onChange={(e) => setApprovalRemarks(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowApprove(false); setApprovalRemarks(""); }}>
              Cancel
            </Button>
            <Button
              onClick={() => approveMut.mutate(approvalRemarks.trim() || undefined)}
              disabled={approveMut.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {approveMut.isPending ? "Approving…" : "Approve Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Dialog ────────────────────────────────────────────── */}
      <Dialog open={showReject} onOpenChange={setShowReject}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Session</DialogTitle>
            <DialogDescription>
              The session will be marked as rejected. The cashier can review the reason and resubmit for approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Reason for Rejection *</Label>
            <Textarea
              rows={3}
              placeholder="What needs to be corrected? e.g. Cash amount doesn't match…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowReject(false); setRejectReason(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMut.isPending}
              onClick={() => rejectMut.mutate(rejectReason.trim())}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {rejectMut.isPending ? "Rejecting…" : "Reject Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reopen Dialog ────────────────────────────────────────────── */}
      <Dialog open={showReopen} onOpenChange={setShowReopen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reopen Approved Session</DialogTitle>
            <DialogDescription>
              This will reverse the approval and allow the session to be re-edited. Provide a reason for the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Reason *</Label>
            <Textarea
              rows={3}
              placeholder="Why is this approved session being reopened?"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowReopen(false); setReopenReason(""); }}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="text-amber-600 border-amber-300 hover:bg-amber-50"
              disabled={!reopenReason.trim() || reopenMut.isPending}
              onClick={() => reopenMut.mutate(reopenReason.trim())}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {reopenMut.isPending ? "Reopening…" : "Reopen Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Expense Dialog ───────────────────────────────────────── */}
      <Dialog open={showExpense} onOpenChange={setShowExpense}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Expense</DialogTitle>
            <DialogDescription>Cash paid out from the drawer during this session</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Description *</Label>
              <Input
                placeholder="e.g. Auto fare, Office supplies…"
                value={expLabel}
                onChange={(e) => setExpLabel(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Category <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="flex flex-wrap gap-2">
                {EXPENSE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setExpCategory(expCategory === cat ? "" : cat)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      expCategory === cat
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowExpense(false); setExpLabel(""); setExpAmount(""); setExpCategory(""); }}>
              Cancel
            </Button>
            <Button
              disabled={addExpMut.isPending}
              onClick={() => {
                if (!expLabel.trim()) {
                  toast({ title: "Enter a description", variant: "destructive" });
                  return;
                }
                const v = Number(expAmount);
                if (isNaN(v) || v <= 0) {
                  toast({ title: "Enter a valid amount", variant: "destructive" });
                  return;
                }
                addExpMut.mutate({
                  label: expLabel.trim(),
                  amount: v,
                  category: expCategory || undefined,
                });
              }}
            >
              {addExpMut.isPending ? "Saving…" : "Record Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
