import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetCurrentOrganization } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RotateCcw, Save, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { AccessDenied } from "@/components/AccessDenied";
import { useMyPermissions } from "@/hooks/usePermissions";

interface PermCell {
  granted: boolean;
  isOverride: boolean;
}

interface MatrixResponse {
  modules: string[];
  actions: string[];
  moduleLabels: Record<string, string>;
  actionLabels: Record<string, string>;
  roles: string[];
  matrix: Record<string, Record<string, Record<string, PermCell>>>;
}

interface PendingChange {
  role: string;
  module: string;
  action: string;
  granted: boolean;
  isDefault: boolean;
}

interface AuditEntry {
  id: number;
  actorId: number;
  role: string;
  module: string;
  action: string;
  oldGranted: boolean | null;
  newGranted: boolean | null;
  isReset: boolean;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
}

interface AuditLogResponse {
  data: AuditEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  accountant: "Accountant",
  salesman: "Salesman",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  manager: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  accountant: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  salesman: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  viewer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const MODULE_GROUPS: Array<{ label: string; modules: string[] }> = [
  { label: "Overview", modules: ["dashboard"] },
  { label: "Inventory", modules: ["items", "warehouses", "barcodes", "write_offs"] },
  { label: "Sales", modules: ["sales_orders", "customers", "pos", "payments"] },
  { label: "Purchasing", modules: ["purchase_orders", "suppliers", "supplier_payments"] },
  { label: "Operations", modules: ["stock_transfers", "job_work"] },
  { label: "Approvals", modules: ["approvals"] },
  { label: "Insights", modules: ["reports"] },
  { label: "Workspace", modules: ["team", "integrations", "settings", "roles"] },
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function moduleLabel(mod: string) {
  return mod
    .split("_")
    .map((w) => capitalize(w))
    .join(" ");
}

function ChangeHistoryTab({ orgId }: { orgId: number }) {
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, isError, refetch } = useQuery<AuditLogResponse>({
    queryKey: ["role-permissions-audit-log", orgId, page],
    queryFn: async () => {
      const res = await fetch(
        `/api/role-permissions/audit-log?page=${page}&limit=${limit}`,
        {
          headers: { "x-organization-id": String(orgId) },
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error("Failed to load change history");
      return res.json() as Promise<AuditLogResponse>;
    },
    enabled: !!orgId,
  });

  const totalPages = data?.pagination.totalPages ?? 1;
  const total = data?.pagination.total ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <p className="text-sm text-muted-foreground">Failed to load change history.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">No permission changes recorded yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Changes will appear here whenever role permissions are updated or reset.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead className="w-44">Changed By</TableHead>
              <TableHead>What Changed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((entry) => (
                <TableRow key={entry.id} className="align-top">
                  <TableCell className="text-xs text-muted-foreground pt-3">
                    {formatDateTime(entry.createdAt)}
                  </TableCell>
                  <TableCell className="pt-3">
                    <p className="text-sm font-medium leading-tight">
                      {entry.actorName ?? "Unknown"}
                    </p>
                    {entry.actorEmail && (
                      <p className="text-xs text-muted-foreground">
                        {entry.actorEmail}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    {entry.isReset ? (
                      <p className="text-sm text-muted-foreground italic pt-1">
                        Reset all permissions to defaults
                      </p>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
                        <span
                          className={cn(
                            "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                            ROLE_COLORS[entry.role]?.includes("purple")
                              ? "bg-purple-500"
                              : ROLE_COLORS[entry.role]?.includes("blue")
                                ? "bg-blue-500"
                                : ROLE_COLORS[entry.role]?.includes("green")
                                  ? "bg-green-500"
                                  : ROLE_COLORS[entry.role]?.includes("amber")
                                    ? "bg-amber-500"
                                    : ROLE_COLORS[entry.role]?.includes("orange")
                                      ? "bg-orange-500"
                                      : "bg-gray-400",
                          )}
                        />
                        <span className="font-medium">
                          {ROLE_LABELS[entry.role] ?? capitalize(entry.role)}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span>{moduleLabel(entry.module)}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{capitalize(entry.action)}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "px-1 py-0 text-[10px] leading-4",
                            entry.oldGranted === true
                              ? "bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300"
                              : entry.oldGranted === false
                                ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300"
                                : "bg-muted text-muted-foreground border-transparent",
                          )}
                        >
                          {entry.oldGranted === null ? "Default" : entry.oldGranted ? "Granted" : "Revoked"}
                        </Badge>
                        <span className="text-muted-foreground">→</span>
                        <Badge
                          variant={entry.newGranted === true ? "default" : "outline"}
                          className={cn(
                            "px-1 py-0 text-[10px] leading-4",
                            entry.newGranted === true
                              ? "bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300"
                              : entry.newGranted === false
                                ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300"
                                : "bg-muted text-muted-foreground border-transparent",
                          )}
                        >
                          {entry.newGranted === null ? "Default" : entry.newGranted ? "Granted" : "Revoked"}
                        </Badge>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? "entry" : "entries"} total
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-7 w-7 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="h-7 w-7 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RolePermissionsPanel() {
  const { data: org } = useGetCurrentOrganization();
  const orgId = (org as { id?: number } | undefined)?.id;
  const { data: myPerms, isLoading: permsLoading } = useMyPermissions();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedRole, setSelectedRole] = useState<string>("manager");
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [hasChanges, setHasChanges] = useState(false);

  const canManage =
    myPerms?.isSuperAdmin ||
    myPerms?.permissions["roles"]?.includes("settings") ||
    myPerms?.permissions["roles"]?.includes("view");

  const canEdit =
    myPerms?.isSuperAdmin ||
    myPerms?.permissions["roles"]?.includes("settings");

  const { data: matrix, isLoading } = useQuery<MatrixResponse>({
    queryKey: ["role-permissions", orgId],
    queryFn: async () => {
      const res = await fetch("/api/role-permissions", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load permissions matrix");
      return res.json() as Promise<MatrixResponse>;
    },
    enabled: !!orgId && !!canManage,
  });

  const saveMutation = useMutation({
    mutationFn: async (changes: PendingChange[]) => {
      const res = await fetch("/api/role-permissions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ overrides: changes }),
      });
      if (!res.ok) throw new Error("Failed to save permissions");
      return res.headers.get("X-Permissions-Updated") === "1";
    },
    onSuccess: (permissionsUpdated) => {
      setPendingChanges(new Map());
      setHasChanges(false);
      qc.invalidateQueries({ queryKey: ["role-permissions", orgId] });
      if (permissionsUpdated) {
        qc.invalidateQueries({ queryKey: ["permissions", "me", orgId] });
      }
      qc.invalidateQueries({ queryKey: ["role-permissions-audit-log", orgId] });
      toast({ title: "Permissions updated — changes take effect immediately." });
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/role-permissions/reset", {
        method: "DELETE",
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to reset permissions");
      return res.headers.get("X-Permissions-Updated") === "1";
    },
    onSuccess: () => {
      setPendingChanges(new Map());
      setHasChanges(false);
      qc.invalidateQueries({ queryKey: ["role-permissions", orgId] });
      qc.invalidateQueries({ queryKey: ["permissions", "me", orgId] });
      qc.invalidateQueries({ queryKey: ["role-permissions-audit-log", orgId] });
      toast({ title: "Permissions reset — changes take effect immediately." });
    },
    onError: () => {
      toast({ title: "Failed to reset", variant: "destructive" });
    },
  });

  function getCell(role: string, module: string, action: string): PermCell {
    const pendingKey = `${role}:${module}.${action}`;
    if (pendingChanges.has(pendingKey)) {
      return pendingChanges.get(pendingKey)! as unknown as PermCell;
    }
    return matrix?.matrix[role]?.[module]?.[action] ?? { granted: false, isOverride: false };
  }

  function toggleCell(role: string, module: string, action: string) {
    if (!canEdit || role === "owner") return;
    const current = getCell(role, module, action);
    const original = matrix?.matrix[role]?.[module]?.[action];
    const newGranted = !current.granted;
    const key = `${role}:${module}.${action}`;
    const newMap = new Map(pendingChanges);

    if (original && original.granted === newGranted && !original.isOverride) {
      newMap.set(key, { role, module, action, granted: newGranted, isDefault: true });
    } else {
      newMap.set(key, { role, module, action, granted: newGranted, isDefault: false });
    }
    setPendingChanges(newMap);
    setHasChanges(true);
  }

  function handleSave() {
    saveMutation.mutate([...pendingChanges.values()]);
  }

  function handleDiscard() {
    setPendingChanges(new Map());
    setHasChanges(false);
  }

  if (permsLoading || !myPerms) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canManage) {
    return <AccessDenied description="You need the Roles & Permissions privilege to access this section." />;
  }

  const actions = matrix?.actions ?? [];
  const moduleLabels = matrix?.moduleLabels ?? {};
  const actionLabels = matrix?.actionLabels ?? {};

  return (
    <Tabs defaultValue="permissions" className="flex flex-col gap-6">
      <TabsList className="w-fit">
        <TabsTrigger value="permissions">Permissions</TabsTrigger>
        <TabsTrigger value="history">Change History</TabsTrigger>
      </TabsList>

      <TabsContent value="permissions" className="mt-0 flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">
          Configure what each role can access and do within your workspace.
          Changes apply immediately after saving.
        </p>

        <div className="flex flex-wrap gap-2">
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <button
              key={role}
              type="button"
              onClick={() => setSelectedRole(role)}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-all border",
                selectedRole === role
                  ? `${ROLE_COLORS[role]} border-transparent shadow-sm`
                  : "bg-background border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
              {role === "owner" && (
                <span className="ml-1.5 text-xs opacity-60">(full access)</span>
              )}
            </button>
          ))}
        </div>

        {selectedRole === "owner" && (
          <div className="flex items-start gap-3 rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm dark:border-purple-800 dark:bg-purple-950/30">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400" />
            <div>
              <p className="font-medium text-purple-900 dark:text-purple-200">Owner has full access</p>
              <p className="text-purple-700 dark:text-purple-400 mt-0.5">
                The Owner role always has access to all modules and actions and cannot be restricted.
              </p>
            </div>
          </div>
        )}

        {hasChanges && canEdit && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              You have unsaved permission changes for {ROLE_LABELS[selectedRole]}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleDiscard}>
                Discard
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                Save Changes
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {MODULE_GROUPS.map((group) => {
              const groupModules = group.modules.filter((m) =>
                (matrix?.modules ?? []).includes(m),
              );
              if (groupModules.length === 0) return null;

              return (
                <div key={group.label} className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </span>
                  </div>
                  <div className="divide-y">
                    {groupModules.map((mod) => {
                      const modLabel = moduleLabels[mod] ?? mod;
                      return (
                        <div key={mod} className="grid grid-cols-[180px_1fr] items-center">
                          <div className="flex items-center gap-2 px-4 py-3 border-r">
                            <span className="text-sm font-medium">{modLabel}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3">
                            {actions.map((action) => {
                              const cell = getCell(selectedRole, mod, action);
                              const isOwner = selectedRole === "owner";
                              const isPending = pendingChanges.has(`${selectedRole}:${mod}.${action}`);

                              return (
                                <div
                                  key={action}
                                  className="flex items-center gap-2 min-w-[110px]"
                                >
                                  <Switch
                                    checked={cell.granted}
                                    onCheckedChange={() => toggleCell(selectedRole, mod, action)}
                                    disabled={isOwner || !canEdit}
                                    className={cn(
                                      isPending && "ring-2 ring-amber-400 ring-offset-1",
                                    )}
                                    aria-label={`${actionLabels[action] ?? action} ${modLabel}`}
                                  />
                                  <span
                                    className={cn(
                                      "text-xs",
                                      cell.granted
                                        ? "text-foreground"
                                        : "text-muted-foreground",
                                      isPending && "font-medium text-amber-600 dark:text-amber-400",
                                    )}
                                  >
                                    {actionLabels[action] ?? action}
                                    {cell.isOverride && !isPending && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" />
                                        </TooltipTrigger>
                                        <TooltipContent>Custom override</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {canEdit && (
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Reset to defaults</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Remove all custom overrides and restore the built-in permission matrix for all roles.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset All
            </Button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="history" className="mt-0">
        {orgId ? (
          <ChangeHistoryTab orgId={orgId} />
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
