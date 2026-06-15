import { useState } from "react";
import {
  LayoutDashboard, ShoppingCart, Package, CreditCard, Users,
  Bell, HelpCircle, Settings, ChevronDown, TrendingUp, TrendingDown,
  MoreHorizontal, ArrowUpRight, Warehouse, RefreshCw, CalendarDays,
  ChevronLeft, Search
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: ShoppingCart, label: "Orders" },
  { icon: Package, label: "Inventory" },
  { icon: CreditCard, label: "Payments" },
  { icon: Users, label: "Customers" },
];

const KPI = [
  { label: "Total Revenue", value: "₹24.8L", sub: "This Month", delta: "+12.4%", up: true, color: "from-violet-600/20 to-violet-600/5", border: "border-violet-500/20" },
  { label: "Sales Orders", value: "248", sub: "Active", delta: "+8.2%", up: true, color: "from-emerald-600/20 to-emerald-600/5", border: "border-emerald-500/20" },
  { label: "Outstanding", value: "₹6.2L", sub: "Receivables", delta: "₹1.4L overdue", up: false, color: "from-red-600/20 to-red-600/5", border: "border-red-500/20" },
  { label: "Purchase Orders", value: "34", sub: "Pending receipt", delta: "+3 this week", up: true, color: "from-blue-600/20 to-blue-600/5", border: "border-blue-500/20" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BARS = [62, 85, 48, 91, 74, 55, 88];

const TOP_ITEMS = [
  { name: "HDPE Granules 100kg", sku: "RAW-001", qty: 142, rev: "₹3.2L" },
  { name: "PP Sheet 2mm", sku: "FIN-023", qty: 98, rev: "₹1.8L" },
  { name: "Industrial Bolts M12", sku: "HW-044", qty: 76, rev: "₹94K" },
  { name: "LDPE Film Roll", sku: "RAW-012", qty: 64, rev: "₹72K" },
];

const RECENT = [
  { id: "SO-250614-0041", customer: "Ramesh Industries", status: "Shipped", amt: "₹82,400", icon: "RI", color: "bg-emerald-600" },
  { id: "SO-250614-0040", customer: "Gupta Traders", status: "Invoiced", amt: "₹1,24,000", icon: "GT", color: "bg-blue-600" },
  { id: "SO-250613-0039", customer: "National Polymers", status: "Confirmed", amt: "₹56,200", icon: "NP", color: "bg-purple-600" },
  { id: "PO-250614-0018", customer: "Reliance Petro", status: "Ordered", amt: "₹3,48,000", icon: "RP", color: "bg-orange-500" },
  { id: "GRN-250613-0009", customer: "Basant Chemicals", status: "Received", amt: "₹1,12,800", icon: "BC", color: "bg-teal-600" },
];

const STATUS_COLOR: Record<string, string> = {
  Shipped: "text-emerald-400 bg-emerald-400/10",
  Invoiced: "text-blue-400 bg-blue-400/10",
  Confirmed: "text-violet-400 bg-violet-400/10",
  Ordered: "text-amber-400 bg-amber-400/10",
  Received: "text-teal-400 bg-teal-400/10",
};

const PRESETS = ["This Week", "This Month", "Last Month", "Last Quarter"];

export function Dashboard() {
  const [preset, setPreset] = useState("This Month");
  const [warehouse, setWarehouse] = useState("All Warehouses");

  return (
    <div className="flex h-screen bg-[#111111] text-white overflow-hidden font-sans select-none">

      {/* Sidebar */}
      <aside className="flex flex-col h-full bg-[#0c0c0c] border-r border-white/5" style={{ width: 220, minWidth: 220 }}>
        <div className="flex items-center gap-2 px-4 h-14 border-b border-white/5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <span className="text-[10px] font-bold">M</span>
          </div>
          <span className="font-semibold text-sm tracking-wide">Mystics</span>
          <ChevronLeft className="w-4 h-4 text-white/20 ml-auto" />
        </div>

        <div className="px-3 pt-3 pb-1">
          <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
            <Search className="w-3.5 h-3.5 text-white/30" />
            <span className="text-xs text-white/30">Search</span>
            <span className="ml-auto text-[10px] text-white/20 bg-white/5 rounded px-1.5 py-0.5">⌘F</span>
          </div>
        </div>

        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ icon: Icon, label, active }) => (
            <div key={label} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${active ? "bg-white text-black font-medium" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{label}</span>
            </div>
          ))}
        </nav>

        <div className="px-2 pb-2 space-y-0.5 border-t border-white/5 pt-2">
          {[{ icon: Bell, label: "Notifications", badge: "7" }, { icon: HelpCircle, label: "Help & support" }, { icon: Settings, label: "Settings" }].map(({ icon: Icon, label, badge }) => (
            <div key={label} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-white/40 hover:text-white hover:bg-white/5 transition-all">
              <div className="relative"><Icon className="w-4 h-4" />{badge && <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">{badge}</span>}</div>
              <span className="text-sm">{label}</span>
            </div>
          ))}
        </div>

        <div className="px-3 pb-4">
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center text-[10px] font-semibold">OW</div>
            <span className="text-xs text-white/60">Olivia Williams</span>
            <MoreHorizontal className="w-3.5 h-3.5 text-white/30 ml-auto" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#141414]">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 flex-shrink-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-xs text-white/30 mt-0.5">Welcome back, Olivia — here's what's happening today</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Warehouse picker */}
            <button className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/8 transition-all">
              <Warehouse className="w-3.5 h-3.5" />
              {warehouse}
              <ChevronDown className="w-3 h-3 ml-0.5" />
            </button>
            {/* Date range picker */}
            <div className="flex items-center bg-white/5 border border-white/10 rounded-lg overflow-hidden">
              {PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`px-3 py-2 text-xs transition-all ${preset === p ? "bg-violet-600 text-white" : "text-white/40 hover:text-white/70"}`}
                >
                  {p}
                </button>
              ))}
              <button className="flex items-center gap-1.5 px-3 py-2 text-xs text-white/40 hover:text-white/70 border-l border-white/10 transition-all">
                <CalendarDays className="w-3.5 h-3.5" /> Custom
              </button>
            </div>
            <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/8 transition-all">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-8">
          {/* KPI row */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {KPI.map(k => (
              <div key={k.label} className={`rounded-xl border ${k.border} bg-gradient-to-b ${k.color} p-4 relative overflow-hidden`}>
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs text-white/40">{k.label}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-white/20" />
                </div>
                <div className="text-2xl font-bold tracking-tight mb-1">{k.value}</div>
                <div className="text-xs text-white/40">{k.sub}</div>
                <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${k.up ? "text-emerald-400" : "text-red-400"}`}>
                  {k.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {k.delta}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Revenue bar chart */}
            <div className="col-span-2 bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-semibold">Revenue — {preset}</h3>
                  <p className="text-xs text-white/30 mt-0.5">Daily breakdown</p>
                </div>
                <button className="flex items-center gap-1.5 text-xs text-white/30 bg-white/5 rounded-lg px-2.5 py-1.5">
                  <ChevronDown className="w-3 h-3" /> Week
                </button>
              </div>
              {/* Bar chart */}
              <div className="flex items-end gap-3 h-40">
                {BARS.map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                    <div
                      style={{ height: `${h}%` }}
                      className={`w-full rounded-t-md transition-all ${i === 3 ? "bg-violet-500" : "bg-white/10 hover:bg-white/20"}`}
                    />
                    <span className="text-[10px] text-white/30">{DAYS[i]}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                <div className="text-center">
                  <div className="text-lg font-bold">₹24.8L</div>
                  <div className="text-[10px] text-white/30">Total Revenue</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-emerald-400">+12.4%</div>
                  <div className="text-[10px] text-white/30">vs last month</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">₹9,980</div>
                  <div className="text-[10px] text-white/30">Avg. order</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">248</div>
                  <div className="text-[10px] text-white/30">Orders</div>
                </div>
              </div>
            </div>

            {/* Order status donut */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-1">Order Status</h3>
              <p className="text-xs text-white/30 mb-4">Active orders breakdown</p>
              <div className="relative w-36 h-36 mx-auto mb-5">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="38" fill="none" stroke="white" strokeOpacity="0.05" strokeWidth="12" />
                  <circle cx="50" cy="50" r="38" fill="none" stroke="#10b981" strokeWidth="12"
                    strokeDasharray={`${89 * 2.39} ${238.76}`} strokeLinecap="round" />
                  <circle cx="50" cy="50" r="38" fill="none" stroke="#f59e0b" strokeWidth="12"
                    strokeDasharray={`${8 * 2.39} ${238.76}`} strokeDashoffset={`${-(89 * 2.39)}`} strokeLinecap="round" />
                  <circle cx="50" cy="50" r="38" fill="none" stroke="#ef4444" strokeWidth="12"
                    strokeDasharray={`${3 * 2.39} ${238.76}`} strokeDashoffset={`${-((89 + 8) * 2.39)}`} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold">248</span>
                  <span className="text-[10px] text-white/30">orders</span>
                </div>
              </div>
              {[
                { color: "bg-emerald-500", label: "Shipped / Paid", pct: "89%", n: 221 },
                { color: "bg-amber-500", label: "Pending", pct: "8%", n: 20 },
                { color: "bg-red-500", label: "Cancelled", pct: "3%", n: 7 },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
                    <span className="text-xs text-white/60">{s.label}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-medium text-white/80">{s.pct}</span>
                    <span className="text-[10px] text-white/30 ml-1.5">{s.n}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-6 mt-6">
            {/* Recent activity */}
            <div className="col-span-3 bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Recent Activity</h3>
                <button className="text-xs text-violet-400 hover:text-violet-300 transition-colors">View all →</button>
              </div>
              <table className="w-full">
                <thead>
                  <tr>
                    {["Reference", "Party", "Status", "Amount"].map(h => (
                      <th key={h} className="pb-2.5 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RECENT.map(r => (
                    <tr key={r.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer transition-colors">
                      <td className="py-3 pr-4 text-xs font-mono text-white/60">{r.id}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full ${r.color} flex items-center justify-center text-[9px] font-bold`}>{r.icon}</div>
                          <span className="text-xs text-white/70">{r.customer}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                      </td>
                      <td className="py-3 text-xs font-medium text-white/80">{r.amt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Top items */}
            <div className="col-span-2 bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Top Items</h3>
                <span className="text-xs text-white/30">{preset}</span>
              </div>
              <div className="space-y-3">
                {TOP_ITEMS.map((item, i) => (
                  <div key={item.sku} className="flex items-center gap-3">
                    <span className="text-xs text-white/20 w-4 text-right flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white/70 truncate">{item.name}</div>
                      <div className="text-[10px] text-white/30">{item.sku} · {item.qty} units</div>
                    </div>
                    <div className="text-xs font-semibold text-white/80 flex-shrink-0">{item.rev}</div>
                  </div>
                ))}
              </div>

              {/* Stock alerts */}
              <div className="mt-5 pt-4 border-t border-white/5">
                <h4 className="text-xs font-medium text-white/40 mb-3 uppercase tracking-wider">Low Stock Alerts</h4>
                {[
                  { name: "HDPE Granules 100kg", left: 8, min: 20 },
                  { name: "PP Sheet 2mm", left: 3, min: 10 },
                ].map(a => (
                  <div key={a.name} className="flex items-center justify-between py-2">
                    <span className="text-xs text-white/60 truncate flex-1">{a.name}</span>
                    <span className="text-xs text-red-400 font-medium ml-2">{a.left} left</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
