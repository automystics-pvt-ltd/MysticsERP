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
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { AccessDenied } from "@/components/AccessDenied";
import { useMyPermissions } from "@/hooks/usePermissions";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import { FilterBar } from "@/components/FilterBar";
import { useListFilters } from "@/hooks/use-list-filters";

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

  const { values, set, reset, debouncedSearch } = useListFilters({
    search: "",
    module: "all",
    actor: "all",
    from: "",
    to: "",
  });
  const moduleFilter = values.module;
  const actorFilter = values.actor;
  const fromDate = values.from;
  const toDate = values.to;

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
    queryKey: ["audit-logs", orgId, page, debouncedSearch, moduleFilter, actorFilter, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
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

  if (permsLoading || !myPerms) {
    return <TableSkeleton />;
  }

  if (!canView) {
    return <AccessDenied description="You need Settings access to view the audit log." />;
  }

  const members = membersData?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Track all administrative actions across your workspace."
      />

      <FilterBar
        search={values.search}
        onSearchChange={(v) => { set("search", v); setPage(1); }}
        searchPlaceholder="Search descriptions…"
        filterDefs={[
          {
            key: "module", label: "Module", type: "select",
            options: Object.entries(MODULE_LABELS).map(([k, v]) => ({ value: k, label: v })),
          },
          {
            key: "actor", label: "Actor", type: "select",
            options: members.map((m) => ({ value: String(m.userId), label: m.name ?? m.email })),
          },
          { key: "date", label: "Date range", type: "daterange", fromKey: "from", toKey: "to" },
        ]}
        filterValues={values}
        onFilterChange={(k, v) => { set(k, v); setPage(1); }}
        onReset={() => { reset(); setPage(1); }}
      />

      <div className="rounded-md border bg-card">
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
