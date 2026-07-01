import { useState } from "react";
import {
  Zap, Pause, Play, XCircle, Download, RotateCcw, SkipForward,
  AlertCircle, CheckCircle2, Clock, TrendingUp, Package, PackageCheck,
  PackageX, Plus, ArrowUpDown, ShoppingBag, ChevronRight, Search,
  Filter, FileSpreadsheet, FileText, Eye, RefreshCw, Activity,
  AlertTriangle, CheckCheck, Layers, X,
} from "lucide-react";

function ProgressRing({ pct }: { pct: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#1e293b" strokeWidth="6" />
      <circle cx="36" cy="36" r={r} fill="none" stroke="#95bf47" strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.5s ease" }} />
    </svg>
  );
}

function MetricTile({ label, value, icon, cls, tooltip }: { label: string; value: string | number; icon: React.ReactNode; cls?: string; tooltip?: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-3 cursor-default hover:bg-slate-700/60 hover:border-slate-600 transition-colors group" title={tooltip}>
      <div className="flex items-center gap-1.5 mb-2">{icon}<span className="text-[10px] text-slate-400">{label}</span></div>
      <p className={`text-lg font-bold tabular-nums ${cls ?? "text-white"}`}>{value}</p>
    </div>
  );
}

const LOGS = [
  { status: "success", name: "Classic White Tee — M", sku: "WT-M-01", action: "updated", shopifyId: "gid://shopify/ProductVariant/44891" },
  { status: "success", name: "Slim Fit Jeans — 32", sku: "SFJ-32", action: "created", shopifyId: "gid://shopify/ProductVariant/44892" },
  { status: "error", name: "Floral Kurta Set — L", sku: "FKS-L", action: "create", shopifyId: "gid://shopify/ProductVariant/44893", reason: "Duplicate SKU" },
  { status: "success", name: "Linen Blazer — XL", sku: "LB-XL", action: "updated", shopifyId: "gid://shopify/ProductVariant/44894" },
  { status: "skipped", name: "Summer Dress — S (parent)", sku: null, action: "skip", shopifyId: "gid://shopify/Product/8821", reason: "Parent placeholder" },
  { status: "success", name: "Printed Saree — Navy", sku: "PS-NAV", action: "created", shopifyId: "gid://shopify/ProductVariant/44896" },
];

const DRILL_DATA = [
  { name: "Floral Kurta Set — L", sku: "FKS-L", barcode: "8901234567890", shopifyId: "44893", erpId: "ITM-1042", prev: "—", next: "₹1,299", status: "failed", reason: "Duplicate SKU in ERP" },
  { name: "Printed Saree — M", sku: "PS-M", barcode: "8901234567891", shopifyId: "44901", erpId: "ITM-1043", prev: "₹2,999", next: "₹3,199", status: "mismatch", reason: "Price mismatch" },
  { name: "Ethnic Wear Bundle", sku: "EWB-01", barcode: null, shopifyId: "44912", erpId: "ITM-1048", prev: "Active", next: "—", status: "failed", reason: "Bundle items not allowed" },
];

export function SyncReports() {
  const [showConfirm, setShowConfirm] = useState(true);
  const [syncState, setSyncState] = useState<"idle" | "running" | "paused" | "done">("idle");
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillType, setDrillType] = useState("Failed");
  const [activeTab, setActiveTab] = useState<"progress" | "history" | "push">("progress");

  const processed = syncState === "running" || syncState === "paused" || syncState === "done" ? (syncState === "done" ? 248 : 163) : 0;
  const total = 248;
  const pct = Math.round((processed / total) * 100);

  const startSync = () => { setShowConfirm(false); setSyncState("running"); };

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-slate-300 font-sans overflow-auto relative">
      {/* Pre-Sync Confirmation Overlay */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#0d1120] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-[#95bf47]/15 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-[#95bf47]" />
                </div>
                <p className="font-semibold text-white">Sync Products</p>
              </div>
              <button onClick={() => setShowConfirm(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-300/80">
                  <strong className="text-amber-300">Backup before Sync?</strong> This operation may update products, prices, inventory, and variants across <strong>248 Shopify products</strong>. Do you want to continue?
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">This sync will:</p>
                {["Import all product variants from Shopify", "Update prices, SKUs, barcodes, images", "Detect missing ERP items", "Record full audit trail"].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#95bf47] flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-slate-800/60 border border-slate-700/50 px-3 py-2 text-xs text-slate-400 space-y-1">
                <p><span className="text-slate-500">Triggered by:</span> admin@mmwear.com (Owner)</p>
                <p><span className="text-slate-500">Device:</span> Chrome 124 · MacOS · Mumbai, IN</p>
                <p><span className="text-slate-500">Time:</span> 01 Jul 2026, 04:12 AM IST</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-700">
              <button onClick={() => setShowConfirm(false)} className="flex-1 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-700/50 transition-colors">
                Cancel
              </button>
              <button onClick={startSync} className="flex-1 py-2 rounded-xl bg-[#95bf47] hover:bg-[#7aaa2e] text-[#0B0F1A] text-sm font-bold transition-colors shadow-lg shadow-[#95bf47]/20">
                Start Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drill-down Sheet */}
      {drillOpen && (
        <div className="fixed inset-y-0 right-0 w-[600px] bg-[#0d1120] border-l border-slate-700 z-40 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div>
              <p className="font-semibold text-white">{drillType} Items — Drill-down</p>
              <p className="text-xs text-slate-400">{DRILL_DATA.length} products · Click row for details</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white border border-slate-600 rounded-lg px-3 py-1.5 transition-colors">
                <Download className="h-3.5 w-3.5" /> Export
              </button>
              <button onClick={() => setDrillOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors ml-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800/80 sticky top-0">
                <tr>
                  {["Product / SKU", "Barcode", "Shopify ID", "ERP ID", "Prev → New", "Status", "Reason"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {DRILL_DATA.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-800/60 transition-colors">
                    <td className="px-3 py-3">
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="font-mono text-slate-400">{row.sku}</p>
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-400">{row.barcode ?? "—"}</td>
                    <td className="px-3 py-3 font-mono text-slate-400">{row.shopifyId}</td>
                    <td className="px-3 py-3 font-mono text-slate-400">{row.erpId}</td>
                    <td className="px-3 py-3 text-slate-300">{row.prev}<span className="text-slate-600 mx-1">→</span>{row.next}</td>
                    <td className="px-3 py-3">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold
                        ${row.status === "failed" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-400">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nav */}
      <div className="border-b border-slate-700/50 bg-[#0d1120]/80 backdrop-blur sticky top-0 z-10 px-6 py-3 flex items-center gap-1">
        {(["progress", "history", "push"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg capitalize transition-colors
              ${activeTab === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}>
            {t === "progress" ? "⚡ Live Sync" : t === "history" ? "📋 Sync History" : "🚀 Push to Shopify"}
          </button>
        ))}
        <div className="ml-auto">
          <button onClick={() => setShowConfirm(true)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-[#95bf47] hover:bg-[#7aaa2e] text-[#0B0F1A] font-semibold text-xs transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Sync Now
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">

        {activeTab === "progress" && (
          <>
            {/* Sync Progress Card */}
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5
                    ${syncState === "running" ? "bg-blue-500/15 text-blue-400 border border-blue-500/20" :
                      syncState === "paused" ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" :
                      syncState === "done" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" :
                      "bg-slate-700/60 text-slate-400 border border-slate-600/40"}`}>
                    {syncState === "running" && <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />}
                    {syncState === "running" ? "Running" : syncState === "paused" ? "Paused" : syncState === "done" ? "Completed" : "Idle"}
                  </span>
                  <span className="text-sm text-slate-400">
                    {syncState !== "idle" ? `${processed.toLocaleString()} / ${total.toLocaleString()} products · ${pct}%` : "No sync running"}
                  </span>
                </div>
                {syncState !== "idle" && (
                  <div className="flex items-center gap-2">
                    {syncState === "running" && (
                      <button onClick={() => setSyncState("paused")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-700/50 transition-colors">
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </button>
                    )}
                    {syncState === "paused" && (
                      <button onClick={() => setSyncState("running")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#95bf47]/40 text-[#95bf47] text-xs hover:bg-[#95bf47]/10 transition-colors">
                        <Play className="h-3.5 w-3.5" /> Resume
                      </button>
                    )}
                    <button onClick={() => setSyncState("idle")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs hover:bg-red-500/10 transition-colors">
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </div>
                )}
              </div>

              {syncState !== "idle" ? (
                <div className="px-5 py-4 space-y-4">
                  {/* Progress bar */}
                  <div className="flex items-center gap-5">
                    <div className="relative flex-shrink-0">
                      <ProgressRing pct={pct} />
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">{pct}%</span>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="h-3 rounded-full bg-slate-700 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500
                          ${syncState === "paused" ? "bg-amber-400" : "bg-gradient-to-r from-[#95bf47] to-[#7aaa2e]"}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center gap-5 text-xs text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1"><Package className="h-3 w-3" />{total - processed} remaining</span>
                        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />2.4/s</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />ETA ~36s</span>
                        {syncState === "paused" && <span className="text-amber-400 font-medium">⚠ Paused</span>}
                      </div>
                    </div>
                  </div>

                  {/* Live activity log */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-[#95bf47]" /> Live Activity
                      <span className="h-1.5 w-1.5 rounded-full bg-[#95bf47] animate-pulse" />
                    </p>
                    <div className="rounded-lg bg-[#07090f] border border-slate-700/50 divide-y divide-slate-700/30 max-h-40 overflow-hidden">
                      {LOGS.map((log, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0
                            ${log.status === "success" ? "bg-emerald-400" : log.status === "error" ? "bg-red-400" : "bg-slate-500"}`} />
                          <span className="flex-1 font-medium text-slate-200 truncate">{log.name}</span>
                          {log.sku && <span className="font-mono text-slate-500 text-[10px] hidden sm:block">{log.sku}</span>}
                          <span className="capitalize text-slate-400 whitespace-nowrap">{log.action}</span>
                          {log.reason && (
                            <span className="bg-red-500/10 text-red-400 border border-red-500/20 rounded px-1 text-[10px]">{log.reason}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-5 py-8 text-center">
                  <Package className="h-10 w-10 mx-auto text-slate-600 mb-3" />
                  <p className="text-sm text-slate-400">Click <strong className="text-slate-300">Sync Now</strong> to start a product sync</p>
                </div>
              )}
            </div>

            {/* Metric tiles */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
              {[
                { label: "Total Shopify", value: total, icon: <ShoppingBag className="h-3.5 w-3.5 text-[#95bf47]" /> },
                { label: "Total ERP", value: 211, icon: <Package className="h-3.5 w-3.5 text-blue-400" /> },
                { label: "Created", value: 14, icon: <Plus className="h-3.5 w-3.5 text-emerald-400" />, cls: "text-emerald-400" },
                { label: "Updated", value: 197, icon: <ArrowUpDown className="h-3.5 w-3.5 text-blue-400" />, cls: "text-blue-400" },
                { label: "Synced", value: 211, icon: <PackageCheck className="h-3.5 w-3.5 text-emerald-500" />, cls: "text-emerald-500" },
                { label: "Skipped", value: 22, icon: <SkipForward className="h-3.5 w-3.5 text-slate-400" /> },
                { label: "Failed", value: 3, icon: <PackageX className="h-3.5 w-3.5 text-red-400" />, cls: "text-red-400" },
                { label: "Missing", value: 12, icon: <AlertCircle className="h-3.5 w-3.5 text-amber-400" />, cls: "text-amber-400" },
                { label: "Pending", value: total - processed, icon: <Clock className="h-3.5 w-3.5 text-slate-400" /> },
              ].map((m) => (
                <button key={m.label} onClick={() => { setDrillType(m.label); setDrillOpen(true); }}
                  className="rounded-xl border border-slate-700/50 bg-slate-800/60 p-3 text-left hover:bg-slate-700/60 hover:border-slate-600 transition-colors group cursor-pointer">
                  <div className="flex items-center gap-1.5 mb-1.5">{m.icon}<span className="text-[10px] text-slate-400">{m.label}</span></div>
                  <p className={`text-lg font-bold tabular-nums ${m.cls ?? "text-white"}`}>{m.value}</p>
                  <p className="text-[9px] text-slate-600 mt-0.5 group-hover:text-slate-500">Click to drill down →</p>
                </button>
              ))}
            </div>

            {/* Retry actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
                <RotateCcw className="h-3.5 w-3.5" /> Retry Failed (3)
              </button>
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
                <SkipForward className="h-3.5 w-3.5" /> Retry Skipped (22)
              </button>
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
                <Layers className="h-3.5 w-3.5" /> Retry Selected
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-600 text-slate-400 text-xs hover:bg-slate-700/50 transition-colors">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                </button>
                <button className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-600 text-slate-400 text-xs hover:bg-slate-700/50 transition-colors">
                  <FileText className="h-3.5 w-3.5" /> CSV
                </button>
                <button className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-600 text-slate-400 text-xs hover:bg-slate-700/50 transition-colors">
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === "history" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-slate-500" placeholder="Search by product, SKU, Shopify ID…" />
              </div>
              <button className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm hover:bg-slate-700/50 transition-colors">
                <Filter className="h-3.5 w-3.5" /> Filters
              </button>
              <button className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
                <Download className="h-3.5 w-3.5" /> Export
              </button>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-800/80">
                  <tr>{["Product / SKU", "Action", "Status", "Reason", "Shopify ID", "Triggered By", "Time"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-700/40">
                  {[...LOGS, ...LOGS.slice(0, 3)].map((row, i) => (
                    <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3"><p className="font-medium text-slate-200">{row.name}</p>{row.sku && <p className="font-mono text-slate-500 text-[10px]">{row.sku}</p>}</td>
                      <td className="px-4 py-3 capitalize text-slate-300">{row.action}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold
                          ${row.status === "success" ? "bg-emerald-500/15 text-emerald-400" : row.status === "error" ? "bg-red-500/15 text-red-400" : "bg-slate-700 text-slate-400"}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{row.reason ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-slate-500 text-[10px] truncate max-w-[100px]">{row.shopifyId?.slice(-8)}</td>
                      <td className="px-4 py-3 text-slate-400">admin@mmwear.com</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">Jul 1 · 4:12 AM</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "push" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Push All Products", icon: <ShoppingBag />, count: "248 products", cls: "border-[#95bf47]/30 hover:bg-[#95bf47]/5" },
                { label: "Push Selected", icon: <CheckCheck />, count: "Select items first" },
                { label: "Push by Category", icon: <Layers />, count: "12 categories" },
                { label: "Push Price Only", icon: <TrendingUp />, count: "Prices & compare-at" },
                { label: "Push Stock Only", icon: <Package />, count: "Inventory levels" },
                { label: "Push Missing", icon: <AlertCircle />, count: "37 unmapped" },
                { label: "Push Updated Only", icon: <RefreshCw />, count: "Since last sync" },
                { label: "Push Images Only", icon: <Eye />, count: "Image URLs" },
                { label: "Dry Run Preview", icon: <Eye />, count: "Preview changes first", cls: "border-amber-500/20 hover:bg-amber-500/5" },
              ].map((action) => (
                <button key={action.label} className={`rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 text-left hover:border-slate-600 transition-colors ${action.cls ?? ""}`}>
                  <div className="flex items-center gap-2 mb-2 text-slate-400">{action.icon && <span className="h-4 w-4">{action.icon}</span>}</div>
                  <p className="text-sm font-semibold text-white">{action.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{action.count}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
