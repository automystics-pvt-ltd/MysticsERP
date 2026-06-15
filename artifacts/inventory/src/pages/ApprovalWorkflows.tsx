import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@/lib/queryKeys";
import { Plus, Pencil, Trash2, GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";

const APPROVABLE_MODULES = [
  { value: "purchase_orders", label: "Purchase Orders" },
  { value: "stock_transfers", label: "Stock Transfers" },
  { value: "supplier_payments", label: "Supplier Payments" },
  { value: "write_offs", label: "Write-offs" },
  { value: "goods_receipts", label: "Goods Receipts (GRN)" },
] as const;

type ApprovableModule = (typeof APPROVABLE_MODULES)[number]["value"];

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "accountant", label: "Accountant" },
];

interface ApprovalRule {
  id?: number;
  approverType: "role" | "user";
  approverValue: string;
  minAmount?: string;
  maxAmount?: string;
  slaHours?: number | null;
}

interface ApprovalWorkflow {
  id: number;
  module: string;
  name: string;
  isEnabled: boolean;
  slaThresholdDays: number;
  rules: ApprovalRule[];
  createdAt: string;
}

interface WorkflowForm {
  module: ApprovableModule | "";
  name: string;
  isEnabled: boolean;
  slaThresholdDays: number;
  rules: ApprovalRule[];
}

const DEFAULT_FORM: WorkflowForm = {
  module: "",
  name: "",
  isEnabled: true,
  slaThresholdDays: 3,
  rules: [{ approverType: "role", approverValue: "manager" }],
};

function useApprovalWorkflows() {
  return useQuery<{ workflows: ApprovalWorkflow[] }>({
    queryKey: ["approval-workflows"],
    queryFn: () => customFetch("/api/approval-workflows"),
  });
}

export default function ApprovalWorkflowsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useApprovalWorkflows();
  const workflows = data?.workflows ?? [];

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form, setForm] = useState<WorkflowForm>(DEFAULT_FORM);

  const createMutation = useMutation({
    mutationFn: (body: WorkflowForm) =>
      customFetch("/api/approval-workflows", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
      setSheetOpen(false);
      setForm(DEFAULT_FORM);
      toast({ title: "Workflow created" });
    },
    onError: (e) => {
      const msg = (e as { data?: { error?: string } }).data?.error ?? "Failed to create workflow";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<WorkflowForm> }) =>
      customFetch(`/api/approval-workflows/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
      setSheetOpen(false);
      setEditingId(null);
      toast({ title: "Workflow updated" });
    },
    onError: (e) => {
      const msg = (e as { data?: { error?: string } }).data?.error ?? "Failed to update workflow";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: number; isEnabled: boolean }) =>
      customFetch(`/api/approval-workflows/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/approval-workflows/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
      setDeletingId(null);
      toast({ title: "Workflow deleted" });
    },
    onError: (e) => {
      const msg = (e as { data?: { error?: string } }).data?.error ?? "Failed to delete";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  function openNew() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setSheetOpen(true);
  }

  function openEdit(wf: ApprovalWorkflow) {
    setEditingId(wf.id);
    setForm({
      module: wf.module as ApprovableModule,
      name: wf.name,
      isEnabled: wf.isEnabled,
      slaThresholdDays: wf.slaThresholdDays,
      rules: wf.rules.length > 0 ? wf.rules : [{ approverType: "role", approverValue: "manager" }],
    });
    setSheetOpen(true);
  }

  function handleSubmit() {
    if (!form.module) {
      toast({ title: "Select a module", variant: "destructive" });
      return;
    }
    if (!form.name.trim()) {
      toast({ title: "Enter a workflow name", variant: "destructive" });
      return;
    }
    if (form.rules.length === 0) {
      toast({ title: "Add at least one approval level", variant: "destructive" });
      return;
    }
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, body: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function addLevel() {
    if (form.rules.length >= 5) return;
    setForm((f) => ({
      ...f,
      rules: [...f.rules, { approverType: "role", approverValue: "manager" }],
    }));
  }

  function removeLevel(idx: number) {
    setForm((f) => ({ ...f, rules: f.rules.filter((_, i) => i !== idx) }));
  }

  function updateLevel(idx: number, patch: Partial<ApprovalRule>) {
    setForm((f) => ({
      ...f,
      rules: f.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  }

  const moduleLabel = (m: string) =>
    APPROVABLE_MODULES.find((x) => x.value === m)?.label ?? m;

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Workflows"
        description="Configure which transactions require approval before taking effect."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Workflow
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configured Workflows</CardTitle>
          <CardDescription>
            Each module can have one workflow with up to 5 sequential approval levels.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : workflows.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No approval workflows configured yet.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={openNew}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Create your first workflow
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Levels</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((wf) => (
                  <TableRow key={wf.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {moduleLabel(wf.module)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{wf.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {wf.rules.length} level{wf.rules.length !== 1 ? "s" : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {wf.slaThresholdDays}d
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={wf.isEnabled}
                        onCheckedChange={(v) =>
                          toggleMutation.mutate({ id: wf.id, isEnabled: v })
                        }
                        disabled={toggleMutation.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(wf)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeletingId(wf.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit sheet */}
      <Sheet open={sheetOpen} onOpenChange={(v) => { if (!v) { setSheetOpen(false); setEditingId(null); } }}>
        <SheetContent className="w-full sm:max-w-[520px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editingId !== null ? "Edit Workflow" : "New Approval Workflow"}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            {/* Module */}
            <div className="space-y-1.5">
              <Label>Module</Label>
              <Select
                value={form.module}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, module: v as ApprovableModule }))
                }
                disabled={editingId !== null}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a module…" />
                </SelectTrigger>
                <SelectContent>
                  {APPROVABLE_MODULES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <Label>Workflow Name</Label>
              <Input
                placeholder="e.g. Purchase Order Approval"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* SLA */}
            <div className="space-y-1.5">
              <Label>SLA Threshold (days)</Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={form.slaThresholdDays}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    slaThresholdDays: Math.max(1, Number(e.target.value) || 3),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Requests pending longer than this will be marked overdue.
              </p>
            </div>

            {/* Enabled */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Enabled</p>
                <p className="text-xs text-muted-foreground">
                  Disable to suspend approvals for this module without deleting the workflow.
                </p>
              </div>
              <Switch
                checked={form.isEnabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isEnabled: v }))}
              />
            </div>

            {/* Approval Levels */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Approval Levels</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLevel}
                  disabled={form.rules.length >= 5}
                  className="h-7"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Level
                </Button>
              </div>
              <div className="space-y-2">
                {form.rules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border bg-muted/20 p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Level {idx + 1}
                      </span>
                      {form.rules.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLevel(idx)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Approver type</Label>
                        <Select
                          value={rule.approverType}
                          onValueChange={(v) =>
                            updateLevel(idx, {
                              approverType: v as "role" | "user",
                              approverValue: v === "role" ? "manager" : "",
                            })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="role">By Role</SelectItem>
                            <SelectItem value="user">Specific User ID</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          {rule.approverType === "role" ? "Role" : "User ID"}
                        </Label>
                        {rule.approverType === "role" ? (
                          <Select
                            value={rule.approverValue}
                            onValueChange={(v) => updateLevel(idx, { approverValue: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="h-8 text-xs"
                            placeholder="e.g. 42"
                            value={rule.approverValue}
                            onChange={(e) =>
                              updateLevel(idx, { approverValue: e.target.value })
                            }
                          />
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Min amount (₹, optional)</Label>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          min={0}
                          placeholder="0"
                          value={rule.minAmount ?? ""}
                          onChange={(e) =>
                            updateLevel(idx, {
                              minAmount: e.target.value || undefined,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max amount (₹, optional)</Label>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          min={0}
                          placeholder="∞"
                          value={rule.maxAmount ?? ""}
                          onChange={(e) =>
                            updateLevel(idx, {
                              maxAmount: e.target.value || undefined,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">SLA (hours, optional)</Label>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        min={1}
                        max={8760}
                        placeholder="e.g. 24, 48, 72"
                        value={rule.slaHours ?? ""}
                        onChange={(e) =>
                          updateLevel(idx, {
                            slaHours: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                          })
                        }
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Overrides the workflow-level SLA for this approval level. Leave blank to use the workflow default.
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Levels are sequential — each must be approved before the next is activated. Up to 5 levels.
              </p>
            </div>
          </div>

          <SheetFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => { setSheetOpen(false); setEditingId(null); }}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? "Saving…" : editingId !== null ? "Save Changes" : "Create Workflow"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(v) => { if (!v) setDeletingId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the workflow and all its approval rules. Any in-progress approval requests for this module will no longer advance automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId !== null && deleteMutation.mutate(deletingId)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
