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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link } from "wouter";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { SiShopify } from "react-icons/si";
import { format } from "date-fns";
import {
  useGetShopifyConnection,
  useDeleteShopifyConnection,
  useSyncShopify,
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

  const invalidateConnection = () =>
    queryClient.invalidateQueries({
      queryKey: getGetShopifyConnectionQueryKey(),
    });

  const connectForm = useForm<ConnectValues>({
    resolver: zodResolver(connectSchema),
    defaultValues: { shopDomain: "", apiKey: "", apiSecret: "" },
  });

  const oauthMutation = useStartShopifyInstall({
    mutation: {
      onSuccess: (data) => {
        window.location.href = data.installUrl;
      },
      onError: (err: unknown) => {
        toast({
          title: "Connection failed",
          description:
            err instanceof Error
              ? err.message
              : "Could not connect to Shopify. Check your credentials and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const disconnectMutation = useDeleteShopifyConnection({
    mutation: {
      onSuccess: () => {
        invalidateConnection();
        toast({ title: "Shopify disconnected" });
      },
    },
  });

  const syncProductsMutation = useSyncShopify({
    mutation: {
      onSuccess: (data) => {
        invalidateConnection();
        toast({
          title: "Product sync complete",
          description: `Imported ${data.productsImported}, updated ${data.productsUpdated}.`,
        });
      },
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
        toast({
          title: "Push failed",
          description: err instanceof Error ? err.message : "Try again",
          variant: "destructive",
        });
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
      <div className="space-y-6 max-w-2xl" data-testid="shopify-loading">
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
      <div className="space-y-6 max-w-2xl" data-testid="shopify-error">
        {header}
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">
              Couldn't load Shopify status
            </CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : "Unknown error."}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
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
                  oauthMutation.mutate({
                    data: {
                      shopDomain: v.shopDomain,
                      apiKey: v.apiKey,
                      apiSecret: v.apiSecret,
                    },
                  }),
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
                        <Input
                          placeholder="your-store.myshopify.com"
                          autoComplete="off"
                          {...field}
                          data-testid="input-shopify-domain"
                        />
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
                        <Input
                          placeholder="Shopify app API key"
                          autoComplete="off"
                          {...field}
                          data-testid="input-shopify-api-key"
                        />
                      </FormControl>
                      <FormDescription>
                        Found in your Shopify app's "API credentials" tab.
                      </FormDescription>
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
                        <Input
                          type="password"
                          placeholder="Shopify app API secret key"
                          autoComplete="off"
                          {...field}
                          data-testid="input-shopify-api-secret"
                        />
                      </FormControl>
                      <FormDescription>
                        Used to verify incoming Shopify webhook signatures.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  disabled={oauthMutation.isPending}
                  data-testid="btn-connect-shopify"
                >
                  {oauthMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Redirecting to Shopify…
                    </>
                  ) : (
                    <>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Connect with Shopify
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="border-green-200 dark:border-green-900/30">
            <CardHeader className="bg-green-50/50 dark:bg-green-900/10 rounded-t-xl border-b border-green-100 dark:border-green-900/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-[#95bf47] rounded-full animate-pulse" />
                  <CardTitle className="text-lg">
                    Connected to Shopify
                  </CardTitle>
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
              <div className="grid grid-cols-2 gap-4 text-sm">
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
                    <span className="font-medium">
                      {connection.mappedWarehouseCount ?? 0}
                    </span>{" "}
                    of {connection.totalWarehouseCount ?? 0}
                    {connection.totalWarehouseCount &&
                    (connection.mappedWarehouseCount ?? 0) <
                      connection.totalWarehouseCount ? (
                      <>
                        {" — "}
                        <Link
                          href="/warehouses"
                          className="text-primary underline-offset-4 hover:underline"
                          data-testid="link-shopify-map-warehouses"
                        >
                          map now
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                {connection.scopes && (
                  <div className="col-span-2">
                    <p className="font-medium text-muted-foreground">Granted scopes</p>
                    <p className="font-mono text-xs break-all">{connection.scopes}</p>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="bg-muted/30 border-t py-4 gap-2 flex-wrap">
              <Button
                onClick={() => syncProductsMutation.mutate()}
                disabled={syncProductsMutation.isPending}
                data-testid="btn-sync-shopify-products"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${syncProductsMutation.isPending ? "animate-spin" : ""}`}
                />
                {syncProductsMutation.isPending ? "Syncing products…" : "Sync products now"}
              </Button>
              <Button
                variant="outline"
                onClick={() => pushProductsMutation.mutate()}
                disabled={pushProductsMutation.isPending}
                data-testid="btn-push-shopify-products"
                title="Push all linked inventory products back to Shopify (name, SKU, barcode, price, status, category)"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${pushProductsMutation.isPending ? "animate-spin" : ""}`}
                />
                {pushProductsMutation.isPending ? "Pushing products…" : "Sync All Products to Shopify"}
              </Button>
              <Button
                variant="outline"
                onClick={() => syncOrdersMutation.mutate()}
                disabled={syncOrdersMutation.isPending}
                data-testid="btn-sync-shopify-orders"
              >
                <ArrowLeftRight
                  className={`mr-2 h-4 w-4 ${syncOrdersMutation.isPending ? "animate-spin" : ""}`}
                />
                {syncOrdersMutation.isPending ? "Syncing orders…" : "Sync orders now"}
              </Button>
            </CardFooter>
          </Card>

          <SyncHistoryCard />
        </div>
      )}
    </div>
  );
}

// ─── Sync History Card ────────────────────────────────────────────────────────

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
        description:
          result.queued > 0
            ? `${result.queued} product${result.queued === 1 ? "" : "s"} queued for re-sync.`
            : "All failed items are already mapped or have no retriable errors.",
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: SYNC_LOG_QUERY_KEY });
      }, 3000);
    },
    onError: (err: unknown) => {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    },
  });

  const summary = data?.summary ?? { total: 0, success: 0, error: 0, skipped: 0 };
  const logs = data?.logs ?? [];

  const statusBadge = (s: string) => {
    if (s === "success")
      return (
        <Badge variant="outline" className="text-green-600 border-green-300 gap-1">
          <CheckCircle2 className="h-3 w-3" /> success
        </Badge>
      );
    if (s === "error")
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" /> error
        </Badge>
      );
    return (
      <Badge variant="secondary" className="gap-1">
        <SkipForward className="h-3 w-3" /> {s}
      </Badge>
    );
  };

  const failureReasonLabel: Record<string, string> = {
    validation: "Validation",
    api_error: "API error",
    missing_data: "Missing data",
    duplicate_sku: "Duplicate SKU",
    rate_limit: "Rate limit",
    skipped_bundle: "Bundle (skipped)",
    skipped_parent: "Parent (skipped)",
    skipped_mapped: "Not mapped",
    skipped_no_connection: "No connection",
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
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
              {retryMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
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
          <SummaryStat
            label="Total"
            value={summary.total}
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          />
          <SummaryStat
            label="Success"
            value={summary.success}
            icon={<CheckCheck className="h-4 w-4 text-green-500" />}
            valueClass="text-green-600"
          />
          <SummaryStat
            label="Failed"
            value={summary.error}
            icon={<AlertCircle className="h-4 w-4 text-destructive" />}
            valueClass={summary.error > 0 ? "text-destructive" : undefined}
          />
          <SummaryStat
            label="Skipped"
            value={summary.skipped}
            icon={<SkipForward className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

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
                    <TableHead className="text-xs">Failure reason</TableHead>
                    <TableHead className="text-xs font-mono">Shopify ID</TableHead>
                    <TableHead className="text-xs w-36">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((row) => (
                    <TableRow
                      key={row.id}
                      className={row.status === "error" ? "bg-destructive/5" : undefined}
                    >
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
                          <div className="text-muted-foreground font-mono text-[10px] truncate">
                            {row.sku}
                          </div>
                        )}
                        {row.parentItemId && (
                          <div className="text-[10px] text-muted-foreground">variant</div>
                        )}
                      </TableCell>
                      <TableCell className="py-2">{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-xs py-2">
                        {row.failureReason ? (
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] py-0 h-5">
                              {failureReasonLabel[row.failureReason] ?? row.failureReason}
                            </Badge>
                            {row.errorMessage && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-muted-foreground cursor-help flex-shrink-0" />
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
