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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import { Label } from "@/components/ui/label";
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
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Unlink,
  KeyRound,
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
  useConnectShopifyCustom,
  useStartShopifyInstall,
  getGetShopifyConnectionQueryKey,
} from "@/lib/queryKeys";

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/i;

const customSchema = z.object({
  shopDomain: z
    .string()
    .min(1, "Store domain is required")
    .transform((v) =>
      v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
    )
    .refine((v) => SHOP_DOMAIN_RE.test(v), {
      message: "Must look like your-store.myshopify.com",
    }),
  accessToken: z
    .string()
    .min(1, "Access token is required")
    .refine((v) => /^shp(at|pa|ss|ca)_/.test(v.trim()), {
      message:
        "This doesn't look like a Shopify access token. It should start with shpat_, shppa_, or similar. Copy it from your custom app's \"API credentials\" tab.",
    }),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
});

type CustomValues = z.infer<typeof customSchema>;

function formatTime(value: string | null | undefined) {
  if (!value) return "Never";
  return format(new Date(value), "MMM d, h:mm a");
}

const STEPS = [
  "In your Shopify admin, go to Settings → Apps and sales channels",
  'Click "Develop apps" → "Create an app" → give it any name',
  'Go to "API credentials" tab → click "Configure Admin API scopes"',
  "Enable: read_products, write_products, read_inventory, write_inventory, read_orders, read_customers, read_locations",
  'Save, then click "Install app" → confirm',
  'Copy the "Admin API access token" (shown once) and paste it below',
];

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

  const [oauthDomain, setOauthDomain] = useState("");
  const [oauthDomainError, setOauthDomainError] = useState("");

  const customMutation = useConnectShopifyCustom({
    mutation: {
      onSuccess: () => {
        invalidateConnection();
        toast({ title: "Shopify connected via Custom App" });
      },
      onError: (err: unknown) => {
        toast({
          title: "Connection failed",
          description: err instanceof Error ? err.message : "Check your domain and token",
          variant: "destructive",
        });
      },
    },
  });

  const oauthMutation = useStartShopifyInstall({
    mutation: {
      onSuccess: (data) => {
        window.location.href = data.installUrl;
      },
      onError: (err: unknown) => {
        toast({
          title: "OAuth connect failed",
          description:
            err instanceof Error
              ? err.message
              : "Could not start Shopify login. Try the Custom App method instead.",
          variant: "destructive",
        });
      },
    },
  });

  function handleOauthConnect() {
    const raw = oauthDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!SHOP_DOMAIN_RE.test(raw)) {
      setOauthDomainError("Must look like your-store.myshopify.com");
      return;
    }
    setOauthDomainError("");
    oauthMutation.mutate({ data: { shopDomain: raw } });
  }

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

  const customForm = useForm<CustomValues>({
    resolver: zodResolver(customSchema),
    defaultValues: { shopDomain: "", accessToken: "", apiKey: "", apiSecret: "" },
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
                  Choose how you'd like to connect — Shopify Login (easier) or a Custom App token.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Tabs defaultValue="oauth">
              <TabsList className="w-full">
                <TabsTrigger value="oauth" className="flex-1">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Shopify Login
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex-1">
                  <KeyRound className="mr-2 h-4 w-4" />
                  Custom App Token
                </TabsTrigger>
              </TabsList>

              <TabsContent value="oauth" className="space-y-4 pt-2">
                <p className="text-sm text-muted-foreground">
                  Enter your store domain and click <strong>Connect with Shopify</strong>. You'll be
                  redirected to Shopify to authorize the connection — no token copying needed.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="oauth-domain">Shop domain</Label>
                  <Input
                    id="oauth-domain"
                    placeholder="your-store.myshopify.com"
                    autoComplete="off"
                    value={oauthDomain}
                    onChange={(e) => { setOauthDomain(e.target.value); setOauthDomainError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleOauthConnect()}
                    data-testid="input-shopify-oauth-domain"
                  />
                  {oauthDomainError && (
                    <p className="text-sm text-destructive">{oauthDomainError}</p>
                  )}
                </div>
                <Button
                  onClick={handleOauthConnect}
                  disabled={oauthMutation.isPending}
                  data-testid="btn-connect-shopify-oauth"
                >
                  {oauthMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Redirecting…
                    </>
                  ) : (
                    <>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Connect with Shopify
                    </>
                  )}
                </Button>
              </TabsContent>

              <TabsContent value="custom" className="space-y-5 pt-2">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    How to create your Shopify Custom App:
                  </p>
                  <ol className="space-y-2">
                    {STEPS.map((step, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#95bf47] text-white text-xs font-bold">
                          {i + 1}
                        </span>
                        <span className="text-muted-foreground">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <Form {...customForm}>
                  <form
                    onSubmit={customForm.handleSubmit((v) =>
                      customMutation.mutate({
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        data: { shopDomain: v.shopDomain, accessToken: v.accessToken, ...(v.apiKey && { apiKey: v.apiKey }), ...(v.apiSecret && { apiSecret: v.apiSecret }) } as any,
                      }),
                    )}
                    className="space-y-4"
                  >
                    <FormField
                      control={customForm.control}
                      name="shopDomain"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Shop domain</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="your-store.myshopify.com"
                              autoComplete="off"
                              {...field}
                              data-testid="input-shopify-custom-domain"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={customForm.control}
                      name="accessToken"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Admin API access token</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="shpat_xxxxxxxxxxxxxxxxxxxx"
                              autoComplete="off"
                              {...field}
                              data-testid="input-shopify-access-token"
                            />
                          </FormControl>
                          <FormDescription>
                            Paste the token from your custom app's "API credentials" tab
                            (starts with <code className="text-xs">shpat_</code> or <code className="text-xs">shppa_</code>).
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={customForm.control}
                      name="apiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            API Key{" "}
                            <span className="text-muted-foreground text-xs font-normal">
                              (optional)
                            </span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="API key from your custom app"
                              autoComplete="off"
                              {...field}
                              data-testid="input-shopify-api-key"
                            />
                          </FormControl>
                          <FormDescription>
                            Enables per-store webhook HMAC verification. Found in your custom app's "API credentials" tab.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={customForm.control}
                      name="apiSecret"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            API Secret Key{" "}
                            <span className="text-muted-foreground text-xs font-normal">
                              (optional)
                            </span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="API secret key"
                              autoComplete="off"
                              {...field}
                              data-testid="input-shopify-api-secret"
                            />
                          </FormControl>
                          <FormDescription>
                            Used to verify incoming Shopify webhook signatures for this store.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      disabled={customMutation.isPending}
                      data-testid="btn-connect-shopify-custom"
                    >
                      {customMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Connecting…
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Connect store
                        </>
                      )}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
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
                <RefreshCw
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



type SyncLog = {
  id: number;
  direction: string;
  entity: string;
  action: string;
  status: string;
  shopifyId: string | null;
  erpId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

function SyncLogsCard() {
  const { data, isFetching, refetch } = useQuery<{ logs: SyncLog[] }>({
    queryKey: ["shopify-sync-logs"],
    queryFn: () =>
      fetch("/api/shopify/sync-logs?limit=50", { credentials: "include" }).then(
        (r) => {
          if (!r.ok) throw new Error("Failed to load sync logs");
          return r.json() as Promise<{ logs: SyncLog[] }>;
        },
      ),
    refetchInterval: 30_000,
  });

  const logs = data?.logs ?? [];

  return (
    <Card data-testid="card-shopify-sync-logs">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ArrowLeftRight className="h-5 w-5 text-[#95bf47]" />
            <div>
              <CardTitle className="text-lg">Sync activity</CardTitle>
              <CardDescription>
                Recent inbound and outbound Shopify sync events.
              </CardDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No sync activity yet. Sync events will appear here after products,
            customers, or orders are exchanged with Shopify.
          </p>
        ) : (
          <div className="overflow-x-auto">
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
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge
                        variant={
                          log.direction === "inbound" ? "secondary" : "outline"
                        }
                      >
                        {log.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{log.entity}</TableCell>
                    <TableCell className="capitalize">{log.action}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          log.status === "success"
                            ? "default"
                            : log.status === "error"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.shopifyId ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.createdAt), "MMM d, h:mm a")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {logs.some((l) => l.errorMessage) && (
          <div className="mt-4 space-y-1">
            {logs
              .filter((l) => l.errorMessage)
              .map((l) => (
                <p
                  key={l.id}
                  className="text-xs text-destructive truncate"
                  title={l.errorMessage ?? ""}
                >
                  {l.entity} {l.action}: {l.errorMessage}
                </p>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
