import { useState } from "react";
import {
  BarChart3, Bell, ChevronDown, Home, LayoutDashboard, Package,
  ShoppingCart, Users, Truck, RefreshCw, Plus, Search, Settings,
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, AlertTriangle,
  CheckCircle2, Clock, Zap, Star, Activity, Globe, FileText,
  ChevronRight, MoreHorizontal, Boxes, ClipboardList, Wallet,
  Moon, LogOut, Filter, Download,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";

/* ── Palette ─────────────────────────────── */
const P = {
  violet: "#7c3aed",
  violetLight: "#a78bfa",
  violetBg: "#ede9fe",
  teal: "#0d9488",
  tealBg: "#ccfbf1",
  amber: "#d97706",
  amberBg: "#fef3c7",
  red: "#dc2626",
  redBg: "#fee2e2",
  blue: "#2563eb",
  blueBg: "#dbeafe",
  slate50: "#f8fafc",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate300: "#cbd5e1",
  slate400: "#94a3b8",
  slate500: "#64748b",
  slate600: "#475569",
  slate700: "#334155",
  slate900: "#0f172a",
  white: "#ffffff",
};

/* ── Data ────────────────────────────────── */
const revenueData = [
  { month: "Jan", sales: 38, purchases: 22 },
  { month: "Feb", sales: 52, purchases: 31 },
  { month: "Mar", sales: 45, purchases: 28 },
  { month: "Apr", sales: 61, purchases: 35 },
  { month: "May", sales: 55, purchases: 40 },
  { month: "Jun", sales: 72, purchases: 45 },
  { month: "Jul", sales: 68, purchases: 38 },
];

const stockData = [
  { label: "Mon", val: 80 },
  { label: "Tue", val: 65 },
  { label: "Wed", val: 90 },
  { label: "Thu", val: 55 },
  { label: "Fri", val: 78 },
  { label: "Sat", val: 92 },
  { label: "Sun", val: 70 },
];

const orderData = [
  { label: "Mon", val: 12 },
  { label: "Tue", val: 19 },
  { label: "Wed", val: 8 },
  { label: "Thu", val: 24 },
  { label: "Fri", val: 16 },
  { label: "Sat", val: 9 },
  { label: "Sun", val: 21 },
];

const poData = [
  { label: "Mon", val: 4 },
  { label: "Tue", val: 7 },
  { label: "Wed", val: 3 },
  { label: "Thu", val: 9 },
  { label: "Fri", val: 5 },
  { label: "Sat", val: 2 },
  { label: "Sun", val: 6 },
];

const activities = [
  { id: 1, type: "sale", text: "Sales order #SO-260614-0142 created", sub: "Kumar Textiles · ₹1,24,500", time: "2m ago", color: P.violet, bg: P.violetBg, icon: ShoppingCart },
  { id: 2, type: "purchase", text: "Goods received for PO-260614-0039", sub: "Ratan Fabrics · 240 units", time: "18m ago", color: P.teal, bg: P.tealBg, icon: Package },
  { id: 3, type: "alert", text: "Low stock alert — Cotton Blend 60s", sub: "12 units remaining · Reorder point: 50", time: "45m ago", color: P.amber, bg: P.amberBg, icon: AlertTriangle },
  { id: 4, type: "transfer", text: "Stock transfer completed — TRF-0028", sub: "Delhi WH → Mumbai WH · 180 units", time: "1h ago", color: P.blue, bg: P.blueBg, icon: Truck },
  { id: 5, type: "sale", text: "Invoice #SO-260614-0139 marked Paid", sub: "Mehta Traders · ₹88,200", time: "2h ago", color: P.teal, bg: P.tealBg, icon: CheckCircle2 },
];

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Package, label: "Items", badge: null },
  { icon: ShoppingCart, label: "Sales Orders", badge: "5" },
  { icon: ClipboardList, label: "Purchase Orders", badge: null },
  { icon: Truck, label: "Warehouses", badge: null },
  { icon: Boxes, label: "Stock", badge: null },
  { icon: Users, label: "Customers", badge: null },
  { icon: Globe, label: "Suppliers", badge: null },
  { icon: BarChart3, label: "Reports", badge: null },
  { icon: Wallet, label: "Payments", badge: null },
];

const quickActions = [
  { icon: Plus, label: "New Sale", color: P.violet, bg: P.violetBg },
  { icon: ShoppingCart, label: "New PO", color: P.teal, bg: P.tealBg },
  { icon: Truck, label: "Transfer", color: P.blue, bg: P.blueBg },
  { icon: FileText, label: "Invoice", color: P.amber, bg: P.amberBg },
];

/* ── Mini bar sparkline ──────────────────── */
function Spark({ data, color, height = 48 }: { data: { label: string; val: number }[]; color: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barSize={6} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
        <Bar dataKey="val" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === data.length - 1 ? color : `${color}55`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── KPI Card ────────────────────────────── */
function KpiCard({
  label, value, sub, trend, trendUp, trendLabel, data, color, period,
}: {
  label: string; value: string; sub: string; trend: string; trendUp: boolean; trendLabel: string;
  data: { label: string; val: number }[]; color: string; period: string;
}) {
  return (
    <div style={{ background: P.white, border: `1px solid ${P.slate200}`, borderRadius: 16 }} className="p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 12, fontWeight: 600, color: P.slate500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
        <div className="flex items-center gap-1.5">
          <span style={{ fontSize: 11, color: P.slate400, background: P.slate100, borderRadius: 20, padding: "2px 8px" }}>{period}</span>
          <button style={{ color: P.slate400 }} className="hover:opacity-70"><RefreshCw size={12} /></button>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: P.slate900, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</div>
          <div style={{ fontSize: 12, color: P.slate500, marginTop: 2 }}>{sub}</div>
        </div>
        <div style={{ width: 90, flexShrink: 0 }}>
          <Spark data={data} color={color} height={44} />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${P.slate100}`, paddingTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600,
          color: trendUp ? P.teal : P.red,
          background: trendUp ? P.tealBg : P.redBg,
          padding: "2px 7px", borderRadius: 20,
        }}>
          {trendUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{trend}
        </span>
        <span style={{ fontSize: 11, color: P.slate400 }}>{trendLabel}</span>
      </div>
    </div>
  );
}

/* ── Top Nav ─────────────────────────────── */
function TopBar() {
  return (
    <header style={{
      height: 58, background: P.white, borderBottom: `1px solid ${P.slate200}`,
      display: "flex", alignItems: "center", gap: 16, padding: "0 24px",
      position: "sticky", top: 0, zIndex: 10,
    }}>
      <div style={{
        flex: 1, display: "flex", alignItems: "center", gap: 8,
        background: P.slate50, border: `1px solid ${P.slate200}`,
        borderRadius: 10, padding: "0 12px", height: 36,
      }}>
        <Search size={14} color={P.slate400} />
        <span style={{ fontSize: 13, color: P.slate400 }}>Search items, orders, customers…</span>
        <kbd style={{ marginLeft: "auto", fontSize: 10, color: P.slate300, border: `1px solid ${P.slate200}`, borderRadius: 5, padding: "1px 5px" }}>⌘K</kbd>
      </div>
      <div className="flex items-center gap-2">
        <button style={{ width: 34, height: 34, borderRadius: 10, background: P.slate50, border: `1px solid ${P.slate200}`, display: "flex", alignItems: "center", justifyContent: "center", color: P.slate500 }}>
          <Moon size={15} />
        </button>
        <button style={{ width: 34, height: 34, borderRadius: 10, background: P.slate50, border: `1px solid ${P.slate200}`, display: "flex", alignItems: "center", justifyContent: "center", color: P.slate500, position: "relative" }}>
          <Bell size={15} />
          <span style={{ position: "absolute", top: 7, right: 7, width: 7, height: 7, background: P.red, borderRadius: "50%", border: `1.5px solid ${P.white}` }} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 4, cursor: "pointer" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${P.violet}, #4f46e5)`, display: "flex", alignItems: "center", justifyContent: "center", color: P.white, fontWeight: 700, fontSize: 12 }}>
            M
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: P.slate700, lineHeight: 1.2 }}>MM Wear</span>
            <span style={{ fontSize: 10, color: P.slate400, lineHeight: 1.2 }}>Admin</span>
          </div>
          <ChevronDown size={13} color={P.slate400} />
        </div>
      </div>
    </header>
  );
}

/* ── Sidebar ─────────────────────────────── */
function Sidebar() {
  return (
    <aside style={{
      width: 220, flexShrink: 0, background: P.white, borderRight: `1px solid ${P.slate200}`,
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      {/* Logo */}
      <div style={{ height: 58, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: `1px solid ${P.slate200}` }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${P.violet}, #4f46e5)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Boxes size={16} color={P.white} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: P.slate900, lineHeight: 1.2 }}>Mystics</div>
          <div style={{ fontSize: 10, color: P.slate400, lineHeight: 1.2 }}>Inventory ERP</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
        {navItems.map(({ icon: Icon, label, active, badge }) => (
          <div
            key={label}
            style={{
              display: "flex", alignItems: "center", gap: 9, padding: "8px 10px",
              borderRadius: 9, marginBottom: 2, cursor: "pointer", position: "relative",
              background: active ? P.violetBg : "transparent",
              color: active ? P.violet : P.slate500,
            }}
          >
            {active && (
              <span style={{ position: "absolute", left: 0, top: "20%", bottom: "20%", width: 3, background: P.violet, borderRadius: "0 4px 4px 0" }} />
            )}
            <Icon size={16} />
            <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{label}</span>
            {badge && (
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, background: P.violet, color: P.white, borderRadius: 20, padding: "1px 6px" }}>
                {badge}
              </span>
            )}
          </div>
        ))}

        <div style={{ borderTop: `1px solid ${P.slate100}`, margin: "8px 0 8px 0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, cursor: "pointer", color: P.slate500 }}>
          <Settings size={16} />
          <span style={{ fontSize: 13 }}>Settings</span>
        </div>
      </nav>

      {/* Pro tip */}
      <div style={{ margin: "0 10px 12px", background: `linear-gradient(135deg, ${P.violetBg}, #e0e7ff)`, borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <Zap size={13} color={P.violet} />
          <span style={{ fontSize: 11, fontWeight: 700, color: P.violet }}>Pro Tip</span>
        </div>
        <p style={{ fontSize: 11, color: P.slate600, lineHeight: 1.5 }}>
          Enable barcode scanning to speed up goods receipt by 3×.
        </p>
      </div>
    </aside>
  );
}

/* ── Custom Tooltip ──────────────────────── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: P.slate900, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: P.white }}>
      <div style={{ marginBottom: 4, color: P.slate300 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
          <span style={{ color: P.slate300, fontSize: 11 }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>₹{p.value}L</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main Dashboard ──────────────────────── */
export function Dashboard() {
  const [period, setPeriod] = useState("Last 7 Days");

  return (
    <div style={{ display: "flex", height: "100vh", background: P.slate50, fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif", overflow: "hidden" }}>
      <Sidebar />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar />

        {/* Scrollable body */}
        <main style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>

          {/* Page header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: P.violet, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                OPERATIONS COCKPIT
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: P.slate900, letterSpacing: "-0.03em", marginBottom: 4, lineHeight: 1.1 }}>
                Inventory Dashboard
              </h1>
              <p style={{ fontSize: 13, color: P.slate500 }}>
                Live snapshot — orders, stock health, revenue, and alerts in one view.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10,
                border: `1px solid ${P.slate200}`, background: P.white, fontSize: 13, fontWeight: 500, color: P.slate600, cursor: "pointer",
              }}>
                <RefreshCw size={13} />Refresh
              </button>
              <button style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10,
                background: P.violet, color: P.white, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                boxShadow: `0 4px 12px ${P.violet}40`,
              }}>
                <Plus size={14} />New Order
              </button>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            {quickActions.map(({ icon: Icon, label, color, bg }) => (
              <button key={label} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10,
                background: bg, border: `1px solid ${color}22`, color, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={12} color={P.white} />
                </span>
                {label}
              </button>
            ))}
            <button style={{
              marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10,
              background: P.white, border: `1px solid ${P.slate200}`, fontSize: 12, color: P.slate500, cursor: "pointer",
            }}>
              <Filter size={12} />Filter
            </button>
            <button style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10,
              background: P.white, border: `1px solid ${P.slate200}`, fontSize: 12, color: P.slate500, cursor: "pointer",
            }}>
              <Download size={12} />Export
            </button>
          </div>

          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
            <KpiCard
              label="Total Revenue"
              value="₹28.4L"
              sub="This month"
              trend="+18.2%"
              trendUp
              trendLabel="vs last month"
              data={revenueData.map(d => ({ label: d.month, val: d.sales }))}
              color={P.violet}
              period="Last 30 Days"
            />
            <KpiCard
              label="Sales Orders"
              value="142"
              sub="Orders · ₹18.6L GMV"
              trend="+12.4%"
              trendUp
              trendLabel="vs last week"
              data={orderData}
              color={P.teal}
              period="Last 7 Days"
            />
            <KpiCard
              label="Purchase Orders"
              value="38"
              sub="Orders · ₹9.8L spend"
              trend="-4.1%"
              trendUp={false}
              trendLabel="vs last week"
              data={poData}
              color={P.blue}
              period="Last 7 Days"
            />
            <KpiCard
              label="Stock Health"
              value="87%"
              sub="Items well-stocked"
              trend="+3.2%"
              trendUp
              trendLabel="vs last week"
              data={stockData}
              color={P.amber}
              period="Last 7 Days"
            />
          </div>

          {/* Stock alert strip */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
            background: `linear-gradient(90deg, ${P.amberBg}, #fff7ed)`,
            border: `1px solid ${P.amber}33`, borderRadius: 12, marginBottom: 20,
          }}>
            <AlertTriangle size={15} color={P.amber} />
            <span style={{ fontSize: 12, fontWeight: 600, color: P.amber }}>8 items below reorder point</span>
            <span style={{ fontSize: 12, color: P.slate500 }}>— Cotton Blend 60s, Polyester Crepe, Viscose Georgette, and 5 more</span>
            <button style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: P.amber, background: "transparent", border: `1px solid ${P.amber}44`, borderRadius: 8, padding: "3px 10px", cursor: "pointer" }}>
              Review all
            </button>
          </div>

          {/* Charts + Activity row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, marginBottom: 20 }}>

            {/* Area chart */}
            <div style={{ background: P.white, border: `1px solid ${P.slate200}`, borderRadius: 16, padding: "20px 20px 12px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: P.slate900 }}>Revenue Trend</div>
                  <div style={{ fontSize: 12, color: P.slate400, marginTop: 2 }}>Sales vs Purchases — last 7 months</div>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    {[{ label: "Sales", color: P.violet }, { label: "Purchases", color: P.teal }].map(l => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: P.slate500 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }} />{l.label}
                      </div>
                    ))}
                  </div>
                  <button style={{ fontSize: 11, color: P.slate400, border: `1px solid ${P.slate200}`, borderRadius: 8, padding: "3px 10px", background: P.white, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                    {period}<ChevronDown size={10} />
                  </button>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={revenueData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={P.violet} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={P.violet} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gPurchases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={P.teal} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={P.teal} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.slate100} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: P.slate400 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: P.slate400 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="sales" name="Sales" stroke={P.violet} strokeWidth={2.5} fill="url(#gSales)" dot={{ fill: P.violet, r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: P.violet }} />
                  <Area type="monotone" dataKey="purchases" name="Purchases" stroke={P.teal} strokeWidth={2} fill="url(#gPurchases)" dot={{ fill: P.teal, r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: P.teal }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Activity feed */}
            <div style={{ background: P.white, border: `1px solid ${P.slate200}`, borderRadius: 16, padding: "18px 18px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: P.slate900 }}>Live Activity</div>
                <button style={{ fontSize: 11, color: P.violet, fontWeight: 600, background: "transparent", border: "none", cursor: "pointer" }}>View all</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {activities.map(({ id, text, sub, time, color, bg, icon: Icon }) => (
                  <div key={id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={14} color={color} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: P.slate700, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</div>
                      <div style={{ fontSize: 11, color: P.slate400, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
                    </div>
                    <div style={{ fontSize: 10, color: P.slate400, flexShrink: 0, paddingTop: 2 }}>{time}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom stat strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {[
              { icon: CheckCircle2, label: "Paid Invoices", value: "94", sub: "This month", color: P.teal, bg: P.tealBg },
              { icon: Clock, label: "Pending Payments", value: "₹6.2L", sub: "12 overdue", color: P.amber, bg: P.amberBg },
              { icon: Star, label: "Top Customer", value: "Kumar Textiles", sub: "₹4.8L revenue", color: P.violet, bg: P.violetBg },
              { icon: Activity, label: "Items in Stock", value: "1,284", sub: "Across 3 warehouses", color: P.blue, bg: P.blueBg },
            ].map(({ icon: Icon, label, value, sub, color, bg }) => (
              <div key={label} style={{ background: P.white, border: `1px solid ${P.slate200}`, borderRadius: 14, padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
                <span style={{ width: 38, height: 38, borderRadius: 11, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={17} color={color} />
                </span>
                <div>
                  <div style={{ fontSize: 11, color: P.slate400, marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: P.slate900, lineHeight: 1.2 }}>{value}</div>
                  <div style={{ fontSize: 11, color: P.slate500 }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>

        </main>
      </div>
    </div>
  );
}
