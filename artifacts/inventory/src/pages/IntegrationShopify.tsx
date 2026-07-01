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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link } from "wouter";
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
  Plus,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { SiShopify } from "react-icons/si";
import { format, formatDistanceToNow } from "date-fns";
import {
  useGetShopifyConnection,
  useDeleteShopifyConnection,
  useSyncShopifyOrders,
  usePushShopifyProducts,
  useStartShopifyInstall,
  getGetShopifyConnectionQueryKey,
} from "@/lib/queryKeys";

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/i;

const connectSchema = z.object({
  shopDomain: z
    .string()
    .min(1, "Store domain is required")
    .transform((v) =>
      v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
    )
    .refine((v) => SHOP_DOMAIN_RE.test(v), {
      message: "Must look like your-store.myshopify.com",
    }),
  apiKey: z.string().min(1, "API Key is required"),
  apiSecret: z.string().min(1, "API Secret Key is required"),
});

type ConnectValues = z.infer<typeof connectSchema>;

function formatTime(value: string | null | undefined) {
  if (!value) return "Never";
  return format(new Date(value), "MMM d, h:mm a");
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatSpeed(itemsPerSec: number): string {
  if (itemsPerSec < 0.1) return "<0.1/s";
  if (itemsPerSec >= 10) return `${Math.round(itemsPerSec)}/s`;
  return `${itemsPerSec.toFixed(1)}/s`;
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

type SyncSummary = {
  total: number;
  success: number;
  error: number;
  skipped: number;
};

type SyncLogsResponse = {
  logs: SyncLog[];
  summary: SyncSummary;
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntegrationShopify() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: connection,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetShopifyConnection();

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
        toast({
          title: "Connection failed",
          description: err instanceof Error ? err.message : "Could not connect to Shopify.",
          variant: "destructive",
        });
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
        toast({
          title: "Order sync complete",
          description: `Imported ${data.ordersImported}, skipped ${data.ordersSkipped}.`,
        });
      },
    },
  });

  const pushProductsMutation = usePushShopifyProducts({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Products pushed to Shopify",
          description: `Queued ${data.itemCount} linked product${data.itemCount === 1 ? "" : "s"} for push.`,
        });
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
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Shopify connection…
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
            <CardTitle className="text-destructive">Couldn't load Shopify status</CardTitle>
            <CardDescription>{error instanceof Error ? error.message : "Unknown error."}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => refetch()} variant="outline"><RefreshCw className="mr-2 h-4 w-4" /> Retry</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {header}

      {!connection?.connected ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <SiShopify className="h-8 w-8 text-[#95bf47]" />
              <div>
                <CardTitle>Connect your Shopify store</CardTitle>
                <CardDescription>
                  Enter your store domain and Shopify app credentials to connect via OAuth.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Form {...connectForm}>
              <form
                onSubmit={connectForm.handleSubmit((v) =>
                  oauthMutation.mutate({ data: { shopDomain: v.shopDomain, apiKey: v.apiKey, apiSecret: v.apiSecret } }),
                )}
                className="space-y-4"
              >
                <FormField
                  control={connectForm.control}
                  name="shopDomain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Shop domain</FormLabel>
                      <FormControl>
                        <Input placeholder="your-store.myshopify.com" autoComplete="off" {...field} data-testid="input-shopify-domain" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={connectForm.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key</FormLabel>
                      <FormControl>
                        <Input placeholder="Shopify app API key" autoComplete="off" {...field} data-testid="input-shopify-api-key" />
                      </FormControl>
                      <FormDescription>Found in your Shopify app's "API credentials" tab.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={connectForm.control}
                  name="apiSecret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Secret Key</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Shopify app API secret key" autoComplete="off" {...field} data-testid="input-shopify-api-secret" />
                      </FormControl>
                      <FormDescription>Used to verify incoming Shopify webhook signatures.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={oauthMutation.isPending} data-testid="btn-connect-shopify">
                  {oauthMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Redirecting to Shopify…</> : <><ExternalLink className="mr-2 h-4 w-4" />Connect with Shopify</>}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Connection status card */}
          <Card className="border-green-200 dark:border-green-900/30">
            <CardHeader className="bg-green-50/50 dark:bg-green-900/10 rounded-t-xl border-b border-green-100 dark:border-green-900/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-[#95bf47] rounded-full animate-pulse" />
                  <CardTitle className="text-lg">Connected to Shopify</CardTitle>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  data-testid="btn-disconnect-shopify"
                >
                  <Unlink className="h-4 w-4 mr-2" /> Disconnect
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="font-medium text-muted-foreground">Store domain</p>
                  <p className="font-medium">{connection.shopDomain}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Last synced</p>
                  <p>{formatTime(connection.lastSyncedAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Products tracked</p>
                  <p>{connection.productCount ?? 0}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Last webhook</p>
                  <p>{formatTime(connection.lastWebhookAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Webhooks registered</p>
                  <p>{formatTime(connection.webhooksRegisteredAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Warehouses mapped</p>
                  <p data-testid="text-shopify-mapped-warehouses">
                    <span className="font-medium">{connection.mappedWarehouseCount ?? 0}</span>{" "}
                    of {connection.totalWarehouseCount ?? 0}
                    {connection.totalWarehouseCount && (connection.mappedWarehouseCount ?? 0) < connection.totalWarehouseCount ? (
                      <>{" — "}<Link href="/warehouses" className="text-primary underline-offset-4 hover:underline" data-testid="link-shopify-map-warehouses">map now</Link></>
                    ) : null}
                  </p>
                </div>
                {connection.scopes && (
                  <div className="col-span-2 sm:col-span-3">
                    <p className="font-medium text-muted-foreground">Granted scopes</p>
                    <p className="font-mono text-xs break-all">{connection.scopes}</p>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="bg-muted/30 border-t py-3 gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => pushProductsMutation.mutate()}
                disabled={pushProductsMutation.isPending}
                data-testid="btn-push-shopify-products"
                title="Push all linked ERP products back to Shopify (name, SKU, barcode, price, status, category)"
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${pushProductsMutation.isPending ? "animate-spin" : ""}`} />
                {pushProductsMutation.isPending ? "Pushing…" : "Push All to Shopify"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncOrdersMutation.mutate()}
                disabled={syncOrdersMutation.isPending}
                data-testid="btn-sync-shopify-orders"
              >
                <ArrowLeftRight className={`mr-2 h-3.5 w-3.5 ${syncOrdersMutation.isPending ? "animate-spin" : ""}`} />
                {syncOrdersMutation.isPending ? "Syncing orders…" : "Sync orders"}
              </Button>
            </CardFooter>
          </Card>

          {/* Enterprise Sync Panel */}
          <EnterpriseSyncPanel onConnectionChange={invalidateConnection} />

          {/* Sync History */}
          <SyncHistoryCard />
        </div>
      )}
    </div>
  );
}

// ─── Enterprise Sync Panel ────────────────────────────────────────────────────

const SYNC_JOB_POLL_INTERVAL_ACTIVE = 2_000;
const SYNC_JOB_POLL_INTERVAL_IDLE = 10_000;

const ACTIVE_STATUSES = new Set(["running", "paused"]);
const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "cancelled", "failed"]);

function EnterpriseSyncPanel({ onConnectionChange }: { onConnectionChange: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: job, refetch: refetchJob } = useQuery<ProductSyncJob | null>({
    queryKey: ["shopify-product-sync-job", activeJobId ?? "latest"],
    queryFn: async () => {
      const url = activeJobId
        ? `/api/shopify/product-sync-job/${activeJobId}`
        : `/api/shopify/product-sync-job/latest`;
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Failed to load sync job");
      return r.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return SYNC_JOB_POLL_INTERVAL_IDLE;
      return ACTIVE_STATUSES.has(data.status) ? SYNC_JOB_POLL_INTERVAL_ACTIVE : SYNC_JOB_POLL_INTERVAL_IDLE;
    },
    staleTime: 1_000,
  });

  // Track when a job finishes so we can invalidate connection stats.
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    const wasActive = prevStatus.current && ACTIVE_STATUSES.has(prevStatus.current);
    const isNowDone = TERMINAL_STATUSES.has(job.status);
    if (wasActive && isNowDone) {
      onConnectionChange();
      queryClient.invalidateQueries({ queryKey: ["shopify-sync-logs"] });
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
      void refetchJob();
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
      toast({ title: "Control action failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    },
  });

  const isRunning = job?.status === "running";
  const isPaused = job?.status === "paused";
  const isActive = isRunning || isPaused;
  const isIdle = !job || TERMINAL_STATUSES.has(job.status);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#95bf47]" />
              Product Sync
            </CardTitle>
            <CardDescription className="mt-0.5">
              Import all Shopify products into your ERP inventory, with live progress tracking
            </CardDescription>
          </div>

          {isIdle && (
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              data-testid="btn-sync-shopify-products"
              className="gap-2"
            >
              {startMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {startMutation.isPending ? "Starting…" : "Sync Products Now"}
            </Button>
          )}

          {isActive && (
            <div className="flex items-center gap-2">
              {isRunning ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => controlMutation.mutate({ action: "pause" })}
                  disabled={controlMutation.isPending}
                >
                  <Pause className="h-3.5 w-3.5 mr-1.5" />
                  Pause
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => controlMutation.mutate({ action: "resume" })}
                  disabled={controlMutation.isPending}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Resume
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => controlMutation.mutate({ action: "cancel" })}
                disabled={controlMutation.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!job && isIdle && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No sync has been run yet. Click <strong>Sync Products Now</strong> to import all Shopify products into your ERP.
          </div>
        )}

        {job && (
          <>
            {/* Status badge + timestamps */}
            <div className="flex items-center gap-3 flex-wrap">
              <SyncStatusBadge status={job.status} />
              <span className="text-xs text-muted-foreground">
                Started {formatDistanceToNow(new Date(job.startedAt), { addSuffix: true })}
              </span>
              {job.finishedAt && (
                <span className="text-xs text-muted-foreground">
                  · Finished in {formatDuration((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}
                </span>
              )}
            </div>

            {/* Progress bar (shown when active or recently completed) */}
            {(isActive || TERMINAL_STATUSES.has(job.status)) && job.totalShopify && (
              <SyncProgressBar job={job} />
            )}

            {/* Error message */}
            {job.status === "failed" && job.error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{job.error}</span>
              </div>
            )}

            {/* Full summary grid */}
            <SyncSummaryGrid job={job} />

            {/* Live activity log (only while active) */}
            {isActive && <LiveActivityLog />}

            {/* Re-run button after completion */}
            {TERMINAL_STATUSES.has(job.status) && job.status !== "running" && (
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {startMutation.isPending ? "Starting…" : "Run Again"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sync Progress Bar ────────────────────────────────────────────────────────

function SyncProgressBar({ job }: { job: ProductSyncJob }) {
  const total = job.totalShopify ?? 0;
  const processed = job.processed;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const elapsedSec = (Date.now() - new Date(job.startedAt).getTime()) / 1000;
  const speed = elapsedSec > 2 && processed > 0 ? processed / elapsedSec : null;
  const remaining = total - processed;
  const etaSec = speed && remaining > 0 ? remaining / speed : null;

  const isActive = job.status === "running" || job.status === "paused";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium tabular-nums">
          {processed.toLocaleString()} / {total.toLocaleString()} products
        </span>
        <span className="font-semibold tabular-nums text-base">{pct}%</span>
      </div>

      <Progress
        value={pct}
        className={`h-3 ${job.status === "paused" ? "opacity-60" : ""}`}
      />

      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <Package className="h-3 w-3" />
          {remaining.toLocaleString()} remaining
        </span>
        {speed !== null && isActive && (
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {formatSpeed(speed)}
          </span>
        )}
        {etaSec !== null && isActive && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            ETA {formatDuration(etaSec)}
          </span>
        )}
        {job.status === "paused" && (
          <span className="text-amber-500 font-medium">Paused — click Resume to continue</span>
        )}
      </div>
    </div>
  );
}

// ─── Sync Summary Grid ────────────────────────────────────────────────────────

function SyncSummaryGrid({ job }: { job: ProductSyncJob }) {
  const pending = job.totalShopify ? Math.max(0, job.totalShopify - job.processed) : 0;

  const stats: { label: string; value: number | null; icon: React.ReactNode; cls?: string; tooltip?: string }[] = [
    {
      label: "Total Shopify",
      value: job.totalShopify,
      icon: <ShoppingBag className="h-4 w-4 text-[#95bf47]" />,
      tooltip: "Total product variants fetched from Shopify",
    },
    {
      label: "Total ERP",
      value: job.totalErp,
      icon: <Package className="h-4 w-4 text-blue-500" />,
      tooltip: "ERP items with a Shopify mapping at sync start",
    },
    {
      label: "Created",
      value: job.created,
      icon: <Plus className="h-4 w-4 text-green-500" />,
      cls: job.created > 0 ? "text-green-600" : undefined,
      tooltip: "New ERP items created from Shopify",
    },
    {
      label: "Updated",
      value: job.updated,
      icon: <ArrowUpDown className="h-4 w-4 text-blue-500" />,
      cls: job.updated > 0 ? "text-blue-600" : undefined,
      tooltip: "Existing ERP items refreshed from Shopify",
    },
    {
      label: "Synced",
      value: job.created + job.updated,
      icon: <PackageCheck className="h-4 w-4 text-green-600" />,
      cls: (job.created + job.updated) > 0 ? "text-green-700 font-semibold" : undefined,
      tooltip: "Total successfully synced (created + updated)",
    },
    {
      label: "Skipped",
      value: job.skipped,
      icon: <SkipForward className="h-4 w-4 text-muted-foreground" />,
      tooltip: "Items skipped (e.g. parent placeholder rows)",
    },
    {
      label: "Failed",
      value: job.failed,
      icon: <PackageX className="h-4 w-4 text-destructive" />,
      cls: job.failed > 0 ? "text-destructive" : undefined,
      tooltip: "Items that failed to sync — see activity log below",
    },
    {
      label: "Pending",
      value: pending,
      icon: <Clock className="h-4 w-4 text-amber-500" />,
      cls: pending > 0 ? "text-amber-600" : "text-muted-foreground",
      tooltip: "Variants not yet processed in this sync run",
    },
    {
      label: "Missing",
      value: job.missing,
      icon: <AlertCircle className="h-4 w-4 text-amber-500" />,
      cls: job.missing > 0 ? "text-amber-600" : undefined,
      tooltip: "ERP items whose Shopify variant no longer exists in Shopify catalog",
    },
  ];

  return (
    <TooltipProvider>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {stats.map((s) => (
          <Tooltip key={s.label}>
            <TooltipTrigger asChild>
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 cursor-default hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-[11px] text-muted-foreground leading-none">{s.label}</span></div>
                <p className={`text-lg font-semibold tabular-nums leading-none ${s.cls ?? ""}`}>
                  {s.value === null ? "—" : s.value.toLocaleString()}
                </p>
              </div>
            </TooltipTrigger>
            {s.tooltip && (
              <TooltipContent side="bottom" className="text-xs max-w-xs">{s.tooltip}</TooltipContent>
            )}
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

// ─── Live Activity Log ────────────────────────────────────────────────────────

function LiveActivityLog() {
  const { data, isLoading } = useQuery<SyncLogsResponse>({
    queryKey: ["shopify-sync-logs-live"],
    queryFn: async () => {
      const r = await fetch("/api/shopify/sync-logs?limit=20&entity=product&days=1");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 2_000,
    staleTime: 1_000,
  });

  const logs = data?.logs ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Live Activity
        {isLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
      </p>
      <div className="rounded-md border bg-muted/20 max-h-48 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground text-center">Waiting for activity…</div>
        ) : (
          <div className="divide-y">
            {logs.map((log) => (
              <div key={log.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <StatusDot status={log.status} />
                <span className="flex-1 truncate font-medium">{log.name ?? log.sku ?? log.shopifyId ?? "—"}</span>
                {log.sku && <span className="text-muted-foreground font-mono text-[10px] hidden sm:block">{log.sku}</span>}
                <span className="capitalize text-muted-foreground whitespace-nowrap">{log.action}</span>
                {log.failureReason && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1 py-0">
                    {FAILURE_REASON_LABELS[log.failureReason] ?? log.failureReason}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "success") return <div className="h-1.5 w-1.5 rounded-full bg-green-500 flex-shrink-0" />;
  if (status === "error") return <div className="h-1.5 w-1.5 rounded-full bg-destructive flex-shrink-0" />;
  return <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />;
}

function SyncStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    running: { label: "Running", cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400" },
    paused: { label: "Paused", cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400" },
    cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
    completed: { label: "Completed", cls: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400" },
    completed_with_errors: { label: "Completed with errors", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    failed: { label: "Failed", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  const Icon = status === "running" ? Loader2 : status === "completed" ? CheckCircle2 : status === "paused" ? Pause : status === "failed" ? AlertCircle : null;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      {Icon && <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />}
      {label}
    </span>
  );
}

// ─── Failure reason labels ─────────────────────────────────────────────────────

const FAILURE_REASON_LABELS: Record<string, string> = {
  validation: "Validation error",
  api_error: "API error",
  missing_data: "Missing data",
  duplicate_sku: "Duplicate SKU",
  rate_limit: "Rate limited",
  skipped_bundle: "Bundle (skipped)",
  skipped_parent: "Parent placeholder",
  skipped_mapped: "Not yet in ERP — run Product Sync to import",
  skipped_no_connection: "No Shopify connection",
};

// ─── Sync History Card ─────────────────────────────────────────────────────────

const SYNC_LOG_QUERY_KEY = ["shopify-sync-logs"];

function SyncHistoryCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [daysFilter, setDaysFilter] = useState<string>("7");

  const params = new URLSearchParams({ limit: "200" });
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (entityFilter !== "all") params.set("entity", entityFilter);
  if (daysFilter !== "all") params.set("days", daysFilter);

  const { data, isLoading, refetch, isFetching } = useQuery<SyncLogsResponse>({
    queryKey: [...SYNC_LOG_QUERY_KEY, statusFilter, entityFilter, daysFilter],
    queryFn: async () => {
      const r = await fetch(`/api/shopify/sync-logs?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to load sync logs");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/shopify/sync-logs/retry-failed", { method: "POST" });
      if (!r.ok) throw new Error("Retry request failed");
      return r.json() as Promise<{ queued: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: result.queued > 0 ? "Retry queued" : "Nothing to retry",
        description: result.queued > 0
          ? `${result.queued} product${result.queued === 1 ? "" : "s"} queued for re-sync.`
          : "All failed items are already mapped or have no retriable errors.",
      });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: SYNC_LOG_QUERY_KEY }), 3000);
    },
    onError: (err: unknown) => {
      toast({ title: "Retry failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    },
  });

  const summary = data?.summary ?? { total: 0, success: 0, error: 0, skipped: 0 };
  const logs = data?.logs ?? [];

  const statusBadge = (s: string) => {
    if (s === "success")
      return <Badge variant="outline" className="text-green-600 border-green-300 gap-1"><CheckCircle2 className="h-3 w-3" /> success</Badge>;
    if (s === "error")
      return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> error</Badge>;
    return <Badge variant="secondary" className="gap-1"><SkipForward className="h-3 w-3" /> {s}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Sync History
            </CardTitle>
            <CardDescription className="mt-1">
              Full audit trail of every Shopify sync operation — refreshes every 30 s
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending || summary.error === 0}
              title={summary.error === 0 ? "No failed syncs to retry" : `Retry ${summary.error} failed sync${summary.error === 1 ? "" : "s"}`}
            >
              {retryMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
              Retry Failed
              {summary.error > 0 && (
                <span className="ml-1.5 rounded-full bg-destructive/15 text-destructive px-1.5 py-0.5 text-[10px] font-semibold">
                  {summary.error}
                </span>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryStat label="Total" value={summary.total} icon={<Activity className="h-4 w-4 text-muted-foreground" />} />
          <SummaryStat label="Success" value={summary.success} icon={<CheckCheck className="h-4 w-4 text-green-500" />} valueClass="text-green-600" />
          <SummaryStat label="Failed" value={summary.error} icon={<AlertCircle className="h-4 w-4 text-destructive" />} valueClass={summary.error > 0 ? "text-destructive" : undefined} />
          <SummaryStat label="Skipped" value={summary.skipped} icon={<SkipForward className="h-4 w-4 text-muted-foreground" />} />
        </div>

        {/* Skipped "Not mapped" explanation */}
        {summary.skipped > 0 && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 p-3 text-xs text-amber-800 dark:text-amber-400 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>{summary.skipped} skipped items</strong> — most are "Not yet in ERP" which means Shopify sent inventory updates for products that haven't been imported yet.{" "}
              <strong>Running Product Sync above will create ERP records for all Shopify products and resolve these skips.</strong>
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Failed</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>

          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="inventory">Inventory</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="order">Order</SelectItem>
            </SelectContent>
          </Select>

          <Select value={daysFilter} onValueChange={setDaysFilter}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Log table */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sync history…
          </div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No sync events match the current filters.
          </div>
        ) : (
          <TooltipProvider>
            <div className="overflow-auto max-h-[480px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-xs w-24">Entity</TableHead>
                    <TableHead className="text-xs w-20">Action</TableHead>
                    <TableHead className="text-xs">Product / SKU</TableHead>
                    <TableHead className="text-xs w-24">Status</TableHead>
                    <TableHead className="text-xs">Reason / Error</TableHead>
                    <TableHead className="text-xs font-mono">Shopify ID</TableHead>
                    <TableHead className="text-xs w-36">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((row) => (
                    <TableRow key={row.id} className={row.status === "error" ? "bg-destructive/5" : undefined}>
                      <TableCell className="text-xs capitalize py-2">
                        <span className="inline-flex items-center gap-1">
                          {row.direction === "inbound" ? "← " : "→ "}
                          {row.entity}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs py-2 capitalize">{row.action}</TableCell>
                      <TableCell className="text-xs py-2 max-w-[220px]">
                        <div className="truncate font-medium">{row.name ?? "—"}</div>
                        {row.sku && (
                          <div className="text-muted-foreground font-mono text-[10px] truncate">{row.sku}</div>
                        )}
                        {row.parentItemId && (
                          <div className="text-[10px] text-muted-foreground">variant</div>
                        )}
                      </TableCell>
                      <TableCell className="py-2">{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-xs py-2 max-w-[200px]">
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
                                <TooltipContent side="left" className="max-w-xs text-xs break-words">
                                  {row.errorMessage}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono py-2 text-muted-foreground max-w-[120px] truncate">
                        {row.shopifyId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2 whitespace-nowrap">
                        {formatTime(row.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}

        {logs.length > 0 && (
          <p className="text-[11px] text-muted-foreground text-right">
            Showing {logs.length} of up to 200 most recent events
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  icon,
  valueClass,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3">
      {icon}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold tabular-nums ${valueClass ?? ""}`}>{value}</p>
      </div>
    </div>
  );
}
