import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  RefreshCw,
  Unlink,
  CheckCircle2,
  ExternalLink,
  ArrowLeftRight,
  RotateCcw,
  AlertCircle,
  CheckCheck,
  SkipForward,
  Activity,
  Info,
  Pause,
  Play,
  XCircle,
  Zap,
  Clock,
  Package,
  PackageCheck,
  PackageX,
  ArrowUpDown,
  ShoppingBag,
  TrendingUp,
  Lock,
  Warehouse,
  Settings2,
  BarChart3,
  Download,
  Eye,
  ChevronRight,
  Bell,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  useGetShopifyConnection,
  useDeleteShopifyConnection,
  useSyncShopifyOrders,
  usePushShopifyProducts,
  useStartShopifyInstall,
  getGetShopifyConnectionQueryKey,
} from "@/lib/queryKeys";

function ShopifyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 50 57" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M43.4 10.7c0-.2-.2-.3-.3-.3s-3.5-.3-3.5-.3l-2.5-2.5c-.2-.2-.7-.1-.9-.1L34 8.4C32.6 4.4 30 1.7 26.9 1.7h-.3C25.7.6 24.6 0 23.6 0c-7.4 0-10.9 9.2-12 13.9l-5.2 1.6c-1.6.5-1.7.5-1.9 2L1 46.3l33.6 5.8 18.2-4.6L43.4 10.7zM28.1 9.4l-3.6 1.1c0-.4 0-.9-.1-1.4-.4-1.8-1-2.8-1.8-3.3 2 .3 3.9 1.8 5.5 3.6zm-6.3-3c.8.5 1.4 1.6 1.8 3.4.1.4.1.8.1 1.2l-4.3 1.3C20.6 9 22.1 6.7 21.8 6.4zm-1.1-.5c.1 0 .1 0 .2.1-.1 0-.2-.1-.2-.1zm6.5 3.4c-1.6-2-3.6-3.4-5.7-3.8.3-.1.6-.2.8-.2 3.1 0 5.3 3.2 5.9 7l-1-.3v.3z" />
      <path d="M35.4 10.5l-5.3 1.6c-.6-3.8-2.8-7-5.9-7-.3 0-.5.1-.8.1-1.2-1.6-2.7-2.3-4-2.3-9.9.1-14.6 12.4-16.1 18.7l-1.5.5c-1.6.5-1.7.5-1.9 2L.4 43.5l33.1 6.2L49.8 46 35.4 10.5zm-8.8 13.4l-8.7 2.7c.8-3.3 2.9-8 6.3-9.3.7 1.3 1.2 3.2 1.4 5.2l1-.6c-.5-3.1-1.7-5.5-3.3-6.5 2.4.8 4.3 3.4 3.3 8.5zm-5 6.7c-2.4.8-4.4-.5-4.4-.5s1.2-5.3 5.2-6.8l-.8 7.3zM20.8 13c-.6.5-1.2 1.3-1.7 2.2-1.3.4-2.7.8-4.1 1.3C16.6 13.3 19.1 8.9 22 8c-.7 1.2-1 2.7-1.2 5zm6 10.9l-1 .3c-.2-2-.7-3.9-1.4-5.2 1.7.9 2.8 2.7 2.4 4.9z" />
    </svg>
  );
}

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/i;
const connectSchema = z.object({
  shopDomain: z
    .string()
    .min(1, "Store domain is required")
    .transform((v) => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .refine((v) => SHOP_DOMAIN_RE.test(v), { message: "Must look like your-store.myshopify.com" }),
  apiKey: z.string().min(1, "API Key is required"),
  apiSecret: z.string().min(1, "API Secret Key is required"),
});
type ConnectValues = z.infer<typeof connectSchema>;

function fmtTime(value: string | null | undefined) {
  if (!value) return "Never";
  return format(new Date(value), "MMM d, h:mm a");
}
function fmtAgo(value: string | null | undefined) {
  if (!value) return "Never";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}
function fmtDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
function fmtMoney(value: string | number | null | undefined) {
  if (value == null) return "—";
  const n = Number(value);
  if (n >= 10_000_000) return `₹${(n / 1_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
}

type ProductSyncJob = {
  id: string;
  status: "running" | "paused" | "cancelled" | "completed" | "completed_with_errors" | "failed";
  totalShopify: number | null;
  totalErp: number | null;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  missing: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type DashboardStats = {
  shopifyTotal: number | null;
  lastSyncedAt: string | null;
  erpTotal: number;
  mappedItems: number;
  simpleItems: number;
  variantProducts: number;
  totalVariants: number;
  inventoryValue: string;
  warehouseCount: number;
};

type SyncLog = {
  id: number;
  direction: string;
  entity: string;
  action: string;
  status: string;
  shopifyId: string | null;
  erpId: string | null;
  sku: string | null;
  name: string | null;
  parentItemId: number | null;
  failureReason: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const ACTIVE_STATUSES = new Set(["running", "paused"]);
const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "cancelled", "failed"]);
const SYNC_POLL_ACTIVE = 2_000;
const SYNC_POLL_IDLE = 15_000;

const FAILURE_REASON_LABELS: Record<string, string> = {
  validation: "Validation error",
  api_error: "API error",
  missing_data: "Missing data",
  duplicate_sku: "Duplicate SKU",
  rate_limit: "Rate limit",
  skipped_bundle: "Bundle (skipped)",
  skipped_parent: "Parent item",
  skipped_mapped: "Already mapped",
  skipped_no_connection: "No connection",
};

function SyncStatusBadge({ status }: { status: ProductSyncJob["status"] }) {
  const cfg = {
    running:               { label: "Running",          className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse" },
    paused:                { label: "Paused",           className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    completed:             { label: "Completed",        className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    completed_with_errors: { label: "With Warnings",    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    cancelled:             { label: "Cancelled",        className: "bg-muted text-muted-foreground" },
    failed:                { label: "Failed",           className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  }[status] ?? { label: status, className: "bg-muted" };
  return <Badge variant="outline" className={`text-[11px] font-medium ${cfg.className}`}>{cfg.label}</Badge>;
}

function statusBadge(status: string) {
  if (status === "success") return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/30 text-[10px] py-0">Success</Badge>;
  if (status === "error") return <Badge variant="outline" className="bg-red-50 text-destructive border-red-200 dark:bg-red-900/20 dark:border-red-900/30 text-[10px] py-0">Failed</Badge>;
  return <Badge variant="outline" className="text-[10px] py-0">Skipped</Badge>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntegrationShopify() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: connection, isLoading, isError, error, refetch } = useGetShopifyConnection();
  const invalidateConnection = useCallback(
    () => queryClient.invalidateQueries({ queryKey: getGetShopifyConnectionQueryKey() }),
    [queryClient],
  );

  const connectForm = useForm<ConnectValues>({
    resolver: zodResolver(connectSchema),
    defaultValues: { shopDomain: "", apiKey: "", apiSecret: "" },
  });

  const oauthMutation = useStartShopifyInstall({
    mutation: {
      onSuccess: (data) => { window.location.href = data.installUrl; },
      onError: (err: unknown) => {
        toast({ title: "Connection failed", description: err instanceof Error ? err.message : "Could not connect.", variant: "destructive" });
      },
    },
  });

  const disconnectMutation = useDeleteShopifyConnection({
    mutation: {
      onSuccess: () => { invalidateConnection(); toast({ title: "Shopify disconnected" }); },
    },
  });

  const syncOrdersMutation = useSyncShopifyOrders({
    mutation: {
      onSuccess: (data) => {
        invalidateConnection();
        toast({ title: "Order sync complete", description: `Imported ${data.ordersImported}, skipped ${data.ordersSkipped}.` });
      },
    },
  });

  const pushProductsMutation = usePushShopifyProducts({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Products pushed to Shopify", description: `Queued ${data.itemCount} product${data.itemCount === 1 ? "" : "s"} for push.` });
      },
      onError: (err: unknown) => {
        toast({ title: "Push failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
      },
    },
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("connected") === "1") {
      toast({ title: "Shopify connected" });
      url.searchParams.delete("connected");
      window.history.replaceState({}, "", url.toString());
      invalidateConnection();
    }
  }, []);

  const header = (
    <PageHeader
      title="Shopify Integration"
      backHref="/integrations"
      breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: "Shopify" }]}
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        {header}
        <Card><CardContent className="flex items-center gap-3 py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</CardContent></Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6 max-w-2xl">
        {header}
        <Card className="border-destructive/40">
          <CardHeader><CardTitle className="text-destructive">Couldn't load Shopify status</CardTitle><CardDescription>{error instanceof Error ? error.message : "Unknown error."}</CardDescription></CardHeader>
          <CardFooter><Button onClick={() => refetch()} variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl">
      {header}

      {!connection?.connected ? (
        <Card className="max-w-xl">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShopifyIcon className="h-8 w-8 text-[#95bf47]" />
              <div>
                <CardTitle>Connect your Shopify store</CardTitle>
                <CardDescription>Enter your store domain and app credentials to connect via OAuth.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Form {...connectForm}>
              <form onSubmit={connectForm.handleSubmit((v) => oauthMutation.mutate({ data: { shopDomain: v.shopDomain, apiKey: v.apiKey, apiSecret: v.apiSecret } }))} className="space-y-4">
                <FormField control={connectForm.control} name="shopDomain" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shop domain</FormLabel>
                    <FormControl><Input placeholder="your-store.myshopify.com" autoComplete="off" {...field} data-testid="input-shopify-domain" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={connectForm.control} name="apiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl><Input placeholder="Shopify app API key" autoComplete="off" {...field} data-testid="input-shopify-api-key" /></FormControl>
                    <FormDescription>Found in your Shopify app's "API credentials" tab.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={connectForm.control} name="apiSecret" render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Secret Key</FormLabel>
                    <FormControl><Input type="password" placeholder="Shopify app API secret" autoComplete="off" {...field} data-testid="input-shopify-api-secret" /></FormControl>
                    <FormDescription>Used to verify incoming Shopify webhook signatures.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" disabled={oauthMutation.isPending} data-testid="btn-connect-shopify">
                  {oauthMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Redirecting…</> : <><ExternalLink className="mr-2 h-4 w-4" />Connect with Shopify</>}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <ConnectedView
          connection={connection}
          onDisconnect={() => disconnectMutation.mutate()}
          disconnecting={disconnectMutation.isPending}
          onSyncOrders={() => syncOrdersMutation.mutate()}
          syncingOrders={syncOrdersMutation.isPending}
          onPushAll={() => pushProductsMutation.mutate()}
          pushingAll={pushProductsMutation.isPending}
          onConnectionChange={invalidateConnection}
        />
      )}
    </div>
  );
}

// ─── ConnectedView ────────────────────────────────────────────────────────────

type ConnectionData = {
  connected: boolean;
  shopDomain: string | null;
  lastSyncedAt: string | null;
  productCount: number | null;
  scopes: string | null;
  locationId: string | null;
  lastWebhookAt: string | null;
  webhooksRegisteredAt: string | null;
  mappedWarehouseCount: number | null;
  totalWarehouseCount: number | null;
};

function ConnectedView({
  connection,
  onDisconnect,
  disconnecting,
  onSyncOrders,
  syncingOrders,
  onPushAll,
  pushingAll,
  onConnectionChange,
}: {
  connection: ConnectionData;
  onDisconnect: () => void;
  disconnecting: boolean;
  onSyncOrders: () => void;
  syncingOrders: boolean;
  onPushAll: () => void;
  pushingAll: boolean;
  onConnectionChange: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncPushDialogOpen, setSyncPushDialogOpen] = useState(false);
  const [drilldownStatus, setDrilldownStatus] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardStats>({
    queryKey: ["shopify-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/shopify/dashboard");
      if (!r.ok) throw new Error("Failed to load dashboard");
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: job, refetch: refetchJob } = useQuery<ProductSyncJob | null>({
    queryKey: ["shopify-product-sync-job", activeJobId ?? "latest"],
    queryFn: async () => {
      const url = activeJobId ? `/api/shopify/product-sync-job/${activeJobId}` : `/api/shopify/product-sync-job/latest`;
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Failed to load sync job");
      return r.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return SYNC_POLL_IDLE;
      return ACTIVE_STATUSES.has(d.status) ? SYNC_POLL_ACTIVE : SYNC_POLL_IDLE;
    },
    staleTime: 1_000,
  });

  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    const wasActive = prevStatus.current && ACTIVE_STATUSES.has(prevStatus.current);
    const isNowDone = TERMINAL_STATUSES.has(job.status);
    if (wasActive && isNowDone) {
      onConnectionChange();
      queryClient.invalidateQueries({ queryKey: ["shopify-sync-logs"] });
      queryClient.invalidateQueries({ queryKey: ["shopify-dashboard"] });
    }
    prevStatus.current = job.status;
  }, [job?.status]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/shopify/sync", { method: "POST" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to start sync");
      }
      return r.json() as Promise<{ jobId: string }>;
    },
    onSuccess: ({ jobId }) => {
      setActiveJobId(jobId);
      setSyncDialogOpen(false);
      void refetchJob();
      toast({ title: "Sync started", description: "Product sync is now running in the background." });
    },
    onError: (err: unknown) => {
      toast({ title: "Sync failed to start", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    },
  });

  const controlMutation = useMutation({
    mutationFn: async ({ action }: { action: "pause" | "resume" | "cancel" }) => {
      if (!job) return;
      const r = await fetch(`/api/shopify/product-sync-job/${job.id}/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`Failed to ${action}`);
    },
    onSuccess: () => void refetchJob(),
    onError: (err: unknown) => {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (type: "failed" | "skipped") => {
      const url = type === "failed" ? "/api/shopify/sync-logs/retry-failed" : `/api/shopify/product-sync-job/${job?.id}/retry-skipped`;
      const r = await fetch(url, { method: "POST" });
      if (!r.ok) throw new Error("Retry failed");
      return r.json();
    },
    onSuccess: (data: { queued?: number; jobId?: string }) => {
      if (data.jobId) { setActiveJobId(data.jobId); void refetchJob(); }
      toast({ title: "Retry queued", description: data.jobId ? "New sync started" : `${data.queued ?? 0} items queued` });
    },
    onError: (err: unknown) => {
      toast({ title: "Retry failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    },
  });

  const isRunning = job?.status === "running";
  const isPaused = job?.status === "paused";
  const isActive = isRunning || isPaused;
  const isIdle = !job || TERMINAL_STATUSES.has(job.status);

  const pct = job?.totalShopify ? Math.round((job.processed / job.totalShopify) * 100) : 0;
  const elapsed = job ? (new Date().getTime() - new Date(job.startedAt).getTime()) / 1000 : 0;
  const speed = elapsed > 0 && job ? job.processed / elapsed : 0;
  const eta = speed > 0 && job?.totalShopify ? Math.round(((job.totalShopify - job.processed) / speed)) : null;

  function handleStatClick(status: string) {
    if (!job) return;
    setDrilldownStatus(status);
  }

  const handleExport = (days: number) => {
    window.open(`/api/shopify/export-report.csv?days=${days}`, "_blank");
  };

  return (
    <>
      {/* ── Enterprise Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-[#95bf47]/15 flex items-center justify-center">
            <ShopifyIcon className="h-5 w-5 text-[#95bf47]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-base">{connection.shopDomain}</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 rounded-full px-2 py-0.5">
                <span className="h-1.5 w-1.5 bg-green-500 rounded-full" />
                Connected
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last synced {fmtAgo(connection.lastSyncedAt)} · Webhooks active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isIdle && (
            <Button onClick={() => setSyncDialogOpen(true)} className="gap-2 bg-[#95bf47] hover:bg-[#7aaa2e] text-white" data-testid="btn-sync-shopify-products">
              <Zap className="h-4 w-4" />
              Sync Products
            </Button>
          )}
          {isActive && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Syncing… {pct}%
              </div>
              {isRunning ? (
                <Button variant="outline" size="sm" onClick={() => controlMutation.mutate({ action: "pause" })} disabled={controlMutation.isPending}>
                  <Pause className="h-3.5 w-3.5 mr-1.5" />Pause
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => controlMutation.mutate({ action: "resume" })} disabled={controlMutation.isPending}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />Resume
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => controlMutation.mutate({ action: "cancel" })} disabled={controlMutation.isPending}>
                <XCircle className="h-3.5 w-3.5 mr-1.5" />Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Live Progress Bar (when active) ───────────────────────────── */}
      {isActive && job?.totalShopify && (
        <div className="space-y-1.5 px-1">
          <Progress value={pct} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{job.processed.toLocaleString()} of {job.totalShopify.toLocaleString()} products processed</span>
            <div className="flex items-center gap-3">
              {speed > 0 && <span>{speed.toFixed(1)}/s</span>}
              {eta != null && <span>ETA ~{fmtDuration(eta)}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          <TabsTrigger value="overview" className="gap-1.5 text-sm"><BarChart3 className="h-3.5 w-3.5" />Store Overview</TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-1.5 text-sm"><Warehouse className="h-3.5 w-3.5" />Warehouses</TabsTrigger>
          <TabsTrigger value="advanced" className="gap-1.5 text-sm"><Settings2 className="h-3.5 w-3.5" />Advanced Settings</TabsTrigger>
        </TabsList>

        {/* ── Store Overview ──────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6 mt-4">

          {/* Dashboard metrics */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-[#95bf47]" />
                Shopify Store Summary
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {dashLoading ? "Loading…" : `Last updated ${fmtAgo(dashboard?.lastSyncedAt)}`}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {dashLoading ? Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3 h-16 animate-pulse" />
              )) : [
                { label: "Total Shopify Products", value: dashboard?.shopifyTotal ?? connection.productCount ?? 0, accent: true, icon: <ShoppingBag className="h-3.5 w-3.5" /> },
                { label: "ERP Mapped", value: `${dashboard?.mappedItems ?? 0} / ${dashboard?.erpTotal ?? 0}`, icon: <CheckCheck className="h-3.5 w-3.5 text-green-500" /> },
                { label: "Simple Products", value: dashboard?.simpleItems ?? 0, icon: <Package className="h-3.5 w-3.5" /> },
                { label: "Variant Products", value: dashboard?.variantProducts ?? 0, icon: <ArrowUpDown className="h-3.5 w-3.5" /> },
                { label: "Total Variants", value: dashboard?.totalVariants ?? 0, icon: <PackageCheck className="h-3.5 w-3.5" /> },
                { label: "Warehouses", value: dashboard?.warehouseCount ?? connection.totalWarehouseCount ?? 0, icon: <Warehouse className="h-3.5 w-3.5" /> },
                { label: "Inventory Value", value: fmtMoney(dashboard?.inventoryValue), icon: <TrendingUp className="h-3.5 w-3.5 text-[#95bf47]" /> },
                { label: "Last Sync", value: fmtAgo(dashboard?.lastSyncedAt ?? connection.lastSyncedAt), small: true, icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" /> },
                { label: "Webhooks", value: connection.webhooksRegisteredAt ? "Active" : "None", icon: <Bell className="h-3.5 w-3.5" /> },
                { label: "Sync Status", value: job ? (isActive ? "Running" : "Idle") : "Never run", icon: <Activity className="h-3.5 w-3.5" /> },
              ].map(({ label, value, accent, small, icon }) => (
                <div key={label} className={`rounded-lg border p-3 ${accent ? "bg-[#95bf47]/5 border-[#95bf47]/20" : "bg-muted/30"}`}>
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-1">{icon}<span className="text-[11px]">{label}</span></div>
                  <p className={`font-semibold tabular-nums ${small ? "text-sm" : "text-lg"} ${accent ? "text-[#7aaa2e]" : ""}`}>{value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Quick Actions */}
          <section>
            <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { icon: <Zap className="h-4 w-4 text-[#95bf47]" />, title: "Sync Products", desc: "Import all Shopify products to ERP", onClick: () => setSyncDialogOpen(true), primary: true },
                { icon: <RefreshCw className="h-4 w-4 text-blue-500" />, title: "Push All to Shopify", desc: "Push all linked ERP products to Shopify", onClick: onPushAll, loading: pushingAll },
                { icon: <ArrowLeftRight className="h-4 w-4 text-purple-500" />, title: "Sync Orders", desc: "Pull pending Shopify orders into ERP", onClick: onSyncOrders, loading: syncingOrders },
                { icon: <Eye className="h-4 w-4 text-amber-500" />, title: "Dry Run Preview", desc: "Preview changes before syncing", onClick: () => toast({ title: "Coming soon", description: "Dry run preview will be available shortly." }) },
                { icon: <RotateCcw className="h-4 w-4 text-orange-500" />, title: "Retry Failed", desc: "Re-queue all failed sync items", onClick: () => retryMutation.mutate("failed") },
                { icon: <Download className="h-4 w-4 text-slate-500" />, title: "Export Reports", desc: "CSV · Excel · PDF with filters", onClick: () => handleExport(30) },
              ].map(({ icon, title, desc, onClick, primary, loading }) => (
                <button
                  key={title}
                  onClick={onClick}
                  disabled={!!loading}
                  className={`flex items-center gap-3 rounded-lg border p-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60 ${primary ? "border-[#95bf47]/30 hover:bg-[#95bf47]/5" : ""}`}
                >
                  <div className="flex-shrink-0">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}</div>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto flex-shrink-0" />
                </button>
              ))}
            </div>
          </section>

          {/* Last Sync Summary — clickable stat tiles */}
          {job && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Last Sync Summary
                  <SyncStatusBadge status={job.status} />
                </h3>
                <div className="flex items-center gap-2">
                  {(job.status === "completed_with_errors" || job.status === "failed") && (
                    <>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => retryMutation.mutate("failed")} disabled={retryMutation.isPending}>
                        <RotateCcw className="h-3 w-3" />Retry Failed
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => retryMutation.mutate("skipped")} disabled={retryMutation.isPending}>
                        <SkipForward className="h-3 w-3" />Retry Skipped
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => handleExport(1)}>
                    <Download className="h-3 w-3" />Export
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {[
                  { label: "Shopify Total", value: job.totalShopify ?? "—", status: null, color: "" },
                  { label: "ERP Total", value: job.totalErp ?? "—", status: null, color: "" },
                  { label: "Created", value: job.created, status: "created", color: "text-green-600" },
                  { label: "Updated", value: job.updated, status: "updated", color: "text-blue-600" },
                  { label: "Skipped", value: job.skipped, status: "skipped", color: "text-amber-600" },
                  { label: "Failed", value: job.failed, status: "failed", color: job.failed > 0 ? "text-destructive" : "" },
                  { label: "Missing", value: job.missing, status: "missing", color: job.missing > 0 ? "text-orange-600" : "" },
                  { label: "Duration", value: job.finishedAt ? fmtDuration((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000) : "—", status: null, color: "" },
                ].map(({ label, value, status, color }) => (
                  <button
                    key={label}
                    onClick={() => status && handleStatClick(status)}
                    disabled={!status}
                    className={`rounded-lg border bg-muted/30 p-3 text-center ${status ? "hover:bg-muted/70 hover:border-primary/30 cursor-pointer transition-colors" : ""} ${!status ? "cursor-default" : ""}`}
                  >
                    <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                    <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
                    {status && <p className="text-[10px] text-muted-foreground mt-0.5">Click to view</p>}
                  </button>
                ))}
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Started {fmtTime(job.startedAt)}
                {job.finishedAt && ` · Finished ${fmtTime(job.finishedAt)}`}
              </p>
            </section>
          )}

          {/* Sync History */}
          <SyncHistoryCard />
        </TabsContent>

        {/* ── Warehouses Tab ──────────────────────────────────────────── */}
        <TabsContent value="warehouses" className="mt-4">
          <FixedWarehousesTab />
        </TabsContent>

        {/* ── Advanced Settings ───────────────────────────────────────── */}
        <TabsContent value="advanced" className="mt-4 space-y-4">
          <AdvancedSettingsTab
            connection={connection}
            onDisconnect={onDisconnect}
            disconnecting={disconnecting}
          />
        </TabsContent>
      </Tabs>

      {/* ── Pre-Sync Confirmation Dialog ─────────────────────────────── */}
      <PreSyncDialog
        open={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        onConfirm={() => startMutation.mutate()}
        confirming={startMutation.isPending}
        shopifyTotal={connection.productCount}
      />

      {/* ── Drill-down Sheet ─────────────────────────────────────────── */}
      <DrilldownSheet
        jobId={job?.id ?? null}
        status={drilldownStatus}
        onClose={() => setDrilldownStatus(null)}
      />
    </>
  );
}

// ─── Pre-Sync Confirmation Dialog ────────────────────────────────────────────

function PreSyncDialog({
  open,
  onClose,
  onConfirm,
  confirming,
  shopifyTotal,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
  shopifyTotal: number | null;
}) {
  const now = new Date();
  const browser = typeof navigator !== "undefined" ? navigator.userAgent.split(" ").slice(-1)[0] ?? "Unknown" : "Unknown";
  const browserName = /Chrome/.test(navigator.userAgent) ? "Chrome" : /Firefox/.test(navigator.userAgent) ? "Firefox" : /Safari/.test(navigator.userAgent) ? "Safari" : "Browser";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-[#95bf47]" />
            Sync Products
          </DialogTitle>
          <DialogDescription>Review what this sync will do before starting.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Backup Before Sync?</strong> This operation may update products, prices, inventory, and variants across{" "}
              <strong>{shopifyTotal != null ? `${shopifyTotal.toLocaleString()} Shopify products` : "your Shopify store"}</strong>.
              Do you want to continue?
            </span>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This sync will:</p>
            <ul className="space-y-1.5">
              {[
                "Import all product variants from Shopify",
                "Update prices, SKUs, barcodes, and images",
                "Detect missing ERP items",
                "Record a full audit trail",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#95bf47] flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg bg-muted/50 border p-3 text-xs space-y-1 text-muted-foreground">
            <p><span className="font-medium text-foreground">Triggered by:</span> {typeof window !== "undefined" ? (window as { __clerk_user_email?: string }).__clerk_user_email ?? "Current user" : "Current user"}</p>
            <p><span className="font-medium text-foreground">Device:</span> {browserName} · Web</p>
            <p><span className="font-medium text-foreground">Date/Time:</span> {format(now, "dd MMM yyyy, hh:mm a")}</p>
            <p><span className="font-medium text-foreground">Sync type:</span> Full product sync (Shopify → ERP)</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirming}>Cancel</Button>
          <Button onClick={onConfirm} disabled={confirming} className="bg-[#95bf47] hover:bg-[#7aaa2e] text-white">
            {confirming ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting…</> : <><Zap className="mr-2 h-4 w-4" />Start Sync</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drill-down Sheet ─────────────────────────────────────────────────────────

function DrilldownSheet({
  jobId,
  status,
  onClose,
}: {
  jobId: string | null;
  status: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ items: SyncLog[]; total: number }>({
    queryKey: ["shopify-drilldown", jobId, status],
    queryFn: async () => {
      if (!jobId || !status) return { items: [], total: 0 };
      const r = await fetch(`/api/shopify/product-sync-job/${jobId}/items?status=${status}&limit=100`);
      if (!r.ok) throw new Error("Failed to load items");
      return r.json();
    },
    enabled: !!jobId && !!status,
  });

  const title = status ? {
    failed: "Failed Items",
    skipped: "Skipped Items",
    created: "Created Items",
    updated: "Updated Items",
    missing: "Missing Items",
  }[status] ?? status : "";

  return (
    <Sheet open={!!status} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-[#95bf47]" />
            {title}
          </SheetTitle>
          <SheetDescription>
            {isLoading ? "Loading…" : `${data?.total ?? 0} item${(data?.total ?? 0) !== 1 ? "s" : ""} — most recent 100 shown`}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />Loading items…
          </div>
        ) : !data?.items.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No items found.</div>
        ) : (
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Product / SKU</TableHead>
                  <TableHead className="text-xs w-24">Status</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs font-mono">Shopify ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.id} className={row.status === "error" ? "bg-destructive/5" : undefined}>
                    <TableCell className="text-xs py-2">
                      <div className="truncate font-medium max-w-[200px]">{row.name ?? "—"}</div>
                      {row.sku && <div className="text-muted-foreground font-mono text-[10px]">{row.sku}</div>}
                    </TableCell>
                    <TableCell className="py-2">{statusBadge(row.status)}</TableCell>
                    <TableCell className="text-xs py-2 text-muted-foreground max-w-[180px]">
                      {row.failureReason ? FAILURE_REASON_LABELS[row.failureReason] ?? row.failureReason : "—"}
                      {row.errorMessage && <div className="text-[10px] truncate">{row.errorMessage}</div>}
                    </TableCell>
                    <TableCell className="text-xs font-mono py-2 text-muted-foreground truncate max-w-[100px]">{row.shopifyId ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Fixed Warehouses Tab ─────────────────────────────────────────────────────

function FixedWarehousesTab() {
  const FIXED = [
    { name: "Main Warehouse", code: "MAIN", desc: "Primary storage for physical inventory.", icon: <Warehouse className="h-5 w-5 text-blue-500" /> },
    { name: "Shopify Warehouse", code: "SHOPIFY", desc: "Virtual location for Shopify-fulfilled stock.", icon: <ShopifyIcon className="h-5 w-5 text-[#95bf47]" /> },
    { name: "Store Warehouse", code: "STORE", desc: "Retail / POS in-store stock location.", icon: <Package className="h-5 w-5 text-purple-500" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 border p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="h-4 w-4 flex-shrink-0" />
        <span>Warehouse management is locked. Only these 3 fixed system warehouses are available. Contact your system administrator to make changes.</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {FIXED.map(({ name, code, desc, icon }) => (
          <Card key={code} className="relative overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {icon}
                  <CardTitle className="text-base">{name}</CardTitle>
                </div>
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{desc}</p>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono">{code}</Badge>
                <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/30">System</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Advanced Settings Tab ────────────────────────────────────────────────────

function AdvancedSettingsTab({
  connection,
  onDisconnect,
  disconnecting,
}: {
  connection: ConnectionData;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const handleExport = (days: number) => window.open(`/api/shopify/export-report.csv?days=${days}`, "_blank");

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Store domain</p><p className="font-medium">{connection.shopDomain}</p></div>
          <div><p className="text-xs text-muted-foreground">Last synced</p><p>{fmtTime(connection.lastSyncedAt)}</p></div>
          <div><p className="text-xs text-muted-foreground">Last webhook</p><p>{fmtTime(connection.lastWebhookAt)}</p></div>
          <div><p className="text-xs text-muted-foreground">Webhooks registered</p><p>{fmtTime(connection.webhooksRegisteredAt)}</p></div>
          <div><p className="text-xs text-muted-foreground">Shopify location ID</p><p className="font-mono text-xs">{connection.locationId ?? "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Products tracked</p><p>{connection.productCount ?? 0}</p></div>
          {connection.scopes && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground mb-1">Granted API scopes</p>
              <p className="font-mono text-xs break-all bg-muted rounded p-2">{connection.scopes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Export Reports</CardTitle><CardDescription>Download sync history as CSV</CardDescription></CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          {[["Last 24h", 1], ["Last 7 days", 7], ["Last 30 days", 30]].map(([label, days]) => (
            <Button key={label} variant="outline" size="sm" onClick={() => handleExport(Number(days))}>
              <Download className="h-3.5 w-3.5 mr-1.5" />{label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader><CardTitle className="text-base text-destructive">Danger Zone</CardTitle><CardDescription>These actions cannot be undone.</CardDescription></CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
            onClick={onDisconnect}
            disabled={disconnecting}
            data-testid="btn-disconnect-shopify"
          >
            {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}
            Disconnect Shopify
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sync History Card ────────────────────────────────────────────────────────

const HISTORY_LIMIT = 200;

function SyncHistoryCard() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("7");

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(HISTORY_LIMIT) });
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (entityFilter !== "all") p.set("entity", entityFilter);
    if (daysFilter !== "all") p.set("days", daysFilter);
    return p.toString();
  }, [statusFilter, entityFilter, daysFilter]);

  const { data, isLoading } = useQuery<{ logs: SyncLog[]; summary: { total: number; success: number; error: number; skipped: number } }>({
    queryKey: ["shopify-sync-logs", params],
    queryFn: async () => {
      const r = await fetch(`/api/shopify/sync-logs?${params}`);
      if (!r.ok) throw new Error("Failed to load sync history");
      return r.json();
    },
    staleTime: 30_000,
  });

  const logs = data?.logs ?? [];
  const summary = data?.summary ?? { total: 0, success: 0, error: 0, skipped: 0 };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Sync History
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          {[
            { label: "Success", value: summary.success, icon: <CheckCheck className="h-4 w-4 text-green-500" />, cls: "text-green-600" },
            { label: "Failed",  value: summary.error,   icon: <AlertCircle className="h-4 w-4 text-destructive" />, cls: summary.error > 0 ? "text-destructive" : undefined },
            { label: "Skipped", value: summary.skipped, icon: <SkipForward className="h-4 w-4 text-muted-foreground" />, cls: undefined },
          ].map(({ label, value, icon, cls }) => (
            <div key={label} className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3">
              {icon}
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-xl font-semibold tabular-nums ${cls ?? ""}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        {summary.skipped > 0 && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 p-3 text-xs text-amber-800 dark:text-amber-400 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>{summary.skipped} skipped items</strong> — most are "Not yet in ERP" which means Shopify sent inventory updates for products not yet imported.{" "}
              <strong>Running Product Sync will create ERP records and resolve these skips.</strong>
            </span>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Failed</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="inventory">Inventory</SelectItem>
              <SelectItem value="order">Order</SelectItem>
            </SelectContent>
          </Select>
          <Select value={daysFilter} onValueChange={setDaysFilter}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Period" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
            <Loader2 className="h-4 w-4 animate-spin" />Loading sync history…
          </div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No sync events match the current filters.</div>
        ) : (
          <TooltipProvider>
            <div className="overflow-auto max-h-[400px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-xs w-24">Entity</TableHead>
                    <TableHead className="text-xs w-20">Action</TableHead>
                    <TableHead className="text-xs">Product / SKU</TableHead>
                    <TableHead className="text-xs w-24">Status</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                    <TableHead className="text-xs font-mono">Shopify ID</TableHead>
                    <TableHead className="text-xs w-36">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((row) => (
                    <TableRow key={row.id} className={row.status === "error" ? "bg-destructive/5" : undefined}>
                      <TableCell className="text-xs capitalize py-2">
                        <span className="inline-flex items-center gap-1">
                          {row.direction === "inbound" ? "← " : "→ "}{row.entity}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs py-2 capitalize">{row.action}</TableCell>
                      <TableCell className="text-xs py-2 max-w-[200px]">
                        <div className="truncate font-medium">{row.name ?? "—"}</div>
                        {row.sku && <div className="text-muted-foreground font-mono text-[10px] truncate">{row.sku}</div>}
                        {row.parentItemId && <div className="text-[10px] text-muted-foreground">variant</div>}
                      </TableCell>
                      <TableCell className="py-2">{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-xs py-2 max-w-[180px]">
                        {row.failureReason ? (
                          <span className="inline-flex items-start gap-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px] py-0 h-5 shrink-0">
                              {FAILURE_REASON_LABELS[row.failureReason] ?? row.failureReason}
                            </Badge>
                            {row.errorMessage && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-muted-foreground cursor-help flex-shrink-0 mt-0.5" />
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs text-xs break-words">{row.errorMessage}</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono py-2 text-muted-foreground max-w-[100px] truncate">{row.shopifyId ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2 whitespace-nowrap">{fmtTime(row.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
        {logs.length > 0 && <p className="text-[11px] text-muted-foreground text-right">Showing {logs.length} of up to {HISTORY_LIMIT} most recent events</p>}
      </CardContent>
    </Card>
  );
}
