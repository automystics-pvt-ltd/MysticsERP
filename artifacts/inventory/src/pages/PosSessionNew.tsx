import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useListWarehouses } from "@/lib/queryKeys";
import { listCounters, openSession } from "@/lib/posSessionApi";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function PosSessionNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [warehouseId, setWarehouseId] = useState("");
  const [counterId, setCounterId] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [notes, setNotes] = useState("");

  const { data: warehouses = [] } = useListWarehouses();

  const { data: counters = [] } = useQuery({
    queryKey: ["pos-counters"],
    queryFn: () => listCounters(false),
  });

  const filteredCounters = warehouseId
    ? counters.filter((c) => c.warehouseId === Number(warehouseId))
    : counters;

  const openMut = useMutation({
    mutationFn: openSession,
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ["pos-sessions"] });
      qc.invalidateQueries({ queryKey: ["pos-session-active"] });
      toast({ title: "Session opened", description: `Session ${session.sessionNumber} is now active` });
      navigate(`/pos/sessions/${session.id}`);
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e.data?.error ?? "Please try again.", variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) {
      toast({ title: "Select a warehouse", variant: "destructive" });
      return;
    }
    openMut.mutate({
      warehouseId: Number(warehouseId),
      counterId: counterId ? Number(counterId) : null,
      openingCash: Math.max(0, Number(openingCash) || 0),
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center gap-3">
        <Link href="/pos/sessions">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-page-title">Open Session</h1>
          <p className="text-sm text-muted-foreground mt-1">Start a new cashier shift</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Warehouse *</Label>
              <Select
                value={warehouseId}
                onValueChange={(v) => { setWarehouseId(v); setCounterId(""); }}
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

            <div className="space-y-2">
              <Label>Counter <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select
                value={counterId}
                onValueChange={setCounterId}
                disabled={filteredCounters.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={filteredCounters.length === 0 ? "No counters for this warehouse" : "Select counter"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredCounters.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Opening Cash (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Amount of cash in the drawer at session start</p>
            </div>

            <div className="space-y-2">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                placeholder="Any notes about this session…"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Link href="/pos/sessions">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={openMut.isPending}>
                {openMut.isPending ? "Opening…" : "Open Session"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
