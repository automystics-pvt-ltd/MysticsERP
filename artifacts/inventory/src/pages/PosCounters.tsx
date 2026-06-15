import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { useListWarehouses } from "@/lib/queryKeys";
import {
  listCounters,
  createCounter,
  updateCounter,
  deactivateCounter,
  type PosCounter,
} from "@/lib/posSessionApi";
import { Plus, Pencil, PowerOff } from "lucide-react";

function emptyForm() {
  return { name: "", code: "", warehouseId: "" };
}

export default function PosCounters() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingCounter, setEditingCounter] = useState<PosCounter | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: counters = [], isLoading } = useQuery({
    queryKey: ["pos-counters", { includeInactive: true }],
    queryFn: () => listCounters(true),
  });

  const { data: warehouses = [] } = useListWarehouses();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pos-counters"] });

  const createMut = useMutation({
    mutationFn: createCounter,
    onSuccess: () => { invalidate(); setShowDialog(false); toast({ title: "Counter created" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateCounter>[1] }) =>
      updateCounter(id, body),
    onSuccess: () => { invalidate(); setShowDialog(false); toast({ title: "Counter updated" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  const deactivateMut = useMutation({
    mutationFn: deactivateCounter,
    onSuccess: () => { invalidate(); toast({ title: "Counter deactivated" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  function openCreate() {
    setEditingCounter(null);
    setForm(emptyForm());
    setShowDialog(true);
  }

  function openEdit(c: PosCounter) {
    setEditingCounter(c);
    setForm({ name: c.name, code: c.code, warehouseId: String(c.warehouseId) });
    setShowDialog(true);
  }

  function handleSubmit() {
    const warehouseId = Number(form.warehouseId);
    if (!form.name.trim() || !form.code.trim() || !warehouseId) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    if (editingCounter) {
      updateMut.mutate({ id: editingCounter.id, body: { name: form.name, code: form.code, warehouseId } });
    } else {
      createMut.mutate({ name: form.name, code: form.code, warehouseId });
    }
  }

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title">POS Counters</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage point-of-sale terminals and billing counters</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Counter
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                  Loading…
                </TableCell>
              </TableRow>
            ) : counters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                  No counters yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              counters.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono font-medium">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.warehouseName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.isActive ? "default" : "secondary"}>
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {c.isActive && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Deactivate "${c.name}"?`)) deactivateMut.mutate(c.id);
                          }}
                        >
                          <PowerOff className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCounter ? "Edit Counter" : "New Counter"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Counter Name *</Label>
              <Input
                placeholder="e.g. Counter 1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Code *</Label>
              <Input
                placeholder="e.g. C1"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Short unique identifier for this counter</p>
            </div>
            <div className="space-y-2">
              <Label>Warehouse *</Label>
              <Select
                value={form.warehouseId}
                onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? "Saving…" : editingCounter ? "Save Changes" : "Create Counter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
