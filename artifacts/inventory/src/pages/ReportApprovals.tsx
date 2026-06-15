import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { customFetch } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { ReportExportButton } from "@/components/ReportExportButton";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  Layers,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const MODULE_LABELS: Record<string, string> = {
  purchase_orders: "Purchase Orders",
  stock_transfers: "Stock Transfers",
  supplier_payments: "Supplier Payments",
  write_offs: "Write-offs",
  goods_receipts: "Goods Receipts",
};

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  sent_back: { label: "Sent Back", variant: "outline" },
};

interface ApprovalSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  sentBack: number;
  overdueCount: number;
  avgResolutionHours: number;
}

interface ModuleBreakdown {
  module: string;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface ApprovalRecord {
  id: number;
  module: string;
  recordRef: string;
  status: string;
  currentLevel: number;
  totalLevels: number;
  submittedBy: string;
  isOverdue: boolean;
  ageDays: number;
  resolutionHours: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface ApprovalReport {
  summary: ApprovalSummary;
  moduleBreakdown: ModuleBreakdown[];
  requests: ApprovalRecord[];
}

function StatCard({ icon: Icon, label, value, colorCls, testId }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  colorCls: string;
  testId?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", colorCls)}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground" data-testid={testId ? `text-stat-title-${testId}` : undefined}>{label}</p>
            <p className="text-2xl font-bold leading-none mt-0.5" data-testid={testId ? `text-stat-value-${testId}` : undefined}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportApprovals() {
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const params = new URLSearchParams();
  if (moduleFilter !== "all") params.set("module", moduleFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (fromDate) params.set("from", fromDate);
  if (toDate) params.set("to", toDate);

  const { data, isLoading } = useQuery<ApprovalReport>({
    queryKey: ["report-approvals", moduleFilter, statusFilter, fromDate, toDate],
    queryFn: () => customFetch(`/api/reports/approvals?${params}`),
  });

  const summary = data?.summary;
  const moduleBreakdown = data?.moduleBreakdown ?? [];
  const requests = data?.requests ?? [];

  const exportColumns = [
    { header: "ID", accessor: (r: ApprovalRecord) => r.id },
    { header: "Reference", accessor: (r: ApprovalRecord) => r.recordRef },
    { header: "Module", accessor: (r: ApprovalRecord) => MODULE_LABELS[r.module] ?? r.module },
    { header: "Status", accessor: (r: ApprovalRecord) => r.status },
    { header: "Level", accessor: (r: ApprovalRecord) => `${r.currentLevel + 1}/${r.totalLevels}` },
    { header: "Submitted By", accessor: (r: ApprovalRecord) => r.submittedBy },
    { header: "Age (days)", accessor: (r: ApprovalRecord) => r.ageDays },
    { header: "Resolution (hrs)", accessor: (r: ApprovalRecord) => r.resolutionHours ?? "" },
    { header: "Submitted At", accessor: (r: ApprovalRecord) => format(new Date(r.createdAt), "dd MMM yyyy") },
    { header: "Resolved At", accessor: (r: ApprovalRecord) => r.resolvedAt ? format(new Date(r.resolvedAt), "dd MMM yyyy") : "" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Analytics"
        description="Visibility into approval request trends, SLA compliance, and resolution times."
        actions={
          <ReportExportButton
            filename="approval-analytics"
            title="Approval Analytics Report"
            columns={exportColumns}
            rows={requests}
            disabled={requests.length === 0}
          />
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Layers}
          label="Total Requests"
          value={summary?.total ?? "—"}
          colorCls="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          testId="total"
        />
        <StatCard
          icon={Clock}
          label="Pending"
          value={summary?.pending ?? "—"}
          colorCls="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          testId="pending"
        />
        <StatCard
          icon={CheckCircle2}
          label="Approved"
          value={summary?.approved ?? "—"}
          colorCls="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          testId="approved"
        />
        <StatCard
          icon={XCircle}
          label="Rejected / Sent Back"
          value={(summary?.rejected ?? 0) + (summary?.sentBack ?? 0)}
          colorCls="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          testId="rejected"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          icon={AlertTriangle}
          label="SLA Overdue"
          value={summary?.overdueCount ?? "—"}
          colorCls="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
          testId="overdue"
        />
        <StatCard
          icon={TrendingUp}
          label="Avg Resolution Time"
          value={summary ? `${summary.avgResolutionHours}h` : "—"}
          colorCls="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
          testId="avg-resolution"
        />
      </div>

      {/* Module breakdown */}
      {moduleBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Breakdown by Module</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moduleBreakdown.map((m) => (
                  <TableRow key={m.module}>
                    <TableCell className="font-medium">{MODULE_LABELS[m.module] ?? m.module}</TableCell>
                    <TableCell className="text-right">{m.total}</TableCell>
                    <TableCell className="text-right text-amber-600">{m.pending}</TableCell>
                    <TableCell className="text-right text-green-600">{m.approved}</TableCell>
                    <TableCell className="text-right text-red-600">{m.rejected}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All modules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modules</SelectItem>
            {Object.entries(MODULE_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="sent_back">Sent Back</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
        </div>
        {(moduleFilter !== "all" || statusFilter !== "all" || fromDate || toDate) && (
          <Button variant="ghost" size="sm" onClick={() => { setModuleFilter("all"); setStatusFilter("all"); setFromDate(""); setToDate(""); }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Requests table */}
      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
      ) : requests.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">No approval requests found for the selected filters.</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Resolution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => {
                const sb = STATUS_BADGE[r.status] ?? { label: r.status, variant: "outline" as const };
                return (
                  <TableRow key={r.id} className={cn(r.isOverdue && "bg-red-50/50 dark:bg-red-950/20")}>
                    <TableCell className="font-medium">
                      {r.recordRef}
                      {r.isOverdue && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3" />
                          SLA
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {MODULE_LABELS[r.module] ?? r.module}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sb.variant}>{sb.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.currentLevel + 1}/{r.totalLevels}
                    </TableCell>
                    <TableCell className="text-sm">{r.submittedBy}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.resolutionHours !== null ? `${r.resolutionHours}h` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
