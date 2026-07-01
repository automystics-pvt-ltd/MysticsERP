import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { WriteOffDialog } from "@/components/WriteOffDialog";
import {
  useListWarehouses,
  useCreateWarehouse,
  useUpdateWarehouse,
  useDeleteWarehouse,
  getListWarehousesQueryKey,
  useGetShopifyConnection,
  useListShopifyLocations,
  getListShopifyLocationsQueryKey,
  useListStockMovements,
  useListStockTransfers,
  getListStockMovementsQueryKey,
  fetchWarehouseStockSummaries,
  type Warehouse,
  type WarehouseStockSummary,
} from "@/lib/queryKeys";
import {
  useGetStockTransfer,
  getGetStockTransferQueryKey,
  useCreateStockTransfer,
  useDispatchStockTransfer,
  useCompleteStockTransfer,
  getListStockTransfersQueryKey,
  type StockTransferDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/Can";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Edit,
  Trash2,
  Store,
  LayoutGrid,
  LayoutList,
  Search,
  MapPin,
  Building2,
  Star,
  Package,
  Eye,
  ArrowRightLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  History,
  ChevronRight,
  Boxes,
  FileDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  X,
  CheckCircle2,
  Clock,
  Ban,
  RefreshCw,
  MoveRight,
  Loader2,
} from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
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
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { motion } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────

const UNMAPPED = "__unmapped__";
const CARD_PAGE_SIZE = 9;
const LIST_PAGE_SIZE = 15;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const warehouseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  isDefault: z.boolean().default(false),
  shopifyLocationId: z.string().optional(),
});
type WarehouseFormValues = z.infer<typeof warehouseSchema>;

type ViewMode = "card" | "list";
type SortKey = "name_asc" | "name_desc" | "units_desc" | "units_asc" | "skus_desc";

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatAddress(w: Warehouse): string {
  return [w.addressLine1, w.city, w.state, w.country].filter(Boolean).join(", ");
}

function formatCityState(w: Warehouse): string {
  return [w.city, w.state].filter(Boolean).join(", ");
}

function warehouseInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  const content = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

type HueConfig = {
  avatar: string;
  headerBg: string;
};

function warehouseHueConfig(code: string): HueConfig {
  const configs: HueConfig[] = [
    { avatar: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", headerBg: "bg-gradient-to-br from-blue-50 to-blue-50/40 dark:from-blue-950/30 dark:to-transparent" },
    { avatar: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", headerBg: "bg-gradient-to-br from-violet-50 to-violet-50/40 dark:from-violet-950/30 dark:to-transparent" },
    { avatar: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", headerBg: "bg-gradient-to-br from-emerald-50 to-emerald-50/40 dark:from-emerald-950/30 dark:to-transparent" },
    { avatar: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", headerBg: "bg-gradient-to-br from-amber-50 to-amber-50/40 dark:from-amber-950/30 dark:to-transparent" },
    { avatar: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", headerBg: "bg-gradient-to-br from-rose-50 to-rose-50/40 dark:from-rose-950/30 dark:to-transparent" },
    { avatar: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300", headerBg: "bg-gradient-to-br from-cyan-50 to-cyan-50/40 dark:from-cyan-950/30 dark:to-transparent" },
  ];
  let n = 0;
  for (let i = 0; i < code.length; i++) n += code.charCodeAt(i);
  return configs[n % configs.length]!;
}

const MOVEMENT_LABELS: Record<string, string> = {
  opening: "Opening Stock", adjustment: "Adjustment", sale: "Sale",
  purchase: "Purchase", transfer_in: "Transfer In", transfer_out: "Transfer Out",
  transfer_cancelled: "Transfer Cancelled", sales_return: "Sales Return",
  purchase_return: "Purchase Return", shipment_cancelled: "Shipment Cancelled",
  goods_receipt_cancelled: "GRN Cancelled", job_work_issue: "Job Work Issue",
  job_work_receipt: "Job Work Receipt", job_work_receipt_cancel: "Job Work Receipt Cancel",
  job_work_scrap: "Job Work Scrap", shopify_order: "Shopify Order", shopify_reserve: "Shopify Reserved",
  shopify_sync: "Shopify Sync", shopify_webhook: "Shopify Update", damage: "Damage Write-off",
};

const SYSTEM_WAREHOUSE_CODES = new Set(["MAIN", "SHOPIFY", "POS"]);
function isSystemWarehouse(w: { isSystem?: boolean; code?: string }): boolean {
  return !!w.isSystem || SYSTEM_WAREHOUSE_CODES.has((w.code ?? "").toUpperCase());
}

function movementIsInbound(type: string, quantity: number): boolean {
  const inTypes = ["purchase","transfer_in","opening","sales_return","shipment_cancelled","goods_receipt_cancelled","transfer_cancelled","job_work_receipt"];
  if (inTypes.includes(type)) return true;
  if (type === "adjustment") return quantity >= 0;
  return false;
}

function transferStatusBadge(status: string) {
  const cfg: Record<string, { icon: React.ElementType; cls: string; label: string }> = {
    completed: { icon: CheckCircle2, cls: "text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20", label: "Completed" },
    in_transit: { icon: RefreshCw, cls: "text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-800/40 dark:bg-blue-900/20", label: "In Transit" },
    draft: { icon: Clock, cls: "text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-800/40 dark:bg-amber-900/20", label: "Draft" },
    cancelled: { icon: Ban, cls: "text-muted-foreground", label: "Cancelled" },
  };
  const c = cfg[status] ?? cfg["draft"]!;
  return (
    <Badge variant="outline" className={cn("text-xs gap-1 capitalize", c.cls)}>
      <c.icon className="h-3 w-3" />
      {c.label}
    </Badge>
  );
}

// ─── Summary bar ───────────────────────────────────────────────────────────────

function WarehouseSummaryBar({ warehouses, stockSummaries, loading }: { warehouses: Warehouse[]; stockSummaries: WarehouseStockSummary[]; loading: boolean }) {
  const physicalWarehouses = warehouses.filter((w) => !w.isVirtual);
  const totalUnits = stockSummaries.reduce((s, x) => s + x.totalUnits, 0);
  const totalItems = stockSummaries.reduce((s, x) => s + x.totalItems, 0);
  const pendingIn = stockSummaries.reduce((s, x) => s + x.pendingInUnits, 0);
  const stats = [
    { label: "Locations", value: physicalWarehouses.length, icon: Building2, bg: "bg-primary/8 dark:bg-primary/15", iconColor: "text-primary", vl: false },
    { label: "Total Units", value: totalUnits.toLocaleString(), icon: Boxes, bg: "bg-emerald-100 dark:bg-emerald-900/30", iconColor: "text-emerald-600 dark:text-emerald-400", vl: loading },
    { label: "Distinct SKUs", value: totalItems.toLocaleString(), icon: Package, bg: "bg-blue-100 dark:bg-blue-900/30", iconColor: "text-blue-600 dark:text-blue-400", vl: loading },
    { label: "Units In Transit", value: pendingIn.toLocaleString(), icon: ArrowRightLeft, bg: "bg-violet-100 dark:bg-violet-900/30", iconColor: "text-violet-600 dark:text-violet-400", vl: loading },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-border/60 bg-card px-4 py-3.5 flex items-center gap-3.5 shadow-sm">
          <div className={cn("h-10 w-10 shrink-0 rounded-lg flex items-center justify-center", s.bg)}>
            <s.icon className={cn("h-5 w-5", s.iconColor)} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground leading-none">{s.label}</p>
            {s.vl ? <Skeleton className="h-6 w-14 mt-1.5" /> : <p className="text-xl font-bold tracking-tight mt-0.5 leading-none">{s.value}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, loading, colorClass }: { label: string; value: string | number; icon: React.ElementType; loading?: boolean; colorClass?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 flex items-start gap-3">
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", colorClass ?? "bg-muted")}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground leading-none">{label}</p>
        {loading ? <Skeleton className="h-5 w-12 mt-1.5" /> : <p className="text-lg font-bold leading-tight tracking-tight mt-1">{value}</p>}
      </div>
    </div>
  );
}

// ─── Warehouse card ────────────────────────────────────────────────────────────

function WarehouseCard({ warehouse, summary, summaryLoading, shopifyConnected, onEdit, onDelete, onView, index }: {
  warehouse: Warehouse; summary?: WarehouseStockSummary; summaryLoading: boolean;
  shopifyConnected: boolean; onEdit: (w: Warehouse) => void; onDelete: (w: Warehouse) => void;
  onView: (w: Warehouse) => void; index: number;
}) {
  const cityState = formatCityState(warehouse);
  const address = formatAddress(warehouse);
  const { avatar, headerBg } = warehouseHueConfig(warehouse.code);
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: index * 0.04, ease: "easeOut" }}>
      <Card className="group relative flex flex-col overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer border-border/70 bg-card" data-testid={`card-warehouse-${warehouse.id}`} onClick={() => onView(warehouse)}>
        <div className={cn("px-5 pt-4 pb-3.5", headerBg)}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn("h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-sm font-bold ring-2 ring-white/60 dark:ring-black/20 shadow-sm", avatar)}>
                {warehouseInitials(warehouse.name)}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-[15px] leading-tight truncate text-foreground">{warehouse.name}</p>
                <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{warehouse.code}</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onClick={(e) => e.stopPropagation()}>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-2.5 text-muted-foreground min-h-[1.1rem]">
            <MapPin className="h-3 w-3 shrink-0 opacity-60" />
            <span className="text-xs leading-none truncate">{cityState || address || <span className="italic opacity-50">No location set</span>}</span>
          </div>
        </div>
        <CardContent className="flex flex-col gap-3 p-5 pt-3.5 flex-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30 px-3 py-2.5 text-center">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-emerald-600 dark:text-emerald-400">Available</p>
              {summaryLoading ? <Skeleton className="h-5 w-10 mx-auto mt-1" /> : <p className="text-[17px] font-bold text-emerald-700 dark:text-emerald-300 mt-0.5 leading-none tabular-nums">{summary ? summary.totalUnits.toLocaleString() : "0"}</p>}
              <p className="text-[9px] text-emerald-600/60 dark:text-emerald-400/60 mt-0.5">units</p>
            </div>
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30 px-3 py-2.5 text-center">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-blue-600 dark:text-blue-400">Items</p>
              {summaryLoading ? <Skeleton className="h-5 w-10 mx-auto mt-1" /> : <p className="text-[17px] font-bold text-blue-700 dark:text-blue-300 mt-0.5 leading-none tabular-nums">{summary ? summary.totalItems.toLocaleString() : "0"}</p>}
              <p className="text-[9px] text-blue-600/60 dark:text-blue-400/60 mt-0.5">SKUs</p>
            </div>
          </div>
          {summary && (summary.pendingInUnits > 0 || summary.pendingOutUnits > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {summary.pendingInUnits > 0 && <Badge variant="outline" className="gap-1 text-[10px] font-semibold text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800/40"><TrendingUp className="h-2.5 w-2.5" />+{summary.pendingInUnits} incoming</Badge>}
              {summary.pendingOutUnits > 0 && <Badge variant="outline" className="gap-1 text-[10px] font-semibold text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-800/40"><TrendingDown className="h-2.5 w-2.5" />-{summary.pendingOutUnits} outgoing</Badge>}
            </div>
          )}
          <div className="flex items-center justify-between pt-2.5 border-t border-border/50 mt-auto">
            <div className="flex flex-wrap items-center gap-1.5">
              {warehouse.isDefault && <Badge variant="secondary" className="gap-1 text-[10px] font-semibold"><Star className="h-2.5 w-2.5" />Default</Badge>}
              {isSystemWarehouse(warehouse) && <Badge variant="outline" className="gap-1 text-[10px] font-semibold text-muted-foreground">System</Badge>}
              {shopifyConnected && warehouse.shopifyLocationName ? <Badge variant="outline" className="gap-1 text-[10px] font-normal" data-testid={`cell-warehouse-shopify-${warehouse.id}`}><Store className="h-2.5 w-2.5" />{warehouse.shopifyLocationName}</Badge> : shopifyConnected ? <span className="text-[10px] text-muted-foreground" data-testid={`cell-warehouse-shopify-${warehouse.id}`}>Not mapped</span> : null}
            </div>
            <button type="button" className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:text-primary/70 transition-colors shrink-0" onClick={(e) => { e.stopPropagation(); onView(warehouse); }} data-testid={`btn-view-warehouse-${warehouse.id}`}>View <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <Card className="overflow-hidden border-border/70">
      <div className="px-5 pt-4 pb-3.5 bg-muted/30">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl shrink-0" />
          <div className="space-y-1.5 flex-1"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-14" /></div>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5"><Skeleton className="h-3 w-3 rounded-full" /><Skeleton className="h-3 w-32" /></div>
      </div>
      <CardContent className="flex flex-col gap-3 p-5 pt-3.5">
        <div className="grid grid-cols-2 gap-2"><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-16 w-full rounded-lg" /></div>
        <div className="flex items-center justify-between pt-2.5 border-t border-border/50 mt-1"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-10" /></div>
      </CardContent>
    </Card>
  );
}

// ─── Transfer Detail Modal ─────────────────────────────────────────────────────

function TransferDetailModal({
  transferId,
  warehouseId,
  defaultWarehouse,
  currentWarehouse,
  open,
  onOpenChange,
}: {
  transferId: number | null;
  warehouseId: number;
  defaultWarehouse: Warehouse | undefined;
  currentWarehouse: Warehouse | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [writeOffOpen, setWriteOffOpen] = useState(false);

  const { data, isLoading } = useGetStockTransfer(transferId!, {
    query: { enabled: open && !!transferId } as any,
  });

  const transfer = data?.transfer;
  const lines = data?.lines ?? [];

  const isInbound = transfer ? transfer.toWarehouseId === warehouseId : false;

  const handleExportLines = () => {
    if (!transfer || !lines.length) return;
    downloadCSV(
      `transfer-${transfer.transferNumber}-lines.csv`,
      ["Item", "SKU", "Quantity"],
      lines.map((l) => [l.itemName, l.sku, l.quantity]),
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <ArrowRightLeft className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </span>
              Transfer Details
            </DialogTitle>
            <DialogDescription>All products and quantities in this transfer.</DialogDescription>
          </DialogHeader>

          {isLoading || !transfer ? (
            <div className="flex flex-col gap-3 py-6">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-40 w-full mt-2 rounded-lg" />
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 space-y-4 pr-1">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Transfer #</p>
                  <p className="font-mono font-bold text-sm">{transfer.transferNumber}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Status</p>
                  {transferStatusBadge(transfer.status)}
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">From</p>
                  <p className="text-sm font-medium">{transfer.fromWarehouseName}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">To</p>
                  <p className="text-sm font-medium">{transfer.toWarehouseName}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Date</p>
                  <p className="text-sm">{format(new Date(transfer.transferDate), "dd MMM yyyy")}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Direction</p>
                  <div className="flex items-center gap-1.5 text-sm">
                    {isInbound ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <TrendingDown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
                    <span className={isInbound ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-amber-700 dark:text-amber-400 font-medium"}>{isInbound ? "Inbound" : "Outbound"}</span>
                  </div>
                </div>
                {transfer.notes && (
                  <div className="col-span-2 space-y-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Notes</p>
                    <p className="text-sm text-muted-foreground">{transfer.notes}</p>
                  </div>
                )}
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">{lines.length} item{lines.length !== 1 ? "s" : ""} transferred</p>
                  <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleExportLines}>
                    <FileDown className="h-3.5 w-3.5" />
                    Export CSV
                  </Button>
                </div>
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead>Item</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        {lines.some((l) => l.trackBatches) && <TableHead className="text-center">Batch</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <p className="font-medium text-sm">{line.itemName}</p>
                            {line.variantOptions && Object.keys(line.variantOptions).length > 0 && (
                              <p className="text-xs text-muted-foreground">{Object.values(line.variantOptions).join(" / ")}</p>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{line.sku || "—"}</TableCell>
                          <TableCell className="text-right font-mono font-semibold text-sm">{line.quantity}</TableCell>
                          {lines.some((l) => l.trackBatches) && (
                            <TableCell className="text-center">
                              {line.trackBatches && <Badge variant="outline" className="text-[10px] text-violet-700 border-violet-200 bg-violet-50 dark:text-violet-400 dark:bg-violet-900/20">Batched</Badge>}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            {isInbound && transfer && transfer.status === "completed" && defaultWarehouse && currentWarehouse && (
              <Button
                variant="default"
                className="gap-2"
                onClick={() => { onOpenChange(false); setWriteOffOpen(true); }}
              >
                <AlertTriangle className="h-4 w-4" />
                Write-Off to {defaultWarehouse.name}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {transfer && defaultWarehouse && currentWarehouse && (
        <WriteOffToMainWarehouseDialog
          transfer={data!}
          currentWarehouse={currentWarehouse}
          defaultWarehouse={defaultWarehouse}
          open={writeOffOpen}
          onOpenChange={setWriteOffOpen}
        />
      )}
    </>
  );
}

// ─── Write-Off to Main Warehouse Dialog ───────────────────────────────────────

function WriteOffToMainWarehouseDialog({
  transfer,
  currentWarehouse,
  defaultWarehouse,
  open,
  onOpenChange,
}: {
  transfer: StockTransferDetail;
  currentWarehouse: Warehouse;
  defaultWarehouse: Warehouse;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Filter out batch-tracked lines since dispatch requires batch picks
  const eligibleLines = transfer.lines.filter((l) => !l.trackBatches);
  const batchedLines = transfer.lines.filter((l) => l.trackBatches);

  const [quantities, setQuantities] = useState<Record<number, string>>(() =>
    Object.fromEntries(eligibleLines.map((l) => [l.id, String(l.quantity)])),
  );
  const [isProcessing, setIsProcessing] = useState(false);

  const createMutation = useCreateStockTransfer();
  const dispatchMutation = useDispatchStockTransfer();
  const completeMutation = useCompleteStockTransfer();

  const handleSubmit = async () => {
    const lines = eligibleLines
      .map((l) => ({ itemId: l.itemId, quantity: Number(quantities[l.id] ?? l.quantity) }))
      .filter((l) => l.quantity > 0);

    if (!lines.length) {
      toast({ title: "No quantities", description: "Enter a quantity for at least one item.", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    try {
      const created = await createMutation.mutateAsync({
        data: {
          fromWarehouseId: currentWarehouse.id,
          toWarehouseId: defaultWarehouse.id,
          transferDate: new Date().toISOString().split("T")[0]!,
          notes: `Write-off from inbound transfer ${transfer.transfer.transferNumber}`,
          lines,
        },
      });

      await dispatchMutation.mutateAsync({ id: created.transfer.id });
      await completeMutation.mutateAsync({ id: created.transfer.id });

      queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
      queryClient.invalidateQueries({ queryKey: getListStockTransfersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListWarehousesQueryKey() });

      onOpenChange(false);
      toast({
        title: "Write-off completed",
        description: `${lines.length} item type${lines.length !== 1 ? "s" : ""} moved to ${defaultWarehouse.name}. New transfer ${created.transfer.transferNumber} created.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Write-off failed";
      toast({ title: "Write-off failed", description: msg, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
              <MoveRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </span>
            Write-Off to Main Warehouse
          </DialogTitle>
          <DialogDescription>
            Selected quantities will be moved from{" "}
            <span className="font-semibold text-foreground">{currentWarehouse.name}</span> to{" "}
            <span className="font-semibold text-foreground">{defaultWarehouse.name}</span>.
            A new transfer record will be created as an audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {batchedLines.length > 0 && (
            <div className="rounded-lg border border-violet-200 dark:border-violet-800/40 bg-violet-50 dark:bg-violet-900/20 p-3 text-xs text-violet-800 dark:text-violet-300">
              <p className="font-semibold mb-1">Batch-tracked items excluded</p>
              <p>The following items require batch selection and must be transferred manually: {batchedLines.map((l) => l.itemName).join(", ")}.</p>
            </div>
          )}

          {eligibleLines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">All items in this transfer are batch-tracked. Please use a manual stock transfer.</p>
          ) : (
            <div className="rounded-md border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Transfer Qty</TableHead>
                    <TableHead className="text-right w-[120px]">Write-Off Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligibleLines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{line.itemName}</p>
                        {line.sku && <p className="text-xs font-mono text-muted-foreground">{line.sku}</p>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">{line.quantity}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          max={line.quantity}
                          step="1"
                          className="h-8 w-20 text-right text-sm ml-auto"
                          value={quantities[line.id] ?? ""}
                          onChange={(e) => setQuantities((q) => ({ ...q, [line.id]: e.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isProcessing || eligibleLines.length === 0} className="gap-2">
            {isProcessing ? <><Loader2 className="h-4 w-4 animate-spin" />Processing…</> : <><MoveRight className="h-4 w-4" />Confirm Write-Off</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Warehouse Detail Sheet ────────────────────────────────────────────────────

function WarehouseDetailSheet({
  warehouse,
  summary,
  summaryLoading,
  shopifyConnected,
  defaultWarehouse,
  open,
  onOpenChange,
  onEdit,
}: {
  warehouse: Warehouse | null;
  summary?: WarehouseStockSummary;
  summaryLoading: boolean;
  shopifyConnected: boolean;
  defaultWarehouse: Warehouse | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (w: Warehouse) => void;
}) {
  const [damageOpen, setDamageOpen] = useState(false);
  const [selectedTransferId, setSelectedTransferId] = useState<number | null>(null);
  const [transferDetailOpen, setTransferDetailOpen] = useState(false);

  // Transfers tab state
  const [tfSearch, setTfSearch] = useState("");
  const [tfStatus, setTfStatus] = useState<string>("all");
  const [tfSort, setTfSort] = useState<"date_desc" | "date_asc" | "num_asc" | "num_desc">("date_desc");
  const [tfPageSize, setTfPageSize] = useState(10);
  const [tfPage, setTfPage] = useState(1);
  const [tfSelected, setTfSelected] = useState<Set<number>>(new Set());

  const { data: movements, isLoading: movementsLoading } = useListStockMovements(
    { warehouseId: warehouse?.id },
    { query: { enabled: open && !!warehouse } as any },
  );
  const { data: allTransferData, isLoading: transfersLoading } = useListStockTransfers(
    { warehouseId: warehouse?.id },
    { query: { enabled: open && !!warehouse } as any },
  );

  const recentMovements = useMemo(() => (movements ?? []).slice(0, 30), [movements]);

  // Filter, sort, and paginate transfers
  const processedTransfers = useMemo(() => {
    let list = allTransferData ?? [];
    if (tfStatus !== "all") list = list.filter((t) => t.status === tfStatus);
    if (tfSearch.trim()) {
      const q = tfSearch.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.transferNumber.toLowerCase().includes(q) ||
          t.fromWarehouseName.toLowerCase().includes(q) ||
          t.toWarehouseName.toLowerCase().includes(q),
      );
    }
    list = [...list].sort((a, b) => {
      if (tfSort === "date_desc") return new Date(b.transferDate).getTime() - new Date(a.transferDate).getTime();
      if (tfSort === "date_asc") return new Date(a.transferDate).getTime() - new Date(b.transferDate).getTime();
      if (tfSort === "num_asc") return a.transferNumber.localeCompare(b.transferNumber);
      return b.transferNumber.localeCompare(a.transferNumber);
    });
    return list;
  }, [allTransferData, tfSearch, tfStatus, tfSort]);

  const tfTotal = processedTransfers.length;
  const pagedTransfers = processedTransfers.slice((tfPage - 1) * tfPageSize, tfPage * tfPageSize);

  const resetTfPage = () => setTfPage(1);

  const handleExportTransfers = useCallback((which: "all" | "filtered" | "selected") => {
    let rows = which === "all" ? (allTransferData ?? []) : which === "filtered" ? processedTransfers : processedTransfers.filter((t) => tfSelected.has(t.id));
    downloadCSV(
      `transfers-${warehouse?.code ?? "export"}-${Date.now()}.csv`,
      ["Transfer #", "Direction", "From", "To", "Status", "Date"],
      rows.map((t) => [
        t.transferNumber,
        t.toWarehouseId === warehouse?.id ? "Inbound" : "Outbound",
        t.fromWarehouseName,
        t.toWarehouseName,
        t.status,
        format(new Date(t.transferDate), "dd-MM-yyyy"),
      ]),
    );
  }, [allTransferData, processedTransfers, tfSelected, warehouse]);

  const toggleSelect = (id: number) => {
    setTfSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (pagedTransfers.every((t) => tfSelected.has(t.id))) {
      setTfSelected((prev) => { const next = new Set(prev); pagedTransfers.forEach((t) => next.delete(t.id)); return next; });
    } else {
      setTfSelected((prev) => { const next = new Set(prev); pagedTransfers.forEach((t) => next.add(t.id)); return next; });
    }
  };

  if (!warehouse) return null;

  const { avatar } = warehouseHueConfig(warehouse.code);
  const address = formatAddress(warehouse);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-xl overflow-y-auto flex flex-col">
          <SheetHeader className="shrink-0">
            <div className="flex items-center gap-3">
              <div className={cn("h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-sm font-bold ring-2 ring-white/60 dark:ring-black/20 shadow-sm", avatar)}>
                {warehouseInitials(warehouse.name)}
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base leading-tight font-bold">{warehouse.name}</SheetTitle>
                <SheetDescription className="text-xs font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {warehouse.code}
                  {warehouse.isDefault && <Badge variant="secondary" className="gap-1 text-[10px]"><Star className="h-2.5 w-2.5" />Default</Badge>}
                  {isSystemWarehouse(warehouse) && <Badge variant="outline" className="gap-1 text-[10px] font-semibold text-muted-foreground">System</Badge>}
                  {shopifyConnected && warehouse.shopifyLocationName && <Badge variant="outline" className="gap-1 text-[10px] font-normal"><Store className="h-2.5 w-2.5" />{warehouse.shopifyLocationName}</Badge>}
                </SheetDescription>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => { onOpenChange(false); onEdit(warehouse); }}>
                <Edit className="h-3.5 w-3.5 mr-1.5" />Edit
              </Button>
            </div>
            {address && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground mt-1.5">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-60" />
                <span className="leading-snug text-xs">{address}</span>
              </div>
            )}
          </SheetHeader>

          {/* Stock summary stats */}
          <div className="grid grid-cols-2 gap-3 mt-4 shrink-0">
            <StatCard label="Available Stock" value={summary ? summary.totalUnits.toLocaleString() : "0"} icon={Boxes} loading={summaryLoading} colorClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
            <StatCard label="Items in Stock" value={summary ? summary.totalItems.toLocaleString() : "0"} icon={Package} loading={summaryLoading} colorClass="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
            <StatCard label="Pending Inbound" value={summary ? summary.pendingInUnits.toLocaleString() : "0"} icon={TrendingUp} loading={summaryLoading} colorClass="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" />
            <StatCard label="Pending Outbound" value={summary ? summary.pendingOutUnits.toLocaleString() : "0"} icon={TrendingDown} loading={summaryLoading} colorClass="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
          </div>

          {/* Quick actions — Write-Off only */}
          <div className="flex gap-2 mt-3 shrink-0">
            <Button
              variant="outline"
              className="flex-1 gap-2 text-amber-700 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800/40 dark:hover:bg-amber-900/20"
              size="sm"
              onClick={() => setDamageOpen(true)}
            >
              <AlertTriangle className="h-4 w-4" />
              Record Write-Off
            </Button>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="movements" className="flex-1 flex flex-col mt-4 min-h-0">
            <TabsList className="shrink-0">
              <TabsTrigger value="movements" className="gap-2">
                <History className="h-4 w-4" />
                Movements
                {movements && movements.length > 0 && <Badge variant="secondary" className="text-xs ml-1">{movements.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="transfers" className="gap-2">
                <ArrowRightLeft className="h-4 w-4" />
                Transfers
                {(allTransferData?.length ?? 0) > 0 && <Badge variant="secondary" className="text-xs ml-1">{allTransferData?.length}</Badge>}
              </TabsTrigger>
            </TabsList>

            {/* Movements tab */}
            <TabsContent value="movements" className="flex-1 overflow-y-auto mt-3">
              {movementsLoading ? (
                <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : recentMovements.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2"><History className="h-8 w-8 opacity-30" /><p className="text-sm">No stock movements yet</p></div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Item</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Date</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentMovements.map((m) => {
                        const isIn = movementIsInbound(m.movementType, m.quantity);
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="max-w-[140px]">
                              <p className="text-sm font-medium truncate">{m.itemName}</p>
                              {m.itemSku && <p className="text-xs font-mono text-muted-foreground">{m.itemSku}</p>}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn("text-xs whitespace-nowrap", isIn ? "text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20" : "text-rose-700 border-rose-200 bg-rose-50 dark:text-rose-400 dark:border-rose-800/40 dark:bg-rose-900/20")}>
                                {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                              </Badge>
                            </TableCell>
                            <TableCell className={cn("text-right font-mono text-sm font-medium", isIn ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
                              {isIn ? "+" : ""}{m.quantity}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(m.createdAt), "dd MMM yy")}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {movements && movements.length > 30 && <p className="text-xs text-muted-foreground text-center mt-2">Showing 30 of {movements.length} movements</p>}
            </TabsContent>

            {/* Transfers tab */}
            <TabsContent value="transfers" className="flex-1 overflow-y-auto mt-3 space-y-3">
              {/* Toolbar */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search transfers…"
                      className="pl-8 h-8 text-sm"
                      value={tfSearch}
                      onChange={(e) => { setTfSearch(e.target.value); resetTfPage(); }}
                    />
                    {tfSearch && <button onClick={() => { setTfSearch(""); resetTfPage(); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0 text-xs">
                        <FileDown className="h-3.5 w-3.5" />
                        Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleExportTransfers("selected")} disabled={tfSelected.size === 0}>
                        Export Selected ({tfSelected.size})
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExportTransfers("filtered")}>
                        Export Filtered ({tfTotal})
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleExportTransfers("all")}>
                        Export All ({allTransferData?.length ?? 0})
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex gap-2 flex-wrap">
                  {/* Status filter */}
                  <Select value={tfStatus} onValueChange={(v) => { setTfStatus(v); resetTfPage(); }}>
                    <SelectTrigger className="h-8 w-[130px] text-xs">
                      <Filter className="h-3 w-3 mr-1" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="in_transit">In Transit</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Sort */}
                  <Select value={tfSort} onValueChange={(v) => setTfSort(v as typeof tfSort)}>
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      <ArrowUpDown className="h-3 w-3 mr-1" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date_desc">Newest First</SelectItem>
                      <SelectItem value="date_asc">Oldest First</SelectItem>
                      <SelectItem value="num_asc">Number A→Z</SelectItem>
                      <SelectItem value="num_desc">Number Z→A</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Records per page */}
                  <Select value={String(tfPageSize)} onValueChange={(v) => { setTfPageSize(Number(v)); resetTfPage(); }}>
                    <SelectTrigger className="h-8 w-[80px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {tfSelected.size > 0 && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => setTfSelected(new Set())}>
                      <X className="h-3 w-3" />{tfSelected.size} selected
                    </Button>
                  )}
                </div>
              </div>

              {transfersLoading ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : pagedTransfers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <ArrowRightLeft className="h-8 w-8 opacity-30" />
                  <p className="text-sm">{tfSearch || tfStatus !== "all" ? "No transfers match your filters" : "No transfers yet"}</p>
                </div>
              ) : (
                <>
                  <div className="rounded-md border border-border/60 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="w-8 pr-0">
                            <Checkbox
                              checked={pagedTransfers.length > 0 && pagedTransfers.every((t) => tfSelected.has(t.id))}
                              onCheckedChange={toggleSelectAll}
                              aria-label="Select all"
                            />
                          </TableHead>
                          <TableHead>Transfer #</TableHead>
                          <TableHead>Direction</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="w-[80px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedTransfers.map((t) => {
                          const isInbound = t.toWarehouseId === warehouse.id;
                          const otherWarehouse = isInbound ? t.fromWarehouseName : t.toWarehouseName;
                          return (
                            <TableRow key={t.id} className={cn("transition-colors", tfSelected.has(t.id) && "bg-muted/30")}>
                              <TableCell className="pr-0 w-8">
                                <Checkbox checked={tfSelected.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} aria-label="Select row" />
                              </TableCell>
                              <TableCell>
                                <button
                                  className="text-sm font-mono font-semibold text-primary hover:underline cursor-pointer"
                                  onClick={() => { setSelectedTransferId(t.id); setTransferDetailOpen(true); }}
                                >
                                  {t.transferNumber}
                                </button>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1 text-xs">
                                  {isInbound ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <TrendingDown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />}
                                  <span className={cn("truncate max-w-[90px] font-medium", isInbound ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{otherWarehouse}</span>
                                </div>
                              </TableCell>
                              <TableCell>{transferStatusBadge(t.status)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(t.transferDate), "dd MMM yy")}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-0.5 justify-end">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="View Details"
                                    onClick={() => { setSelectedTransferId(t.id); setTransferDetailOpen(true); }}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  {isInbound && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                      title="Write-Off to Main Warehouse"
                                      onClick={() => { setSelectedTransferId(t.id); setTransferDetailOpen(true); }}
                                    >
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Transfers pagination */}
                  {tfTotal > tfPageSize && (
                    <TablePagination total={tfTotal} page={tfPage} pageSize={tfPageSize} onPageChange={setTfPage} itemLabel="transfers" />
                  )}
                  <p className="text-xs text-muted-foreground text-right">
                    {tfTotal} transfer{tfTotal !== 1 ? "s" : ""}{tfSearch || tfStatus !== "all" ? " (filtered)" : ""}
                  </p>
                </>
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {warehouse && (
        <WriteOffDialog
          open={damageOpen}
          onOpenChange={setDamageOpen}
          defaultWarehouseId={warehouse.id}
        />
      )}

      {selectedTransferId && (
        <TransferDetailModal
          transferId={selectedTransferId}
          warehouseId={warehouse.id}
          defaultWarehouse={defaultWarehouse}
          currentWarehouse={warehouse}
          open={transferDetailOpen}
          onOpenChange={(v) => { setTransferDetailOpen(v); if (!v) setTimeout(() => setSelectedTransferId(null), 300); }}
        />
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Warehouses() {
  const { data: warehouses, isLoading } = useListWarehouses();
  const { data: connection } = useGetShopifyConnection();
  const shopifyConnected = !!connection?.connected;

  const {
    data: locationsData,
    isLoading: locationsLoading,
    error: locationsError,
  } = useListShopifyLocations({
    query: {
      enabled: shopifyConnected,
      queryKey: getListShopifyLocationsQueryKey(),
      retry: false,
    },
  });
  const shopifyLocations = locationsData?.locations ?? [];
  const reinstallRequired = (() => {
    const e = locationsError as { status?: number; data?: { error?: string } } | null | undefined;
    if (!e) return false;
    if (e.status === 403) return true;
    if (typeof e.data?.error === "string" && e.data.error.includes("read_locations")) return true;
    return false;
  })();

  const { data: stockSummaries, isLoading: summariesLoading } = useQuery<WarehouseStockSummary[]>({
    queryKey: ["warehouses", "stock-summaries"],
    queryFn: fetchWarehouseStockSummaries,
    staleTime: 60_000,
    enabled: !isLoading,
  });

  const summaryMap = useMemo(() => {
    const m = new Map<number, WarehouseStockSummary>();
    for (const s of stockSummaries ?? []) m.set(s.warehouseId, s);
    return m;
  }, [stockSummaries]);

  const defaultWarehouse = useMemo(() => (warehouses ?? []).find((w) => w.isDefault), [warehouses]);

  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name_asc");
  const [listPageSize, setListPageSize] = useState(LIST_PAGE_SIZE);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [detailWarehouse, setDetailWarehouse] = useState<Warehouse | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [deleteDialogWarehouse, setDeleteDialogWarehouse] = useState<Warehouse | null>(null);
  const [page, setPage] = useState(1);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMutation = useCreateWarehouse({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWarehousesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
        setEditSheetOpen(false);
        toast({ title: "Warehouse created", description: "New warehouse added successfully." });
      },
    },
  });

  const updateMutation = useUpdateWarehouse({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWarehousesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListShopifyLocationsQueryKey() });
        setEditSheetOpen(false);
        toast({ title: "Warehouse updated", description: "Changes saved successfully." });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to update warehouse";
        toast({ title: "Update failed", description: msg, variant: "destructive" });
      },
    },
  });

  const deleteMutation = useDeleteWarehouse({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWarehousesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["warehouses", "stock-summaries"] });
        setDeleteDialogWarehouse(null);
        toast({ title: "Warehouse deleted", description: "The warehouse has been removed." });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to delete warehouse";
        toast({ title: "Delete failed", description: msg, variant: "destructive" });
      },
    },
  });

  // ── Form ─────────────────────────────────────────────────────────────────────

  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: { name: "", code: "", addressLine1: "", city: "", state: "", country: "", isDefault: false, shopifyLocationId: UNMAPPED },
  });

  const handleEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    form.reset({ name: warehouse.name, code: warehouse.code, addressLine1: warehouse.addressLine1 || "", city: warehouse.city || "", state: warehouse.state || "", country: warehouse.country || "", isDefault: warehouse.isDefault, shopifyLocationId: warehouse.shopifyLocationId ?? UNMAPPED });
    setEditSheetOpen(true);
  };

  const handleCreate = () => {
    setEditingWarehouse(null);
    form.reset({ name: "", code: "", addressLine1: "", city: "", state: "", country: "", isDefault: false, shopifyLocationId: UNMAPPED });
    setEditSheetOpen(true);
  };

  const [, setLocation] = useLocation();
  const handleView = (warehouse: Warehouse) => setLocation(`/warehouses/${warehouse.id}`);

  const onSubmit = (data: WarehouseFormValues) => {
    const basePayload = { name: data.name, code: data.code, addressLine1: data.addressLine1 || null, city: data.city || null, state: data.state || null, country: data.country || null, isDefault: data.isDefault };
    if (editingWarehouse) {
      const updatePayload: Record<string, unknown> = { ...basePayload };
      if (shopifyConnected) {
        updatePayload.shopifyLocationId = data.shopifyLocationId && data.shopifyLocationId !== UNMAPPED ? data.shopifyLocationId : null;
      }
      updateMutation.mutate({ id: editingWarehouse.id, data: updatePayload });
    } else {
      createMutation.mutate({ data: basePayload });
    }
  };

  // ── Filtering / sorting / pagination ─────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = (warehouses ?? []).filter((w) => !w.isVirtual);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((w) => w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q) || (w.city ?? "").toLowerCase().includes(q) || (w.state ?? "").toLowerCase().includes(q) || (w.addressLine1 ?? "").toLowerCase().includes(q));
    list = [...list].sort((a, b) => {
      if (sortKey === "name_asc") return a.name.localeCompare(b.name);
      if (sortKey === "name_desc") return b.name.localeCompare(a.name);
      const au = summaryMap.get(a.id)?.totalUnits ?? 0;
      const bu = summaryMap.get(b.id)?.totalUnits ?? 0;
      if (sortKey === "units_desc") return bu - au;
      if (sortKey === "units_asc") return au - bu;
      const ai = summaryMap.get(a.id)?.totalItems ?? 0;
      const bi = summaryMap.get(b.id)?.totalItems ?? 0;
      return bi - ai;
    });
    return list;
  }, [warehouses, search, sortKey, summaryMap]);

  const effectivePageSize = viewMode === "card" ? CARD_PAGE_SIZE : listPageSize;
  const pagedWarehouses = filtered.slice((page - 1) * effectivePageSize, page * effectivePageSize);
  const filteredCount = filtered.length;
  const totalCount = (warehouses ?? []).filter((w) => !w.isVirtual).length;

  const handleViewModeChange = (mode: ViewMode) => { setViewMode(mode); setPage(1); };

  const handleExportWarehouses = (which: "all" | "filtered") => {
    const list = which === "all" ? (warehouses ?? []).filter((w) => !w.isVirtual) : filtered;
    downloadCSV(`warehouses-${Date.now()}.csv`,
      ["Name", "Code", "Address", "City", "State", "Country", "Default", "Units", "SKUs"],
      list.map((w) => {
        const s = summaryMap.get(w.id);
        return [w.name, w.code, w.addressLine1, w.city, w.state, w.country, w.isDefault ? "Yes" : "No", s?.totalUnits ?? "", s?.totalItems ?? ""];
      }),
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouses"
        description="Manage your inventory storage locations and track stock levels."
        actions={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <FileDown className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExportWarehouses("filtered")}>Export Filtered ({filteredCount})</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleExportWarehouses("all")}>Export All ({totalCount})</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Can module="warehouses" action="create">
              <Button size="sm" className="gap-1.5" onClick={handleCreate} data-testid="btn-create-warehouse">
                <Plus className="h-4 w-4" />
                New Warehouse
              </Button>
            </Can>
          </div>
        }
      />

      {/* Summary bar */}
      {!isLoading && (warehouses ?? []).length > 0 && (
        <WarehouseSummaryBar warehouses={warehouses ?? []} stockSummaries={stockSummaries ?? []} loading={summariesLoading} />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search warehouses…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" data-testid="input-warehouse-search" />
          {search && <button onClick={() => { setSearch(""); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
        </div>

        {/* Sort */}
        <Select value={sortKey} onValueChange={(v) => { setSortKey(v as SortKey); setPage(1); }}>
          <SelectTrigger className="h-9 w-[155px] text-sm">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name_asc"><span className="flex items-center gap-1.5"><ArrowUp className="h-3 w-3" />Name A→Z</span></SelectItem>
            <SelectItem value="name_desc"><span className="flex items-center gap-1.5"><ArrowDown className="h-3 w-3" />Name Z→A</span></SelectItem>
            <SelectItem value="units_desc"><span className="flex items-center gap-1.5"><ArrowDown className="h-3 w-3" />Units High→Low</span></SelectItem>
            <SelectItem value="units_asc"><span className="flex items-center gap-1.5"><ArrowUp className="h-3 w-3" />Units Low→High</span></SelectItem>
            <SelectItem value="skus_desc"><span className="flex items-center gap-1.5"><ArrowDown className="h-3 w-3" />SKUs High→Low</span></SelectItem>
          </SelectContent>
        </Select>

        {!isLoading && (
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {search ? `${filteredCount} of ${totalCount}` : `${totalCount} warehouse${totalCount !== 1 ? "s" : ""}`}
          </p>
        )}

        <div className="flex items-center rounded-md border bg-background p-0.5 gap-0.5 ml-auto">
          <Button variant={viewMode === "card" ? "secondary" : "ghost"} size="sm" className="h-7 w-7 p-0" onClick={() => handleViewModeChange("card")} title="Card view" data-testid="btn-view-card"><LayoutGrid className="h-4 w-4" /></Button>
          <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" className="h-7 w-7 p-0" onClick={() => handleViewModeChange("list")} title="List view" data-testid="btn-view-list"><LayoutList className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* ── Card view ──────────────────────────────────────────────────────────── */}
      {viewMode === "card" && (
        <>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}</div>
          ) : pagedWarehouses.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-16 gap-3 text-muted-foreground">
              <div className="h-14 w-14 rounded-xl bg-muted/50 flex items-center justify-center"><Building2 className="h-7 w-7 opacity-40" /></div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-foreground">{search ? "No warehouses match your filters" : "No warehouses yet"}</p>
                <p className="text-xs text-muted-foreground">{search ? "Try clearing your filters" : "Add your first location to start tracking inventory"}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pagedWarehouses.map((w, i) => (
                <WarehouseCard key={w.id} warehouse={w} summary={summaryMap.get(w.id)} summaryLoading={summariesLoading} shopifyConnected={shopifyConnected} onEdit={handleEdit} onDelete={setDeleteDialogWarehouse} onView={handleView} index={i} />
              ))}
            </div>
          )}
          {filteredCount > CARD_PAGE_SIZE && <TablePagination total={filteredCount} page={page} pageSize={CARD_PAGE_SIZE} onPageChange={setPage} itemLabel="warehouses" />}
        </>
      )}

      {/* ── List view ──────────────────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <>
          {/* List page size */}
          <div className="flex items-center justify-end gap-2">
            <p className="text-xs text-muted-foreground">Rows per page:</p>
            <Select value={String(listPageSize)} onValueChange={(v) => { setListPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[40px]" /><TableHead>Code</TableHead><TableHead>Name</TableHead>
                  <TableHead>Address</TableHead><TableHead>City / State</TableHead>
                  <TableHead className="text-right">Units</TableHead><TableHead className="text-right">Items</TableHead>
                  {shopifyConnected && <TableHead>Shopify Location</TableHead>}
                  <TableHead className="w-[90px] text-center">Status</TableHead><TableHead className="w-[110px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: shopifyConnected ? 10 : 9 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : pagedWarehouses.length === 0 ? (
                  <TableRow><TableCell colSpan={shopifyConnected ? 10 : 9} className="h-24 text-center text-muted-foreground">{search ? "No warehouses match your filters." : "No warehouses found."}</TableCell></TableRow>
                ) : (
                  pagedWarehouses.map((w) => {
                    const { avatar } = warehouseHueConfig(w.code);
                    const summary = summaryMap.get(w.id);
                    return (
                      <TableRow key={w.id} data-testid={`row-warehouse-${w.id}`} className="cursor-pointer hover:bg-muted/40 transition-colors" onClick={() => handleView(w)}>
                        <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                          <div className={cn("h-7 w-7 rounded-md flex items-center justify-center text-xs font-bold", avatar)}>{warehouseInitials(w.name)}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">{w.code}</TableCell>
                        <TableCell className="font-semibold">{w.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">{w.addressLine1 || <span className="italic opacity-40">—</span>}</TableCell>
                        <TableCell className="text-sm">{formatCityState(w) || <span className="text-muted-foreground italic opacity-40">—</span>}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {summariesLoading ? <Skeleton className="h-4 w-12 ml-auto" /> : summary?.totalUnits.toLocaleString() ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {summariesLoading ? <Skeleton className="h-4 w-10 ml-auto" /> : summary?.totalItems.toLocaleString() ?? "—"}
                        </TableCell>
                        {shopifyConnected && (
                          <TableCell data-testid={`cell-warehouse-shopify-${w.id}`} onClick={(e) => e.stopPropagation()}>
                            {w.shopifyLocationName ? <Badge variant="outline" className="gap-1 font-normal text-xs"><Store className="h-3 w-3" />{w.shopifyLocationName}</Badge> : <span className="text-xs text-muted-foreground">Not mapped</span>}
                          </TableCell>
                        )}
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          {w.isDefault ? <Badge variant="secondary" className="gap-1 text-xs"><Star className="h-3 w-3" />Default</Badge> : isSystemWarehouse(w) ? <Badge variant="outline" className="gap-1 text-xs font-semibold text-muted-foreground">System</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleView(w)} title="View Details"><Eye className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {filteredCount > listPageSize && <TablePagination total={filteredCount} page={page} pageSize={listPageSize} onPageChange={setPage} itemLabel="warehouses" />}
        </>
      )}

      {/* ── Warehouse Detail Sheet ──────────────────────────────────────────── */}
      <WarehouseDetailSheet
        warehouse={detailWarehouse}
        summary={detailWarehouse ? summaryMap.get(detailWarehouse.id) : undefined}
        summaryLoading={summariesLoading}
        shopifyConnected={shopifyConnected}
        defaultWarehouse={defaultWarehouse}
        open={detailSheetOpen}
        onOpenChange={(v) => { setDetailSheetOpen(v); if (!v) setTimeout(() => setDetailWarehouse(null), 300); }}
        onEdit={handleEdit}
      />

      {/* ── Edit / Create Sheet ─────────────────────────────────────────────── */}
      <Sheet open={editSheetOpen} onOpenChange={setEditSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingWarehouse ? "Edit Warehouse" : "Add Warehouse"}</SheetTitle>
            <SheetDescription>{editingWarehouse ? `Update details for ${editingWarehouse.name}.` : "Add a new inventory location to your organisation."}</SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="code" render={({ field }) => (
                  <FormItem className="col-span-1"><FormLabel>Code *</FormLabel><FormControl><Input {...field} placeholder="MAIN" className="font-mono uppercase" data-testid="input-warehouse-code" disabled={editingWarehouse ? isSystemWarehouse(editingWarehouse) : false} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>Name *</FormLabel><FormControl><Input {...field} data-testid="input-warehouse-name" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" />Address</p>
                <FormField control={form.control} name="addressLine1" render={({ field }) => (
                  <FormItem><FormLabel>Street</FormLabel><FormControl><Input {...field} placeholder="123 Main St" data-testid="input-warehouse-address" /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="city" render={({ field }) => (
                    <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} data-testid="input-warehouse-city" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="state" render={({ field }) => (
                    <FormItem><FormLabel>State</FormLabel><FormControl><Input {...field} data-testid="input-warehouse-state" /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="country" render={({ field }) => (
                  <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} placeholder="India" data-testid="input-warehouse-country" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              {!(editingWarehouse && isSystemWarehouse(editingWarehouse)) && (
                <FormField control={form.control} name="isDefault" render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-lg border border-border/60 p-4">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-warehouse-default" /></FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="font-medium">Default warehouse</FormLabel>
                      <p className="text-xs text-muted-foreground">New orders and stock adjustments will use this location by default.</p>
                    </div>
                  </FormItem>
                )} />
              )}

              {editingWarehouse && shopifyConnected && (
                <FormField control={form.control} name="shopifyLocationId" render={({ field }) => {
                  const currentVal = field.value ?? UNMAPPED;
                  return (
                    <FormItem>
                      <FormLabel>Shopify Location</FormLabel>
                      {reinstallRequired ? (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="alert-shopify-reinstall">
                          Your Shopify connection is missing the <code className="font-mono">read_locations</code> permission. Please reconnect Shopify from the Integrations page to enable warehouse mapping.
                        </div>
                      ) : (
                        <>
                          <Select value={currentVal} onValueChange={field.onChange} disabled={locationsLoading}>
                            <FormControl>
                              <SelectTrigger data-testid="select-warehouse-shopify-location">
                                <SelectValue placeholder={locationsLoading ? "Loading…" : "Not mapped"} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={UNMAPPED}>Not mapped</SelectItem>
                              {shopifyLocations.map((l) => {
                                const takenByOther = l.mappedWarehouseId != null && l.mappedWarehouseId !== editingWarehouse.id;
                                return (<SelectItem key={l.id} value={l.id} disabled={takenByOther}>{l.name}{l.primary ? " (primary)" : ""}{takenByOther && l.mappedWarehouseName ? ` — already mapped to ${l.mappedWarehouseName}` : ""}</SelectItem>);
                              })}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">Stock changes here will sync to the selected Shopify location.</p>
                        </>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }} />
              )}

              <div className="pt-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditSheetOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="btn-save-warehouse">
                  {createMutation.isPending || updateMutation.isPending ? "Saving…" : editingWarehouse ? "Save Changes" : "Create Warehouse"}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      {/* ── Delete confirmation ─────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteDialogWarehouse} onOpenChange={(open) => !open && setDeleteDialogWarehouse(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0"><Trash2 className="h-4 w-4 text-destructive" /></span>
              Delete Warehouse?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold text-foreground">{deleteDialogWarehouse?.name}</span>{" "}
              <span className="font-mono text-xs text-muted-foreground">({deleteDialogWarehouse?.code})</span>
              <br />This will permanently remove the warehouse. Warehouses with existing stock cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDialogWarehouse && deleteMutation.mutate({ id: deleteDialogWarehouse.id })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
