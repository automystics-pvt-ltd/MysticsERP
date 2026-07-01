import { useState } from "react";
import {
  ShoppingBag, Package, PackageCheck, Archive, FileText,
  Layers, Grid3x3, MapPin, TrendingUp, RefreshCw, ArrowUpRight,
  Zap, CheckCircle2, Settings2, Bell, ChevronRight, Warehouse,
  Lock, AlertTriangle, ExternalLink, Clock, Activity,
  BarChart3, Download, RotateCcw, ArrowLeftRight, Eye,
} from "lucide-react";
function ShopifyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 109.5 124.5" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M74.7 14.8s-.3 0-.8.1c-.4-1.3-1.1-2.4-2-3.4-2.9-3.5-7.2-5.2-12-5H59c-.2 0-.3.1-.5.1-.3-.8-.7-1.6-1.2-2.3C55.5 1.7 52.8.3 49.7.2c-.1 0-.2 0-.3 0-1 0-1.9.1-2.8.4C46 .2 45.3 0 44.6 0c-5.3.1-10.3 4-13.7 10.8-2.4 4.8-3.6 10.4-3.4 15.8l11.4 3.5c.6-3.3 1.7-6.4 3.2-9.2 1.3-2.3 2.8-3.8 4.2-4.4l-8.5 55.5h10.8L50 58.7h.5l2.2 13.3h11.4l-8.5-55.5c1.1.4 2.1 1.2 3 2.3.9 1 1.5 2.2 1.9 3.5l-.1.1s5.2 1.6 10.4 3.2c-.1-.5-.1-1-.1-1.4-.1-5.2 2.3-7.6 5.3-9.6.3.1-.3.2-.3.2z"/>
      <path d="M96.5 22.6c-.1 0-2-.4-2-.4s-1.4-1.4-2-1.9c-.1-.1-.2-.1-.3-.1l-3.4 87.5-24 5.3 4.9 10.5s38.8-8.4 38.8-8.4L96.5 22.6zm-23.2-7.5L71 18.5c-2.2-.5-4.4-.7-6.6-.5l-2.2-5.8 11.1 2.9z"/>
    </svg>
  );
}

const BRAND = "#95bf47";
const BRAND_DIM = "#7aaa2e";

function Badge({ children, color = "green" }: { children: React.ReactNode; color?: "green" | "amber" | "blue" | "muted" }) {
  const cls = {
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    muted: "bg-slate-700/60 text-slate-400 border-slate-600/40",
  }[color];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function StatCard({ icon, label, value, sub, accent = false }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 hover:border-slate-600 transition-colors cursor-default
      ${accent ? "bg-gradient-to-br from-[#95bf47]/10 to-transparent border-[#95bf47]/30" : "bg-slate-800/60 border-slate-700/50"}`}>
      <div className="flex items-center justify-between">
        <span className={`p-1.5 rounded-lg ${accent ? "bg-[#95bf47]/20 text-[#95bf47]" : "bg-slate-700/80 text-slate-400"}`}>{icon}</span>
        {accent && <TrendingUp className="h-3.5 w-3.5 text-[#95bf47]/60" />}
      </div>
      <div>
        <p className="text-xl font-bold text-white tabular-nums">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
        {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full rounded-xl border border-slate-700/50 bg-slate-800/60 hover:bg-slate-700/60 hover:border-slate-600 px-4 py-3.5 transition-all text-left group"
    >
      <span className="p-2 rounded-lg bg-slate-700/80 text-slate-300 group-hover:bg-[#95bf47]/20 group-hover:text-[#95bf47] transition-colors">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-slate-400 truncate">{sub}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-slate-300 transition-colors flex-shrink-0" />
    </button>
  );
}

export function ConnectedDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "warehouses" | "settings">("overview");

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-slate-300 font-sans overflow-auto">
      {/* Top Nav */}
      <div className="border-b border-slate-700/50 bg-[#0d1120]/80 backdrop-blur sticky top-0 z-20 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-sm">Integrations</span>
          <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
          <span className="text-white font-medium text-sm flex items-center gap-2">
            <ShopifyIcon className="h-4 w-4 text-[#95bf47]" />
            Shopify
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-slate-500 cursor-pointer hover:text-slate-300" />
          <Settings2 className="h-4 w-4 text-slate-500 cursor-pointer hover:text-slate-300" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-[#95bf47]/15 border border-[#95bf47]/30 flex items-center justify-center">
              <ShopifyIcon className="h-7 w-7 text-[#95bf47]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-white">mm-wear.myshopify.com</h1>
                <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Last synced 12 minutes ago · Webhooks active · API v2024-10</p>
            </div>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#95bf47] hover:bg-[#7aaa2e] text-[#0B0F1A] font-semibold text-sm transition-colors shadow-lg shadow-[#95bf47]/20">
            <Zap className="h-3.5 w-3.5" />
            Sync Products
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-700/50">
          {(["overview", "warehouses", "settings"] as const).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px
                ${activeTab === t ? "text-white border-[#95bf47]" : "text-slate-400 border-transparent hover:text-slate-200"}`}>
              {t === "overview" ? "Store Overview" : t === "warehouses" ? "Warehouses" : "Advanced Settings"}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Store Stats Grid */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-[#95bf47]" />
                  Shopify Store Summary
                </h2>
                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Live data · 12 min ago
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                <StatCard accent icon={<Package className="h-4 w-4" />} label="Total Products" value="248" sub="+6 this week" />
                <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Active" value="215" />
                <StatCard icon={<FileText className="h-4 w-4" />} label="Draft" value="18" />
                <StatCard icon={<Archive className="h-4 w-4" />} label="Archived" value="15" />
                <StatCard icon={<Layers className="h-4 w-4" />} label="Variant Products" value="89" sub="394 variants total" />
                <StatCard icon={<PackageCheck className="h-4 w-4" />} label="Simple Products" value="159" />
                <StatCard icon={<Grid3x3 className="h-4 w-4" />} label="Collections" value="12" />
                <StatCard icon={<MapPin className="h-4 w-4" />} label="Locations" value="3" />
                <StatCard accent icon={<TrendingUp className="h-4 w-4" />} label="Inventory Value" value="₹12.4L" sub="Across all locations" />
                <StatCard icon={<Activity className="h-4 w-4" />} label="ERP Mapped" value="211 / 248" sub="37 not yet synced" />
              </div>
            </div>

            {/* Action Buttons */}
            <div>
              <h2 className="text-sm font-semibold text-white mb-3">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <ActionBtn icon={<RefreshCw className="h-4 w-4" />} label="Sync Products" sub="Import all Shopify products to ERP" />
                <ActionBtn icon={<ArrowUpRight className="h-4 w-4" />} label="Push to Shopify" sub="Multiple push strategies" />
                <ActionBtn icon={<ArrowLeftRight className="h-4 w-4" />} label="Sync Orders" sub="Pull pending Shopify orders" />
                <ActionBtn icon={<Eye className="h-4 w-4" />} label="Dry Run Preview" sub="Preview changes before syncing" />
                <ActionBtn icon={<RotateCcw className="h-4 w-4" />} label="Advanced Re-Sync" sub="By category, brand, status…" />
                <ActionBtn icon={<Download className="h-4 w-4" />} label="Export Reports" sub="CSV · Excel · PDF" />
              </div>
            </div>

            {/* Recent Sync Status */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/40">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#95bf47]" />
                  Last Sync Summary
                </span>
                <Badge color="green"><CheckCircle2 className="h-3 w-3" /> Completed with warnings</Badge>
              </div>
              <div className="grid grid-cols-4 divide-x divide-slate-700/50 sm:grid-cols-8">
                {[
                  { label: "Total Shopify", value: "248", cls: "text-white" },
                  { label: "Total ERP", value: "211", cls: "text-white" },
                  { label: "Created", value: "14", cls: "text-emerald-400" },
                  { label: "Updated", value: "197", cls: "text-blue-400" },
                  { label: "Skipped", value: "22", cls: "text-slate-400" },
                  { label: "Failed", value: "3", cls: "text-red-400" },
                  { label: "Missing", value: "12", cls: "text-amber-400" },
                  { label: "Duration", value: "1m 24s", cls: "text-slate-300" },
                ].map((s) => (
                  <div key={s.label} className="px-3 py-2.5 text-center">
                    <p className={`text-base font-bold tabular-nums ${s.cls}`}>{s.value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "warehouses" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
              <Lock className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-300">System-managed warehouses</p>
                <p className="text-xs text-amber-400/70 mt-0.5">These 3 warehouses are fixed and cannot be added, edited, or deleted. All product mappings and inventory movements are validated against them.</p>
              </div>
            </div>
            {[
              { name: "Main Warehouse", code: "WH-MAIN", loc: "Mumbai, MH", linked: "shopify-main-loc", products: 215, value: "₹8.2L", color: "blue" as const },
              { name: "Shopify Warehouse", code: "WH-SHOPIFY", loc: "Virtual (Shopify-managed)", linked: "shopify-online-store", products: 248, value: "₹12.4L", color: "green" as const },
              { name: "Store Warehouse", code: "WH-STORE", loc: "Bandra West, Mumbai", linked: "shopify-store-loc", products: 189, value: "₹6.1L", color: "amber" as const },
            ].map((wh) => (
              <div key={wh.code} className="rounded-xl border border-slate-700/50 bg-slate-800/60 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/40">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${wh.color === "blue" ? "bg-blue-500/15 text-blue-400" : wh.color === "green" ? "bg-[#95bf47]/15 text-[#95bf47]" : "bg-amber-500/15 text-amber-400"}`}>
                      <Warehouse className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white text-sm">{wh.name}</p>
                        <Lock className="h-3 w-3 text-slate-500" />
                      </div>
                      <p className="text-xs text-slate-400">{wh.code} · {wh.loc}</p>
                    </div>
                  </div>
                  <Badge color={wh.color}>Linked to Shopify</Badge>
                </div>
                <div className="grid grid-cols-3 divide-x divide-slate-700/40 px-0">
                  <div className="px-5 py-3"><p className="text-xs text-slate-500">Products</p><p className="text-sm font-semibold text-white">{wh.products}</p></div>
                  <div className="px-5 py-3"><p className="text-xs text-slate-500">Inventory Value</p><p className="text-sm font-semibold text-white">{wh.value}</p></div>
                  <div className="px-5 py-3"><p className="text-xs text-slate-500">Shopify Location</p><p className="text-sm font-mono text-slate-300 truncate">{wh.linked}</p></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-4">
            {[
              { label: "API Credentials", items: ["Shop Domain: mm-wear.myshopify.com", "API Version: 2024-10", "Access Token: ••••••••••••xxK9"] },
              { label: "Webhook Health", items: ["products/update — Active · Last: 12 min ago", "orders/create — Active · Last: 4 min ago", "inventory_levels/update — Active · Last: 3 min ago", "app/uninstalled — Active · Last: never"] },
              { label: "Granted Scopes", items: ["read_products, write_products", "read_inventory, write_inventory", "read_orders, write_orders", "read_locations"] },
            ].map((section) => (
              <div key={section.label} className="rounded-xl border border-slate-700/50 bg-slate-800/60 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-700/40 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{section.label}</p>
                  <ExternalLink className="h-3.5 w-3.5 text-slate-500 cursor-pointer hover:text-slate-300" />
                </div>
                <div className="px-5 py-3 space-y-1.5">
                  {section.items.map((item) => (
                    <p key={item} className="text-xs text-slate-400 font-mono">{item}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
