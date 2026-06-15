import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetCurrentOrganization } from "@/lib/queryKeys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardList, Search } from "lucide-react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { AccessDenied } from "@/components/AccessDenied";
import { useMyPermissions } from "@/hooks/usePermissions";
import { format } from "date-fns";

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  items: "Items",
  warehouses: "Warehouses",
  barcodes: "Barcodes",
  write_offs: "Write-offs",
  sales_orders: "Sales Orders",
  customers: "Customers",
  pos: "POS",
  payments: "Payments",
  purchase_orders: "Purchase Orders",
  suppliers: "Suppliers",
  supplier_payments: "Supplier Payments",
  stock_transfers: "Stock Transfers",
  job_work: "Job Work",
  reports: "Reports",
  team: "Team",
  integrations: "Integrations",
  settings: "Settings",
  roles: "Roles",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  edit: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  delete: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  approve: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  settings: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  view: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  import: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  export: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  transfer: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

interface AuditEntry {
  id: number;
  module: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  description?: string;
  ipAddress?: string;
  createdAt: string;
  userId: number;
  actorName?: string | null;
  actorEmail?: string | null;
}

interface AuditResponse {
  data: AuditEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface TeamMember {
  id: number;
  userId: number;
  name?: string | null;
  email: string;
}

interface TeamMembersResponse {
  data: TeamMember[];
}

export default function AuditLog() {
  const { data: org } = useGetCurrentOrganization();
  const orgId = (org as { id?: number } | undefined)?.id;
  const { data: myPerms, isLoading: permsLoading } = useMyPermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const canView =
    myPerms?.isSuperAdmin || myPerms?.permissions["settings"]?.includes("view");

  const { data: membersData } = useQuery<TeamMembersResponse>({
    queryKey: ["team-members-for-filter", orgId],
    queryFn: async () => {
      const res = await fetch("/api/team/members", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
        credentials: "include",
      });
      if (!res.ok) return { data: [] };
      return res.json() as Promise<TeamMembersResponse>;
    },
    enabled: !!orgId && !!canView,
  });

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["audit-logs", orgId, page, search, moduleFilter, actorFilter, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search.trim()) params.set("search", search.trim());
      if (moduleFilter !== "all") params.set("module", moduleFilter);
      if (actorFilter !== "all") params.set("userId", actorFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const res = await fetch(`/api/audit-logs?${params}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load audit log");
      return res.json() as Promise<AuditResponse>;
    },
    enabled: !!orgId && !!canView,
  });

  function handleFilterChange(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1); };
  }

  if (permsLoading || !myPerms) {
    return <TableSkeleton />;
  }

  if (!canView) {
    return <AccessDenied description="You need Settings access to view the audit log." />;
  }

  const members = membersData?.data ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h1 className="text-page-title text-xl font-semibold">Audit Log</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Track all administrative actions across your workspace.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search description..."
            className="pl-8 w-52"
            data-testid="input-audit-search"
          />
        </div>
        <Select value={moduleFilter} onValueChange={handleFilterChange(setModuleFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All modules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modules</SelectItem>
            {Object.entries(MODULE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actorFilter} onValueChange={handleFilterChange(setActorFilter)}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All actors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.userId} value={String(m.userId)}>
                {m.name ?? m.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="w-40"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            placeholder="From date"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            className="w-40"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            placeholder="To date"
          />
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>IP Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? <TableSkeleton rows={10} cols={6} />
              : (data?.data ?? []).length === 0
              ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground text-sm">
                    No audit log entries found.
                  </TableCell>
                </TableRow>
              )
              : data?.data.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(entry.createdAt), "dd MMM yyyy HH:mm")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.actorName
                      ? <span title={entry.actorEmail ?? undefined}>{entry.actorName}</span>
                      : <span className="text-muted-foreground font-mono text-xs">{entry.actorEmail ?? `#${entry.userId}`}</span>
                    }
                  </TableCell>
                  <TableCell className="text-sm">
                    {MODULE_LABELS[entry.module] ?? entry.module}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={ACTION_COLORS[entry.action] ?? ""}
                    >
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-sm truncate">
                    {entry.description ?? `${entry.action} on ${entry.resourceType ?? entry.module}${entry.resourceId ? ` #${entry.resourceId}` : ""}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {entry.ipAddress ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        total={data?.pagination.total ?? 0}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        itemLabel="entries"
      />
    </div>
  );
}
