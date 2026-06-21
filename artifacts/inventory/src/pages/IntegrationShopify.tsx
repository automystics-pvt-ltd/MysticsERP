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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link } from "wouter";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  RefreshCw,
  Unlink,
  CheckCircle2,
  ExternalLink,
  ArrowLeftRight,
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
    <div className="space-y-6 max-w-2xl">
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
                  <p className="font-medium text-muted-foreground">
                    Store domain
                  </p>
                  <p className="font-medium">{connection.shopDomain}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">
                    Last synced
                  </p>
                  <p>{formatTime(connection.lastSyncedAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">
                    Products tracked
                  </p>
                  <p>{connection.productCount ?? 0}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">
                    Last webhook
                  </p>
                  <p>{formatTime(connection.lastWebhookAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">
                    Webhooks registered
                  </p>
                  <p>{formatTime(connection.webhooksRegisteredAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">
                    Warehouses mapped
                  </p>
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
                    <p className="font-medium text-muted-foreground">
                      Granted scopes
                    </p>
                    <p className="font-mono text-xs break-all">
                      {connection.scopes}
                    </p>
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
                  className={`mr-2 h-4 w-4 ${
                    syncProductsMutation.isPending ? "animate-spin" : ""
                  }`}
                />
                {syncProductsMutation.isPending
                  ? "Syncing products…"
                  : "Sync products now"}
              </Button>
              <Button
                variant="outline"
                onClick={() => pushProductsMutation.mutate()}
                disabled={pushProductsMutation.isPending}
                data-testid="btn-push-shopify-products"
                title="Push all linked inventory products back to Shopify (name, SKU, barcode, price, status, category)"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    pushProductsMutation.isPending ? "animate-spin" : ""
                  }`}
                />
                {pushProductsMutation.isPending
                  ? "Pushing products…"
                  : "Sync All Products to Shopify"}
              </Button>
              <Button
                variant="outline"
                onClick={() => syncOrdersMutation.mutate()}
                disabled={syncOrdersMutation.isPending}
                data-testid="btn-sync-shopify-orders"
              >
                <ArrowLeftRight
                  className={`mr-2 h-4 w-4 ${
                    syncOrdersMutation.isPending ? "animate-spin" : ""
                  }`}
                />
                {syncOrdersMutation.isPending
                  ? "Syncing orders…"
                  : "Sync orders now"}
              </Button>
            </CardFooter>
          </Card>

          <SyncLogsCard />
        </div>
      )}
    </div>
  );
}

function SyncLogsCard() {
  const { data, isLoading } = useQuery<
    { logs: Array<{ id: number; direction: string; entity: string; action: string; status: string; shopifyId: string | null; erpId: number | null; errorMessage: string | null; createdAt: string }> }
  >({
    queryKey: ["shopify-sync-logs"],
    queryFn: async () => {
      const r = await fetch("/api/shopify/sync-logs");
      if (!r.ok) throw new Error("Failed to load sync logs");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const statusBadge = (s: string) => {
    if (s === "success") return <Badge variant="outline" className="text-green-600 border-green-300">success</Badge>;
    if (s === "error") return <Badge variant="destructive">error</Badge>;
    return <Badge variant="secondary">{s}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sync activity</CardTitle>
        <CardDescription>
          Last 500 Shopify sync events — refreshes every 30 s
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !data?.logs.length ? (
          <p className="text-sm text-muted-foreground py-4">No sync events yet.</p>
        ) : (
          <div className="overflow-auto max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Direction</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Shopify ID</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">{row.direction}</TableCell>
                    <TableCell className="text-xs">{row.entity}</TableCell>
                    <TableCell className="text-xs">{row.action}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell className="text-xs font-mono">{row.shopifyId ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTime(row.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {data?.logs.some((r) => r.status === "error") && (
          <div className="mt-3 space-y-1">
            {data.logs.filter((r) => r.status === "error").map((r) => (
              <p key={r.id} className="text-xs text-destructive">
                [{r.entity}/{r.action}] {r.errorMessage}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
