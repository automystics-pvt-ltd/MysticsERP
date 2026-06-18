import { useState } from "react";
import { Can } from "@/components/Can";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { Package, Plus, ArrowRight, ExternalLink } from "lucide-react";
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";
import { useListWarehouses } from "@/lib/queryKeys";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Fulfillment {
  id: number;
  fulfillmentNumber: string;
  salesOrderId: number;
  orderNumber: string;
  shopifyOrderId: string | null;
  shipmentId: number | null;
  status: string;
  warehouseId: number;
  warehouseName: string;
  courierName: string | null;
  awbNumber: string | null;
  dispatchedAt: string | null;
  packedAt: string | null;
  pickedAt: string | null;
  createdAt: string;
}

interface SalesOrder {
  id: number;
  orderNumber: string;
  status: string;
  shopifyOrderId: string | null;
  warehouseId: number;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  picking: "Picking",
  picked: "Picked",
  packed: "Packed",
  dispatched: "Dispatched",
};

const STATUS_COLOR: Record<string, string> = {
  picking: "bg-yellow-100 text-yellow-800 border-yellow-200",
  picked: "bg-blue-100 text-blue-800 border-blue-200",
  packed: "bg-purple-100 text-purple-800 border-purple-200",
  dispatched: "bg-green-100 text-green-800 border-green-200",
};

function FulfillmentStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLOR[status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── New Fulfillment Dialog ───────────────────────────────────────────────────

function NewFulfillmentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");

  const { data: orders, isLoading: ordersLoading } = useQuery<SalesOrder[]>({
    queryKey: ["sales-orders-fulfillable"],
    queryFn: () =>
      customFetch<{ orders: SalesOrder[] }>("/api/sales-orders?status=confirmed,partially_shipped&pageSize=100&page=1").then(
        (res) => (res as unknown as { orders?: SalesOrder[] }).orders ?? [],
      ),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (orderId: number) =>
      customFetch<Fulfillment>(`/api/sales-orders/${orderId}/fulfillments`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data) => {
      toast({ title: `Fulfillment ${data.fulfillmentNumber} created` });
      onCreated(data.id);
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "Failed to create fulfillment";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!selectedOrderId) return;
    createMutation.mutate(Number(selectedOrderId));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setSelectedOrderId(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Fulfillment</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Select a confirmed sales order to begin the Pick → Pack → Dispatch workflow.
          </p>
          <div>
            <label className="text-sm font-medium mb-1 block">Sales Order</label>
            {ordersLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an order…" />
                </SelectTrigger>
                <SelectContent>
                  {(orders ?? []).length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No orders ready for fulfillment
                    </SelectItem>
                  ) : (
                    (orders ?? []).map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.orderNumber}
                        {o.shopifyOrderId ? " · Shopify" : ""}
                        {" · "}
                        <span className="capitalize">{o.status.replace("_", " ")}</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setSelectedOrderId(""); }}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!selectedOrderId || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Start Fulfillment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status filter options ─────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "picking", label: "Picking" },
  { value: "picked", label: "Picked" },
  { value: "packed", label: "Packed" },
  { value: "dispatched", label: "Dispatched" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Fulfillments() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { values, set, reset, debouncedSearch } = useListFilters({
    search: "",
    status: "all",
    warehouseId: "all",
  });

  const { data: warehouses = [] } = useListWarehouses();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warehouseOptions = (warehouses as any[]).map((w: any) => ({ value: String(w.id), label: w.name }));

  const { data, isLoading } = useQuery<Fulfillment[]>({
    queryKey: ["fulfillments", { search: debouncedSearch, status: values.status, warehouseId: values.warehouseId }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (values.status !== "all") qs.set("status", values.status);
      if (values.warehouseId !== "all") qs.set("warehouseId", values.warehouseId);
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const q = qs.toString();
      return customFetch<Fulfillment[]>(`/api/fulfillments${q ? `?${q}` : ""}`);
    },
  });

  const handleCreated = (id: number) => {
    qc.invalidateQueries({ queryKey: ["fulfillments"] });
    setDialogOpen(false);
    navigate(`/fulfillments/${id}`);
  };

  return (
    <>
      <PageHeader
        title="Fulfillments"
        description="Pick, pack, and dispatch orders"
        actions={
          <Can module="sales_orders" action="create">
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Fulfillment
            </Button>
          </Can>
        }
      />

      <div className="mb-4">
        <FilterBar
          search={values.search}
          onSearchChange={(v) => set("search", v)}
          searchPlaceholder="Search fulfillment # or order #…"
          filterDefs={[
            {
              key: "status",
              label: "Status",
              type: "select",
              options: STATUS_OPTIONS,
            },
            {
              key: "warehouseId",
              label: "Warehouse",
              type: "select",
              options: warehouseOptions,
            },
          ]}
          filterValues={values}
          onFilterChange={set}
          onReset={reset}
          data-testid="filter-bar-fulfillments"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fulfillment #</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Shopify</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>AWB</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                ))
              : (data ?? []).length === 0
              ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No fulfillments found</p>
                    <Button
                      variant="link"
                      className="mt-1 text-xs"
                      onClick={() => setDialogOpen(true)}
                    >
                      Start your first fulfillment
                    </Button>
                  </TableCell>
                </TableRow>
              )
              : (data ?? []).map((f) => (
                <TableRow
                  key={f.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/fulfillments/${f.id}`)}
                >
                  <TableCell className="font-medium">{f.fulfillmentNumber}</TableCell>
                  <TableCell>
                    <Link
                      href={`/sales-orders/${f.salesOrderId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary hover:underline"
                    >
                      {f.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {f.shopifyOrderId ? (
                      <Badge variant="outline" className="text-xs gap-1">
                        <ExternalLink className="h-3 w-3" />
                        {f.shopifyOrderId}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>{f.warehouseName}</TableCell>
                  <TableCell>
                    <FulfillmentStatus status={f.status} />
                  </TableCell>
                  <TableCell>
                    {f.awbNumber ? (
                      <span className="font-mono text-xs">{f.awbNumber}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(f.createdAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <NewFulfillmentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
