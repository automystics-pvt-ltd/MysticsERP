import { TablePagination } from "@/components/TablePagination";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
  UserCircle2,
  MapPin,
  Shield,
  CalendarDays,
  Link2,
  Globe,
  Gauge,
  Hash,
  Server,
  Webhook,
  ArrowRight,
  MoreHorizontal,
  CheckSquare,
  Database,
  Cpu,
} from "lucide-react";
import { format, formatDistanceToNow, subDays } from "date-fns";
import {
  useGetShopifyConnection,
  useDeleteShopifyConnection,
  useSyncShopifyOrders,
  useStartShopifyInstall,
  getGetShopifyConnectionQueryKey,
} from "@/lib/queryKeys";

// ─── Shopify Icon ─────────────────────────────────────────────────────────────

function ShopifyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 50 57" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M43.4 10.7c0-.2-.2-.3-.3-.3s-3.5-.3-3.5-.3l-2.5-2.5c-.2-.2-.7-.1-.9-.1L34 8.4C32.6 4.4 30 1.7 26.9 1.7h-.3C25.7.6 24.6 0 23.6 0c-7.4 0-10.9 9.2-12 13.9l-5.2 1.6c-1.6.5-1.7.5-1.9 2L1 46.3l33.6 5.8 18.2-4.6L43.4 10.7zM28.1 9.4l-3.6 1.1c0-.4 0-.9-.1-1.4-.4-1.8-1-2.8-1.8-3.3 2 .3 3.9 1.8 5.5 3.6zm-6.3-3c.8.5 1.4 1.6 1.8 3.4.1.4.1.8.1 1.2l-4.3 1.3C20.6 9 22.1 6.7 21.8 6.4zm-1.1-.5c.1 0 .1 0 .2.1-.1 0-.2-.1-.2-.1zm6.5 3.4c-1.6-2-3.6-3.4-5.7-3.8.3-.1.6-.2.8-.2 3.1 0 5.3 3.2 5.9 7l-1-.3v.3z" />
      <path d="M35.4 10.5l-5.3 1.6c-.6-3.8-2.8-7-5.9-7-.3 0-.5.1-.8.1-1.2-1.6-2.7-2.3-4-2.3-9.9.1-14.6 12.4-16.1 18.7l-1.5.5c-1.6.5-1.7.5-1.9 2L.4 43.5l33.1 6.2L49.8 46 35.4 10.5zm-8.8 13.4l-8.7 2.7c.8-3.3 2.9-8 6.3-9.3.7 1.3 1.2 3.2 1.4 5.2l1-.6c-.5-3.1-1.7-5.5-3.3-6.5 2.4.8 4.3 3.4 3.3 8.5zm-5 6.7c-2.4.8-4.4-.5-4.4-.5s1.2-5.3 5.2-6.8l-.8 7.3zM20.8 13c-.6.5-1.2 1.3-1.7 2.2-1.3.4-2.7.8-4.1 1.3C16.6 13.3 19.1 8.9 22 8c-.7 1.2-1 2.7-1.2 5zm6 10.9l-1 .3c-.2-2-.7-3.9-1.4-5.2 1.7.9 2.8 2.7 2.4 4.9z" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "SY";
}

// ─── Types ────────────────────────────────────────────────────────────────────

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
  triggeredByName: string | null;
  triggeredByEmail: string | null;
  triggeredByIp: string | null;
  triggeredByLocation: string | null;
};

type SyncJobAudit = {
  id: string;
  status: string;
  totalShopify: number | null;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  missing: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  triggeredByName: string | null;
  triggeredByEmail: string | null;
  triggeredByIp: string | null;
  triggeredByLocation: string | null;
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

// ─── Badges ───────────────────────────────────────────────────────────────────

function SyncStatusBadge({ status }: { status: ProductSyncJob["status"] }) {
  const cfg = {
    running:               { label: "Running",        className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800/40 animate-pulse" },
    paused:                { label: "Paused",         className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800/40" },
    completed:             { label: "Completed",      className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800/40" },
    completed_with_errors: { label: "With Warnings",  className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800/40" },
    cancelled:             { label: "Cancelled",      className: "bg-muted text-muted-foreground" },
    failed:                { label: "Failed",         className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800/40" },
  }[status] ?? { label: status, className: "bg-muted" };
  return (
    <Badge variant="outline" className={cn("text-[11px] font-medium px-2 py-0.5", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

function statusBadge(status: string) {
  if (status === "success") return (
    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/30 text-[10px] py-0">
      Success
    </Badge>
  );
  if (status === "error") return (
    <Badge variant="outline" className="bg-red-50 text-destructive border-red-200 dark:bg-red-900/20 dark:border-red-900/30 text-[10px] py-0">
      Failed
    </Badge>
  );
  return <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">Skipped</Badge>;
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
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-[#95bf47]" />
              <p className="text-sm">Loading integration status…</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6 max-w-2xl">
        {header}
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Couldn't load Shopify status
            </CardTitle>
            <CardDescription>{error instanceof Error ? error.message : "Unknown error."}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />Retry
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {!connection?.connected ? (
        <ConnectionSetupView
          form={connectForm}
          onSubmit={(v) => oauthMutation.mutate({ data: { shopDomain: v.shopDomain, apiKey: v.apiKey, apiSecret: v.apiSecret } })}
          isPending={oauthMutation.isPending}
        />
      ) : (
        <ConnectedView
          connection={connection}
          onDisconnect={() => disconnectMutation.mutate()}
          disconnecting={disconnectMutation.isPending}
          onSyncOrders={() => syncOrdersMutation.mutate()}
          syncingOrders={syncOrdersMutation.isPending}
          onConnectionChange={invalidateConnection}
        />
      )}
    </div>
  );
}

// ─── Not-Connected: Setup View ────────────────────────────────────────────────

function ConnectionSetupView({
  form,
  onSubmit,
  isPending,
}: {
  form: ReturnType<typeof useForm<ConnectValues>>;
  onSubmit: (v: ConnectValues) => void;
  isPending: boolean;
}) {
  const features = [
    { icon: <ArrowLeftRight className="h-4 w-4 text-[#95bf47]" />, title: "Bi-directional sync", desc: "Products, inventory & orders flow between Shopify and your ERP automatically." },
    { icon: <Bell className="h-4 w-4 text-blue-500" />, title: "Real-time webhooks", desc: "Inventory levels update the moment a Shopify order is placed or fulfilled." },
    { icon: <Shield className="h-4 w-4 text-purple-500" />, title: "Full audit trail", desc: "Every sync job is logged with who triggered it, from where, and what changed." },
    { icon: <Lock className="h-4 w-4 text-slate-500" />, title: "OAuth 2.0 secured", desc: "Credentials are never stored. Shopify's official OAuth flow handles authentication." },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 rounded-xl border bg-card overflow-hidden shadow-sm max-w-4xl">
      {/* Left: branding + features */}
      <div className="bg-gradient-to-br from-[#95bf47]/8 via-background to-[#5a8a1f]/5 border-r p-8 flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-[#95bf47]/15 flex items-center justify-center">
            <ShopifyIcon className="h-7 w-7 text-[#95bf47]" />
          </div>
          <div>
            <h2 className="font-semibold text-lg leading-tight">Connect Shopify</h2>
            <p className="text-sm text-muted-foreground">Link your store to Mystics ERP</p>
          </div>
        </div>

        <div className="space-y-4">
          {features.map(({ icon, title, desc }) => (
            <div key={title} className="flex gap-3">
              <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-background border flex items-center justify-center shadow-sm">
                {icon}
              </div>
              <div>
                <p className="text-sm font-medium leading-tight">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto">
          <div className="flex flex-wrap gap-2">
            {["OAuth 2.0", "HMAC verified", "Multi-location", "Webhooks"].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-[11px] font-medium border rounded-full px-2.5 py-0.5 bg-background text-muted-foreground">
                <CheckCircle2 className="h-2.5 w-2.5 text-[#95bf47]" />{tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="p-8 flex flex-col justify-center">
        <div className="max-w-sm">
          <h3 className="font-semibold text-base mb-1">Store credentials</h3>
          <p className="text-sm text-muted-foreground mb-6">Enter your store domain and API credentials to start the OAuth flow.</p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="shopDomain" render={({ field }) => (
                <FormItem>
                  <FormLabel>Shop domain</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="your-store.myshopify.com" autoComplete="off" className="pl-9" {...field} data-testid="input-shopify-domain" />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="apiKey" render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Shopify app API key" autoComplete="off" className="pl-9" {...field} data-testid="input-shopify-api-key" />
                    </div>
                  </FormControl>
                  <FormDescription className="text-xs">Found in your Shopify app's "API credentials" tab.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="apiSecret" render={({ field }) => (
                <FormItem>
                  <FormLabel>API Secret Key</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="password" placeholder="Shopify app API secret" autoComplete="off" className="pl-9" {...field} data-testid="input-shopify-api-secret" />
                    </div>
                  </FormControl>
                  <FormDescription className="text-xs">Used to verify incoming Shopify webhook signatures.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={isPending} className="w-full bg-[#95bf47] hover:bg-[#7aaa2e] text-white mt-2" data-testid="btn-connect-shopify">
                {isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Redirecting to Shopify…</>
                  : <><ExternalLink className="mr-2 h-4 w-4" />Connect with Shopify</>
                }
              </Button>
            </form>
          </Form>
        </div>
      </div>
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
  onConnectionChange,
}: {
  connection: ConnectionData;
  onDisconnect: () => void;
  disconnecting: boolean;
  onSyncOrders: () => void;
  syncingOrders: boolean;
  onConnectionChange: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [drilldownStatus, setDrilldownStatus] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
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

  return (
    <>
      {/* ── Integration Health Banner ───────────────────────────────────── */}
      <IntegrationBanner
        connection={connection}
        job={job ?? null}
        isActive={isActive}
        isIdle={isIdle}
        isRunning={isRunning}
        pct={pct}
        onSyncStart={() => setSyncDialogOpen(true)}
        onSyncOrders={onSyncOrders}
        syncingOrders={syncingOrders}
        onExport={() => setExportOpen(true)}
        onRetryFailed={() => retryMutation.mutate("failed")}
        retrying={retryMutation.isPending}
      />

      {/* ── Live Sync Command Panel (visible only when active) ─────────── */}
      {isActive && job && (
        <SyncProgressPanel
          job={job}
          pct={pct}
          speed={speed}
          eta={eta}
          isRunning={isRunning}
          isPaused={isPaused}
          onPause={() => controlMutation.mutate({ action: "pause" })}
          onResume={() => controlMutation.mutate({ action: "resume" })}
          onCancel={() => controlMutation.mutate({ action: "cancel" })}
          controlPending={controlMutation.isPending}
        />
      )}

      {/* ── Main Tabs ──────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-10 bg-muted/60 p-1 rounded-lg">
          <TabsTrigger value="overview" className="gap-2 text-sm rounded-md data-[state=active]:shadow-sm">
            <BarChart3 className="h-3.5 w-3.5" />Store Overview
          </TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-2 text-sm rounded-md data-[state=active]:shadow-sm">
            <Warehouse className="h-3.5 w-3.5" />Warehouses
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-2 text-sm rounded-md data-[state=active]:shadow-sm">
            <Settings2 className="h-3.5 w-3.5" />Advanced
          </TabsTrigger>
        </TabsList>

        {/* ── Store Overview ──────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6 mt-5">

          {/* KPI Cards */}
          <KpiSection dashboard={dashboard} dashLoading={dashLoading} connection={connection} />

          {/* Quick Actions */}
          <section>
            <SectionHeader icon={<Zap className="h-4 w-4 text-[#95bf47]" />} title="Quick Actions" desc="Trigger sync operations or pull reports" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              {[
                { icon: <Zap className="h-5 w-5 text-[#95bf47]" />, iconBg: "bg-[#95bf47]/10", title: "Sync Products", desc: "Import all Shopify products to ERP", onClick: () => setSyncDialogOpen(true), primary: true },
                { icon: <ArrowLeftRight className="h-5 w-5 text-purple-500" />, iconBg: "bg-purple-50 dark:bg-purple-900/20", title: "Sync Orders", desc: "Pull pending Shopify orders into ERP", onClick: onSyncOrders, loading: syncingOrders },
                { icon: <Eye className="h-5 w-5 text-amber-500" />, iconBg: "bg-amber-50 dark:bg-amber-900/20", title: "Dry Run Preview", desc: "Preview changes before syncing", onClick: () => toast({ title: "Coming soon", description: "Dry run preview will be available shortly." }) },
                { icon: <RotateCcw className="h-5 w-5 text-orange-500" />, iconBg: "bg-orange-50 dark:bg-orange-900/20", title: "Retry Failed Items", desc: "Re-queue all failed sync items", onClick: () => retryMutation.mutate("failed") },
                { icon: <Download className="h-5 w-5 text-slate-500" />, iconBg: "bg-slate-50 dark:bg-slate-900/20", title: "Export Reports", desc: "CSV with custom date range & filters", onClick: () => setExportOpen(true) },
              ].map(({ icon, iconBg, title, desc, onClick, primary, loading }) => (
                <button
                  key={title}
                  onClick={onClick}
                  disabled={!!loading}
                  className={cn(
                    "group flex items-center gap-4 rounded-xl border bg-card p-4 text-left transition-all",
                    "hover:shadow-sm hover:border-border/80 disabled:opacity-60",
                    primary ? "border-[#95bf47]/30 hover:bg-[#95bf47]/5 hover:border-[#95bf47]/50" : "hover:bg-muted/40",
                  )}
                >
                  <div className={cn("flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center", iconBg)}>
                    {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight">{title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </section>

          {/* Last Sync Summary */}
          {job && (
            <SyncSummarySection
              job={job}
              onDrilldown={(s) => setDrilldownStatus(s)}
              onExport={() => setExportOpen(true)}
              onRetryFailed={() => retryMutation.mutate("failed")}
              onRetrySkipped={() => retryMutation.mutate("skipped")}
              retrying={retryMutation.isPending}
            />
          )}

          {/* Audit Trail */}
          <SyncAuditCard onExport={() => setExportOpen(true)} />

          {/* Event Log */}
          <SyncHistoryCard />
        </TabsContent>

        {/* ── Warehouses ──────────────────────────────────────────────── */}
        <TabsContent value="warehouses" className="mt-5">
          <FixedWarehousesTab />
        </TabsContent>

        {/* ── Advanced Settings ────────────────────────────────────────── */}
        <TabsContent value="advanced" className="mt-5 space-y-5">
          <AdvancedSettingsTab
            connection={connection}
            onDisconnect={onDisconnect}
            disconnecting={disconnecting}
            onExport={() => setExportOpen(true)}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs & sheets */}
      <PreSyncDialog
        open={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        onConfirm={() => startMutation.mutate()}
        confirming={startMutation.isPending}
        shopifyTotal={connection.productCount}
      />
      <DrilldownSheet
        jobId={job?.id ?? null}
        status={drilldownStatus}
        onClose={() => setDrilldownStatus(null)}
      />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}

// ─── Integration Health Banner ────────────────────────────────────────────────

function IntegrationBanner({
  connection,
  job,
  isActive,
  isIdle,
  isRunning,
  pct,
  onSyncStart,
  onSyncOrders,
  syncingOrders,
  onExport,
  onRetryFailed,
  retrying,
}: {
  connection: ConnectionData;
  job: ProductSyncJob | null;
  isActive: boolean;
  isIdle: boolean;
  isRunning: boolean;
  pct: number;
  onSyncStart: () => void;
  onSyncOrders: () => void;
  syncingOrders: boolean;
  onExport: () => void;
  onRetryFailed: () => void;
  retrying: boolean;
}) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm bg-gradient-to-r from-card to-[#95bf47]/3">
      <div className="h-1 w-full bg-gradient-to-r from-[#95bf47] via-[#7aaa2e] to-[#95bf47]/40" />
      <CardContent className="py-5 px-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Left: identity */}
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#95bf47]/12 border border-[#95bf47]/20 flex items-center justify-center flex-shrink-0">
              <ShopifyIcon className="h-6 w-6 text-[#95bf47]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-semibold text-base tracking-tight">{connection.shopDomain}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 rounded-full px-2.5 py-0.5">
                  <span className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse" />
                  Connected
                </span>
                {connection.webhooksRegisteredAt && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-full px-2 py-0.5">
                    <Bell className="h-2.5 w-2.5" />Webhooks
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />Last synced {fmtAgo(connection.lastSyncedAt)}
                </span>
                {connection.productCount != null && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" />{connection.productCount.toLocaleString()} products
                  </span>
                )}
                {isActive && (
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />Syncing {pct}%
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {isIdle && (
              <Button
                onClick={onSyncStart}
                size="sm"
                className="gap-2 bg-[#95bf47] hover:bg-[#7aaa2e] text-white shadow-sm"
                data-testid="btn-sync-shopify-products"
              >
                <Zap className="h-4 w-4" />Sync Products
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onSyncOrders}
              disabled={syncingOrders}
              className="gap-1.5"
            >
              {syncingOrders ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
              Sync Orders
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5 text-muted-foreground">
              <Download className="h-3.5 w-3.5" />Export
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Live Sync Command Panel ──────────────────────────────────────────────────

function SyncProgressPanel({
  job,
  pct,
  speed,
  eta,
  isRunning,
  isPaused,
  onPause,
  onResume,
  onCancel,
  controlPending,
}: {
  job: ProductSyncJob;
  pct: number;
  speed: number;
  eta: number | null;
  isRunning: boolean;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  controlPending: boolean;
}) {
  return (
    <Card className={cn(
      "border overflow-hidden",
      isRunning ? "border-blue-300 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-900/10" : "border-amber-300 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-900/10",
    )}>
      <div className={cn("h-0.5 w-full", isRunning ? "bg-blue-400" : "bg-amber-400")} />
      <CardContent className="py-4 px-6">
        <div className="flex items-center gap-5 flex-wrap">
          {/* Status icon */}
          <div className={cn("h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0", isRunning ? "bg-blue-100 dark:bg-blue-900/30" : "bg-amber-100 dark:bg-amber-900/30")}>
            {isRunning
              ? <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
              : <Pause className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            }
          </div>

          {/* Label + progress */}
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center justify-between mb-2">
              <span className={cn("text-sm font-semibold", isRunning ? "text-blue-700 dark:text-blue-300" : "text-amber-700 dark:text-amber-300")}>
                {isRunning ? "Product Sync Running" : "Product Sync Paused"} — {pct}%
              </span>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {speed > 0 && <span className="flex items-center gap-1"><Gauge className="h-3 w-3" />{speed.toFixed(1)}/s</span>}
                {eta != null && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />ETA ~{fmtDuration(eta)}</span>}
              </div>
            </div>
            <Progress value={pct} className={cn("h-2", isRunning ? "[&>div]:bg-blue-500" : "[&>div]:bg-amber-500")} />
            <p className="text-xs text-muted-foreground mt-1.5">
              {job.processed.toLocaleString()} of {job.totalShopify?.toLocaleString() ?? "?"} products processed
              {job.created > 0 && <span className="ml-2 text-green-600">· {job.created} created</span>}
              {job.updated > 0 && <span className="ml-2 text-blue-600">· {job.updated} updated</span>}
              {job.failed > 0 && <span className="ml-2 text-destructive">· {job.failed} failed</span>}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isRunning ? (
              <Button variant="outline" size="sm" onClick={onPause} disabled={controlPending} className="gap-1.5 h-8">
                <Pause className="h-3.5 w-3.5" />Pause
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onResume} disabled={controlPending} className="gap-1.5 h-8">
                <Play className="h-3.5 w-3.5" />Resume
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onCancel} disabled={controlPending} className="gap-1.5 h-8 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30">
              <XCircle className="h-3.5 w-3.5" />Cancel
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── KPI Section ──────────────────────────────────────────────────────────────

function KpiSection({
  dashboard,
  dashLoading,
  connection,
}: {
  dashboard: DashboardStats | undefined;
  dashLoading: boolean;
  connection: ConnectionData;
}) {
  const primary = [
    {
      label: "Shopify Products",
      value: dashLoading ? null : (dashboard?.shopifyTotal ?? connection.productCount ?? 0),
      icon: <ShoppingBag className="h-5 w-5" />,
      iconCls: "bg-[#95bf47]/12 text-[#95bf47]",
      desc: "Total products in your Shopify store",
      accent: true,
    },
    {
      label: "ERP Coverage",
      value: dashLoading ? null : `${dashboard?.mappedItems ?? 0} / ${dashboard?.erpTotal ?? 0}`,
      icon: <CheckCheck className="h-5 w-5" />,
      iconCls: "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400",
      desc: "Items mapped between Shopify and ERP",
    },
    {
      label: "Inventory Value",
      value: dashLoading ? null : fmtMoney(dashboard?.inventoryValue),
      icon: <TrendingUp className="h-5 w-5" />,
      iconCls: "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400",
      desc: "Total stock value across all warehouses",
    },
  ];

  const secondary = [
    { label: "Simple Products", value: dashboard?.simpleItems ?? 0, icon: <Package className="h-3.5 w-3.5" /> },
    { label: "Variant Products", value: dashboard?.variantProducts ?? 0, icon: <ArrowUpDown className="h-3.5 w-3.5" /> },
    { label: "Total Variants", value: dashboard?.totalVariants ?? 0, icon: <PackageCheck className="h-3.5 w-3.5" /> },
    { label: "Warehouses", value: dashboard?.warehouseCount ?? connection.totalWarehouseCount ?? 0, icon: <Warehouse className="h-3.5 w-3.5" /> },
  ];

  return (
    <section>
      <SectionHeader
        icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
        title="Store Overview"
        desc={dashLoading ? "Loading…" : `Last updated ${fmtAgo(dashboard?.lastSyncedAt ?? connection.lastSyncedAt)}`}
      />

      {/* Primary KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        {primary.map(({ label, value, icon, iconCls, desc, accent }) => (
          <Card key={label} className={cn("border", accent ? "border-[#95bf47]/25 bg-[#95bf47]/3" : "")}>
            <CardContent className="py-5 px-5">
              <div className="flex items-start justify-between">
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", iconCls)}>
                  {icon}
                </div>
              </div>
              <div className="mt-3">
                {dashLoading || value === null ? (
                  <Skeleton className="h-8 w-24 mb-1" />
                ) : (
                  <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
                )}
                <p className="text-sm font-medium mt-0.5">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        {secondary.map(({ label, value, icon }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border px-4 py-3 bg-[#ffffff]">
            <div className="text-muted-foreground">{icon}</div>
            <div>
              <p className="text-xs text-muted-foreground leading-tight">{label}</p>
              {dashLoading ? (
                <Skeleton className="h-4 w-10 mt-0.5" />
              ) : (
                <p className="text-sm font-semibold tabular-nums">{value}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Sync Summary Section ─────────────────────────────────────────────────────

function SyncSummarySection({
  job,
  onDrilldown,
  onExport,
  onRetryFailed,
  onRetrySkipped,
  retrying,
}: {
  job: ProductSyncJob;
  onDrilldown: (status: string) => void;
  onExport: () => void;
  onRetryFailed: () => void;
  onRetrySkipped: () => void;
  retrying: boolean;
}) {
  const tiles = [
    { label: "Shopify Total", value: job.totalShopify ?? "—", status: null, color: "", border: "" },
    { label: "ERP Total",     value: job.totalErp ?? "—",     status: null, color: "", border: "" },
    { label: "Created",  value: job.created,  status: "created", color: "text-green-600 dark:text-green-400",    border: job.created > 0 ? "border-t-green-400" : "" },
    { label: "Updated",  value: job.updated,  status: "updated", color: "text-blue-600 dark:text-blue-400",      border: job.updated > 0 ? "border-t-blue-400" : "" },
    { label: "Skipped",  value: job.skipped,  status: "skipped", color: "text-amber-600 dark:text-amber-400",    border: job.skipped > 0 ? "border-t-amber-400" : "" },
    { label: "Failed",   value: job.failed,   status: "failed",  color: job.failed > 0 ? "text-destructive" : "",         border: job.failed > 0 ? "border-t-destructive" : "" },
    { label: "Missing",  value: job.missing,  status: "missing", color: job.missing > 0 ? "text-orange-600 dark:text-orange-400" : "", border: job.missing > 0 ? "border-t-orange-400" : "" },
    { label: "Duration", value: job.finishedAt ? fmtDuration((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000) : "—", status: null, color: "", border: "" },
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <SectionHeader icon={<Activity className="h-4 w-4" />} title="Last Sync Summary" inline />
          <SyncStatusBadge status={job.status} />
        </div>
        <div className="flex items-center gap-2">
          {(job.status === "completed_with_errors" || job.status === "failed") && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={onRetryFailed} disabled={retrying}>
                <RotateCcw className="h-3 w-3" />Retry Failed
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={onRetrySkipped} disabled={retrying}>
                <SkipForward className="h-3 w-3" />Retry Skipped
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={onExport}>
            <Download className="h-3 w-3" />Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {tiles.map(({ label, value, status, color, border }) => (
          <button
            key={label}
            onClick={() => status && onDrilldown(status)}
            disabled={!status}
            className={cn(
              "rounded-xl border border-b-2 bg-white shadow-sm p-3 text-center transition-all",
              status ? "hover:shadow-md hover:border-b-[3px] cursor-pointer" : "cursor-default",
              border ? border.replace("border-t-", "border-b-") : "border-b-transparent",
            )}
          >
            <p className="text-[10px] text-muted-foreground mb-1.5 leading-tight">{label}</p>
            <p className={cn("text-xl font-bold tabular-nums leading-none", color)}>{value}</p>
            {status && <p className="text-[9px] text-muted-foreground mt-1.5 uppercase tracking-wide">View →</p>}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-2.5 flex items-center gap-1.5">
        <CalendarDays className="h-3 w-3" />
        Started {fmtTime(job.startedAt)}
        {job.finishedAt && ` · Finished ${fmtTime(job.finishedAt)}`}
      </p>
    </section>
  );
}

// ─── Section Header helper ────────────────────────────────────────────────────

function SectionHeader({ icon, title, desc, inline = false }: { icon: React.ReactNode; title: string; desc?: string; inline?: boolean }) {
  if (inline) {
    return (
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground">{icon}</div>
        <span className="text-sm font-semibold">{title}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground">{icon}</div>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {desc && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{desc}</p>}
      </div>
    </div>
  );
}

// ─── Pre-Sync Confirmation Dialog ─────────────────────────────────────────────

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
  const browserName = /Chrome/.test(navigator.userAgent) ? "Chrome" : /Firefox/.test(navigator.userAgent) ? "Firefox" : /Safari/.test(navigator.userAgent) ? "Safari" : "Browser";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <div className="h-8 w-8 rounded-lg bg-[#95bf47]/12 flex items-center justify-center">
              <Zap className="h-4 w-4 text-[#95bf47]" />
            </div>
            Start Product Sync
          </DialogTitle>
          <DialogDescription>Review what this sync will do before starting.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 p-4 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Confirm before continuing</p>
              <p className="text-xs leading-relaxed">
                This will process <strong>{shopifyTotal != null ? `${shopifyTotal.toLocaleString()} Shopify products` : "your Shopify store"}</strong>, updating prices, SKUs, barcodes, and images. Continue?
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">This sync will</p>
            <div className="grid grid-cols-1 gap-2">
              {[
                "Import all product variants from Shopify",
                "Update prices, SKUs, barcodes, and images",
                "Detect missing ERP items",
                "Record a full audit trail with user & IP",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-[#95bf47] flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-muted/60 border p-3.5 text-xs space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <span className="text-muted-foreground">Triggered by</span>
                <p className="font-medium mt-0.5">{(window as { __clerk_user_email?: string }).__clerk_user_email ?? "Current user"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Device</span>
                <p className="font-medium mt-0.5">{browserName} · Web</p>
              </div>
              <div>
                <span className="text-muted-foreground">Date / Time</span>
                <p className="font-medium mt-0.5">{format(now, "dd MMM yyyy, hh:mm a")}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Sync type</span>
                <p className="font-medium mt-0.5">Full product sync</p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirming}>Cancel</Button>
          <Button onClick={onConfirm} disabled={confirming} className="bg-[#95bf47] hover:bg-[#7aaa2e] text-white gap-2">
            {confirming ? <><Loader2 className="h-4 w-4 animate-spin" />Starting…</> : <><Zap className="h-4 w-4" />Start Sync</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drill-down Sheet ─────────────────────────────────────────────────────────

const DRILLDOWN_PAGE_SIZE = 50;

function DrilldownSheet({
  jobId,
  status,
  onClose,
}: {
  jobId: string | null;
  status: string | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [reasonFilter, setReasonFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Reset page & filters when the drilldown target changes
  useEffect(() => {
    setPage(1);
    setReasonFilter("all");
    setSearch("");
  }, [jobId, status]);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      limit: String(DRILLDOWN_PAGE_SIZE),
      offset: String((page - 1) * DRILLDOWN_PAGE_SIZE),
    });
    if (status) p.set("status", status);
    if (reasonFilter !== "all") p.set("failureReason", reasonFilter);
    if (search.trim()) p.set("search", search.trim());
    return p.toString();
  }, [status, page, reasonFilter, search]);

  const { data, isLoading, isFetching } = useQuery<{ items: SyncLog[]; total: number }>({
    queryKey: ["shopify-drilldown", jobId, params],
    queryFn: async () => {
      if (!jobId || !status) return { items: [], total: 0 };
      const r = await fetch(`/api/shopify/product-sync-job/${jobId}/items?${params}`);
      if (!r.ok) throw new Error("Failed to load items");
      return r.json();
    },
    enabled: !!jobId && !!status,
    placeholderData: (prev) => prev,
  });

  const total = data?.total ?? 0;

  const STATUS_META: Record<string, { label: string; icon: React.ReactNode; color: string; badgeCls: string }> = {
    failed:  { label: "Failed Items",  icon: <XCircle className="h-4 w-4" />,       color: "text-destructive",                    badgeCls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400" },
    skipped: { label: "Skipped Items", icon: <SkipForward className="h-4 w-4" />,   color: "text-amber-600 dark:text-amber-400",  badgeCls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400" },
    created: { label: "Created Items", icon: <CheckCircle2 className="h-4 w-4" />,  color: "text-green-600 dark:text-green-400",  badgeCls: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400" },
    updated: { label: "Updated Items", icon: <RefreshCw className="h-4 w-4" />,     color: "text-blue-600 dark:text-blue-400",    badgeCls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400" },
    missing: { label: "Missing Items", icon: <AlertCircle className="h-4 w-4" />,   color: "text-orange-600 dark:text-orange-400", badgeCls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400" },
  };
  const meta = status ? (STATUS_META[status] ?? { label: status, icon: <AlertCircle className="h-4 w-4" />, color: "", badgeCls: "" }) : STATUS_META.failed;

  const showReasonFilter = status === "failed" || status === "skipped";
  const hasFilters = reasonFilter !== "all" || search.trim() !== "";
  const resetFilters = () => { setReasonFilter("all"); setSearch(""); setPage(1); };

  return (
    <Sheet open={!!status} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl flex flex-col bg-white p-0 gap-0"
      >
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b bg-white px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={cn("flex items-center gap-2 font-semibold text-base", meta.color)}>
                {meta.icon}
                {meta.label}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isLoading
                  ? "Loading…"
                  : total === 0
                    ? "No items found"
                    : `${total.toLocaleString()} item${total !== 1 ? "s" : ""} total`
                }
              </p>
            </div>
            <Badge variant="outline" className={cn("text-xs px-2.5 py-1 flex-shrink-0 mt-0.5", meta.badgeCls)}>
              {total.toLocaleString()} {meta.label}
            </Badge>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mt-4 flex-wrap items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Package className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search product name or SKU…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="h-8 pl-8 text-xs bg-white"
              />
            </div>
            {showReasonFilter && (
              <Select value={reasonFilter} onValueChange={(v) => { setReasonFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-44 text-xs bg-white">
                  <SelectValue placeholder="All reasons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {Object.entries(FAILURE_REASON_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* ── Table body ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto bg-white">
          {isLoading && !data ? (
            <div className="flex flex-col gap-2 p-6">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </div>
          ) : !data?.items.length ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <PackageX className="h-12 w-12 text-muted-foreground/25 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No items match the current filters</p>
              {hasFilters && (
                <button onClick={resetFilters} className="mt-2 text-xs text-primary underline underline-offset-2">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className={cn("transition-opacity", isFetching ? "opacity-60" : "opacity-100")}>
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50 border-b">
                    <TableHead className="text-xs font-semibold text-slate-600 py-3 pl-6 w-[40%]">Product / SKU</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 py-3 w-24">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 py-3">Reason / Error</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 py-3 pr-6 font-mono">Shopify ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row, idx) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "border-b last:border-0",
                        row.status === "error"
                          ? "bg-red-50/40 hover:bg-red-50/70"
                          : idx % 2 === 0
                            ? "bg-white hover:bg-slate-50/70"
                            : "bg-slate-50/40 hover:bg-slate-50/80",
                      )}
                    >
                      <TableCell className="text-xs py-3 pl-6 align-top">
                        <div className="font-semibold text-slate-800 leading-tight">{row.name ?? "—"}</div>
                        {row.sku && (
                          <div className="font-mono text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                            <Hash className="h-2.5 w-2.5" />{row.sku}
                          </div>
                        )}
                        {row.parentItemId && (
                          <span className="text-[10px] text-muted-foreground mt-0.5 block">variant</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 align-top">
                        {statusBadge(row.status)}
                      </TableCell>
                      <TableCell className="text-xs py-3 align-top max-w-[220px]">
                        {row.failureReason ? (
                          <div>
                            <Badge variant="outline" className="text-[10px] py-0 h-5 mb-1 font-medium">
                              {FAILURE_REASON_LABELS[row.failureReason] ?? row.failureReason}
                            </Badge>
                            {row.errorMessage && (
                              <p className="text-[10px] text-destructive/80 leading-snug mt-0.5 break-words">
                                {row.errorMessage}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono py-3 pr-6 align-top text-slate-400 max-w-[120px]">
                        <span className="truncate block">{row.shopifyId ?? "—"}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ── Pagination footer ────────────────────────────────────── */}
        {total > 0 && (
          <div className="flex-shrink-0 border-t bg-white px-6 py-3">
            <TablePagination
              total={total}
              page={page}
              pageSize={DRILLDOWN_PAGE_SIZE}
              onPageChange={setPage}
              itemLabel="items"
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Fixed Warehouses Tab ─────────────────────────────────────────────────────

function FixedWarehousesTab() {
  const FIXED = [
    {
      name: "Main Warehouse",
      code: "MAIN",
      desc: "Primary storage location for all physical inventory items.",
      icon: <Warehouse className="h-6 w-6 text-blue-500" />,
      iconBg: "bg-blue-50 dark:bg-blue-900/20",
      badge: "Primary",
      badgeCls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/40",
    },
    {
      name: "Shopify Warehouse",
      code: "SHOPIFY",
      desc: "Virtual location for Shopify-fulfilled and dropshipped stock.",
      icon: <ShopifyIcon className="h-6 w-6 text-[#95bf47]" />,
      iconBg: "bg-[#95bf47]/10",
      badge: "Virtual",
      badgeCls: "bg-[#95bf47]/10 text-[#5a8a1f] border-[#95bf47]/30",
    },
    {
      name: "Store Warehouse",
      code: "STORE",
      desc: "Retail / POS in-store stock location for walk-in sales.",
      icon: <Package className="h-6 w-6 text-purple-500" />,
      iconBg: "bg-purple-50 dark:bg-purple-900/20",
      badge: "Retail",
      badgeCls: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800/40",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-4 py-3 flex items-start gap-3 text-sm">
        <Lock className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div>
          <p className="font-medium text-amber-800 dark:text-amber-300 text-xs">Warehouse management is locked</p>
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            Only these 3 fixed system warehouses are available for Shopify integration. Contact your system administrator to make changes.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {FIXED.map(({ name, code, desc, icon, iconBg, badge, badgeCls }) => (
          <Card key={code} className="relative overflow-hidden hover:shadow-sm transition-shadow">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-border to-transparent" />
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center", iconBg)}>
                  {icon}
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={cn("text-[10px] font-medium", badgeCls)}>{badge}</Badge>
                  <Lock className="h-3 w-3 text-muted-foreground" />
                </div>
              </div>
              <h4 className="font-semibold text-sm leading-tight">{name}</h4>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
              <div className="mt-3 pt-3 border-t">
                <Badge variant="outline" className="font-mono text-[10px] tracking-wide">{code}</Badge>
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
  onExport,
}: {
  connection: ConnectionData;
  onDisconnect: () => void;
  disconnecting: boolean;
  onExport: () => void;
}) {
  const details = [
    { label: "Store domain",          value: connection.shopDomain,         icon: <Globe className="h-4 w-4 text-muted-foreground" /> },
    { label: "Last synced",           value: fmtTime(connection.lastSyncedAt), icon: <Clock className="h-4 w-4 text-muted-foreground" /> },
    { label: "Last webhook",          value: fmtTime(connection.lastWebhookAt), icon: <Bell className="h-4 w-4 text-muted-foreground" /> },
    { label: "Webhooks registered",   value: fmtTime(connection.webhooksRegisteredAt), icon: <Webhook className="h-4 w-4 text-muted-foreground" /> },
    { label: "Shopify location ID",   value: connection.locationId ?? "—",   icon: <Hash className="h-4 w-4 text-muted-foreground" />, mono: true },
    { label: "Products tracked",      value: connection.productCount ?? 0,   icon: <Package className="h-4 w-4 text-muted-foreground" /> },
  ];

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Connection details */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <Link2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Connection Details</CardTitle>
              <CardDescription className="text-xs">Technical information about your Shopify connection</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-0 divide-y divide-x-0 rounded-xl border overflow-hidden">
            {details.map(({ label, value, icon, mono }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3 even:bg-muted/20">
                {icon}
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-tight">{label}</p>
                  <p className={cn("text-sm font-medium mt-0.5 truncate", mono ? "font-mono text-xs" : "")}>{String(value)}</p>
                </div>
              </div>
            ))}
          </div>

        </CardContent>
      </Card>

      {/* Export reports */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <Download className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Export Reports</CardTitle>
              <CardDescription className="text-xs">Download sync event log as CSV with custom date range and filters</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <Button variant="outline" size="sm" onClick={onExport} className="gap-2">
            <Download className="h-3.5 w-3.5" />Export CSV with Date Range…
          </Button>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-destructive">Danger Zone</CardTitle>
              <CardDescription className="text-xs">These actions are irreversible and cannot be undone.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-medium">Disconnect Shopify</p>
              <p className="text-xs text-muted-foreground mt-0.5">Removes the connection, webhooks, and all sync settings for this store.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40 flex-shrink-0"
              onClick={onDisconnect}
              disabled={disconnecting}
              data-testid="btn-disconnect-shopify"
            >
              {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}
              Disconnect Shopify
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sync History Card ────────────────────────────────────────────────────────

const HISTORY_PAGE_SIZE = 50;

function SyncHistoryCard() {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("7");
  const [search, setSearch] = useState("");

  // Reset page on filter change
  const handleFilterChange = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE), offset: String((page - 1) * HISTORY_PAGE_SIZE) });
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (entityFilter !== "all") p.set("entity", entityFilter);
    if (daysFilter !== "all") p.set("days", daysFilter);
    if (search.trim()) p.set("search", search.trim());
    return p.toString();
  }, [statusFilter, entityFilter, daysFilter, search, page]);

  const { data, isLoading, isFetching } = useQuery<{ logs: SyncLog[]; total: number; summary: { total: number; success: number; error: number; skipped: number } }>({
    queryKey: ["shopify-sync-logs", params],
    queryFn: async () => {
      const r = await fetch(`/api/shopify/sync-logs?${params}`);
      if (!r.ok) throw new Error("Failed to load sync history");
      return r.json();
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const summary = data?.summary ?? { total: 0, success: 0, error: 0, skipped: 0 };
  const hasFilters = statusFilter !== "all" || entityFilter !== "all" || daysFilter !== "7" || search.trim() !== "";
  const resetFilters = () => { setStatusFilter("all"); setEntityFilter("all"); setDaysFilter("7"); setSearch(""); setPage(1); };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Sync Event Log
            </CardTitle>
            <CardDescription className="mt-0.5">Individual product-level sync events and webhook callbacks.</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Summary pills */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Success", value: summary.success, icon: <CheckCheck className="h-4 w-4 text-green-500" />, cls: "text-green-700 dark:text-green-400", bg: "bg-green-50/60 dark:bg-green-900/15" },
            { label: "Failed",  value: summary.error,   icon: <AlertCircle className="h-4 w-4 text-destructive" />, cls: summary.error > 0 ? "text-destructive" : "text-muted-foreground", bg: summary.error > 0 ? "bg-red-50/60 dark:bg-red-900/15" : "bg-muted/40" },
            { label: "Skipped", value: summary.skipped, icon: <SkipForward className="h-4 w-4 text-muted-foreground" />, cls: "text-muted-foreground", bg: "bg-muted/40" },
          ].map(({ label, value, icon, cls, bg }) => (
            <div key={label} className={cn("rounded-xl border p-4 flex items-center gap-3 mt-[0px] mb-[0px]", bg)}>
              {icon}
              <div>
                <p className="text-xs text-muted-foreground leading-tight">{label}</p>
                <p className={cn("text-2xl font-bold tabular-nums leading-tight mt-0.5", cls)}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        {summary.skipped > 0 && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-4 py-3 text-xs text-amber-800 dark:text-amber-400 flex items-start gap-2.5">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>{summary.skipped} skipped items</strong> — most are "Not yet in ERP" (Shopify sent inventory updates for products not yet imported).{" "}
              <strong>Running Product Sync will resolve these.</strong>
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Package className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search product name or SKU…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={handleFilterChange(setStatusFilter)}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Failed</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={handleFilterChange(setEntityFilter)}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="inventory">Inventory</SelectItem>
              <SelectItem value="order">Order</SelectItem>
            </SelectContent>
          </Select>
          <Select value={daysFilter} onValueChange={handleFilterChange(setDaysFilter)}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Period" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <button onClick={resetFilters} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors">
              Reset filters
            </button>
          )}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No sync events match the current filters</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Try adjusting the filters above</p>
          </div>
        ) : (
          <TooltipProvider>
            <div className={cn("rounded-xl border overflow-hidden transition-opacity", isFetching ? "opacity-60" : "opacity-100")}>
              <Table>
                <TableHeader className="sticky top-0 bg-slate-50 z-10">
                  <TableRow className="hover:bg-transparent border-b">
                    <TableHead className="text-xs font-semibold text-slate-600 w-24 py-3">Entity</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 w-20 py-3">Action</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 py-3">Product / SKU</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 w-24 py-3">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 py-3">Reason</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 font-mono py-3">Shopify ID</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 w-36 py-3">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((row, idx) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "border-b last:border-0",
                        row.status === "error" ? "bg-red-50/40 hover:bg-red-50/70" : idx % 2 === 0 ? "bg-white hover:bg-slate-50/70" : "bg-slate-50/40 hover:bg-slate-50/80",
                      )}
                    >
                      <TableCell className="text-xs capitalize py-2.5">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          {row.direction === "inbound" ? "← " : "→ "}{row.entity}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs py-2.5 capitalize text-muted-foreground">{row.action}</TableCell>
                      <TableCell className="text-xs py-2.5 max-w-[200px]">
                        <div className="truncate font-semibold text-slate-800">{row.name ?? "—"}</div>
                        {row.sku && <div className="text-muted-foreground font-mono text-[10px] truncate mt-0.5 flex items-center gap-1"><Hash className="h-2.5 w-2.5" />{row.sku}</div>}
                        {row.parentItemId && <div className="text-[10px] text-muted-foreground">variant</div>}
                      </TableCell>
                      <TableCell className="py-2.5">{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-xs py-2.5 max-w-[180px]">
                        {row.failureReason ? (
                          <span className="inline-flex items-start gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-[10px] py-0 h-5 shrink-0">
                              {FAILURE_REASON_LABELS[row.failureReason] ?? row.failureReason}
                            </Badge>
                            {row.errorMessage && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-muted-foreground cursor-help flex-shrink-0 mt-1" />
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs text-xs break-words">{row.errorMessage}</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono py-2.5 text-slate-400 max-w-[100px] truncate">{row.shopifyId ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5 whitespace-nowrap">{fmtTime(row.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}

        <TablePagination
          total={total}
          page={page}
          pageSize={HISTORY_PAGE_SIZE}
          onPageChange={setPage}
          itemLabel="events"
        />
      </CardContent>
    </Card>
  );
}

// ─── Sync Audit Card ──────────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE = 50;

function SyncAuditCard({ onExport }: { onExport: () => void }) {
  const [page, setPage] = useState(1);

  const auditParams = useMemo(() => new URLSearchParams({
    limit: String(AUDIT_PAGE_SIZE),
    offset: String((page - 1) * AUDIT_PAGE_SIZE),
  }).toString(), [page]);

  const { data, isLoading, isFetching } = useQuery<{ jobs: SyncJobAudit[]; total: number }>({
    queryKey: ["shopify-sync-jobs", auditParams],
    queryFn: async () => {
      const r = await fetch(`/api/shopify/sync-jobs?${auditParams}`);
      if (!r.ok) throw new Error("Failed to load sync jobs");
      return r.json();
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const jobs = data?.jobs ?? [];
  const auditTotal = data?.total ?? 0;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#95bf47]" />
              Sync Audit Trail
            </CardTitle>
            <CardDescription className="mt-0.5">
              Full record of every sync job — who triggered it, from where, and what changed.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 flex-shrink-0" onClick={onExport}>
            <Download className="h-3.5 w-3.5" />Export
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : !jobs?.length ? (
          <div className="py-12 text-center">
            <Shield className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No sync jobs recorded yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Run your first sync to begin building the audit trail.</p>
          </div>
        ) : (
          <div className={cn("rounded-xl border overflow-hidden transition-opacity", isFetching ? "opacity-60" : "opacity-100")}>
            <Table>
              <TableHeader className="sticky top-0 bg-slate-50 z-10">
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead className="text-xs font-semibold text-slate-600 w-52 py-3">Triggered by</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-600 py-3">IP / Location</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-600 py-3">Results</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-600 w-28 py-3">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-600 w-36 py-3">Date / Time</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-600 w-20 py-3">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job, idx) => {
                  const durationSecs = job.finishedAt
                    ? (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000
                    : null;
                  const initials = getInitials(job.triggeredByName, job.triggeredByEmail);
                  return (
                    <TableRow
                      key={job.id}
                      className={cn(
                        "border-b last:border-0",
                        job.status === "failed" ? "bg-red-50/40 hover:bg-red-50/70" : idx % 2 === 0 ? "bg-white hover:bg-slate-50/70" : "bg-slate-50/40 hover:bg-slate-50/80",
                      )}
                    >
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-7 w-7 flex-shrink-0 text-[10px] font-semibold">
                            <AvatarFallback className="bg-[#95bf47]/15 text-[#5a8a1f] text-[10px]">{initials}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold leading-tight truncate">{job.triggeredByName ?? "System / Unknown"}</p>
                            {job.triggeredByEmail && (
                              <p className="text-[10px] text-muted-foreground leading-tight truncate max-w-[150px]">{job.triggeredByEmail}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-[10px] font-mono text-muted-foreground leading-tight truncate">{job.triggeredByIp ?? "—"}</p>
                            {job.triggeredByLocation && (
                              <p className="text-[10px] text-muted-foreground leading-tight">{job.triggeredByLocation}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {job.created > 0 && <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">+{job.created} created</span>}
                          {job.updated > 0 && <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">{job.updated} updated</span>}
                          {job.failed > 0 && <span className="text-[10px] font-semibold text-destructive">{job.failed} failed</span>}
                          {job.skipped > 0 && <span className="text-[10px] text-muted-foreground">{job.skipped} skipped</span>}
                          {job.missing > 0 && <span className="text-[10px] text-orange-500 dark:text-orange-400">{job.missing} missing</span>}
                          {job.created === 0 && job.updated === 0 && job.failed === 0 && (
                            <span className="text-[10px] text-muted-foreground italic">No changes</span>
                          )}
                        </div>
                        {job.totalShopify != null && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{job.processed.toLocaleString()} / {job.totalShopify.toLocaleString()} processed</p>
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <SyncStatusBadge status={job.status as ProductSyncJob["status"]} />
                      </TableCell>
                      <TableCell className="py-3">
                        <p className="text-xs font-medium whitespace-nowrap">{fmtTime(job.startedAt)}</p>
                        <p className="text-[10px] text-muted-foreground">{fmtAgo(job.startedAt)}</p>
                      </TableCell>
                      <TableCell className="py-3 text-xs text-muted-foreground font-mono">
                        {durationSecs != null ? fmtDuration(durationSecs) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <TablePagination
          total={auditTotal}
          page={page}
          pageSize={AUDIT_PAGE_SIZE}
          onPageChange={setPage}
          itemLabel="sync jobs"
        />
      </CardContent>
    </Card>
  );
}

// ─── Export Dialog ────────────────────────────────────────────────────────────

function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const [fromDate, setFromDate] = useState(thirtyDaysAgo);
  const [toDate, setToDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState("all");

  const handleQuickRange = (days: number) => {
    const to = new Date();
    const from = days === 0 ? new Date() : subDays(to, days);
    setToDate(format(to, "yyyy-MM-dd"));
    setFromDate(format(from, "yyyy-MM-dd"));
  };

  const handleDownload = () => {
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    if (statusFilter !== "all") params.set("status", statusFilter);
    window.open(`/api/shopify/export-report.csv?${params.toString()}`, "_blank");
    onClose();
  };

  const quickRanges = [
    { label: "Today", days: 0 },
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md bg-white dark:bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <CalendarDays className="h-4 w-4 text-[#95bf47]" />
            </div>
            Export Sync Report
          </DialogTitle>
          <DialogDescription>Download the sync event log as CSV. Select a date range and optional status filter.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Quick ranges */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick range</p>
            <div className="flex gap-1.5 flex-wrap">
              {quickRanges.map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => handleQuickRange(days)}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted hover:border-border transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Date pickers */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">From date</label>
              <Input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">To date</label>
              <Input
                type="date"
                value={toDate}
                min={fromDate}
                max={today}
                onChange={(e) => setToDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* Status filter */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Status filter</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                <SelectItem value="success">Success only</SelectItem>
                <SelectItem value="error">Errors only</SelectItem>
                <SelectItem value="skipped">Skipped only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Preview summary */}
          <div className="rounded-xl bg-muted/60 border p-3.5 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Date range</span>
              <span className="font-medium">{fromDate || "—"} → {toDate || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">{statusFilter === "all" ? "All events" : statusFilter}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Format</span>
              <span className="font-medium">CSV · up to 5,000 rows</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleDownload} disabled={!fromDate || !toDate} className="gap-2">
            <Download className="h-4 w-4" />Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
