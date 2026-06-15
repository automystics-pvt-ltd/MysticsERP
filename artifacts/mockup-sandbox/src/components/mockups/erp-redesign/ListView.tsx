import { useState } from "react";
import {
  LayoutDashboard, ShoppingCart, Package, CreditCard, Users, Bell,
  HelpCircle, Settings, ChevronLeft, Search, Download, Upload,
  ChevronDown, MoreHorizontal, Check, X, Printer, Copy, Filter,
  ArrowUpDown, ChevronRight
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: ShoppingCart, label: "Orders", active: true },
  { icon: Package, label: "Inventory" },
  { icon: CreditCard, label: "Payments" },
  { icon: Users, label: "Customers" },
];

const ORDERS = [
  { id: "#192541", initials: "EH", color: "bg-emerald-600", customer: "Esther Howard", type: "Shipping", status: "Paid", total: "₹2,43,600", date: "Jun 19" },
  { id: "#192540", initials: "DM", color: "bg-blue-600", customer: "David Miller", type: "Pickups", status: "Paid", total: "₹1,18,900", date: "Jun 19" },
  { id: "#192539", initials: "JM", color: "bg-purple-600", customer: "James Moore", type: "Shipping", status: "Paid", total: "₹87,450", date: "Jun 19", checked: true },
  { id: "#192538", initials: "RA", color: "bg-orange-500", customer: "Robert Anderson", type: "Shipping", status: "Overdue", total: "₹3,12,700", date: "Jun 18" },
  { id: "#192537", initials: "JM2", color: "bg-pink-600", customer: "Jessica Martinez", type: "Shipping", status: "Pending", total: "₹64,200", date: "Jun 18" },
  { id: "#192536", initials: "WJ", color: "bg-teal-600", customer: "William Jackson", type: "Shipping", status: "Paid", total: "₹1,56,800", date: "Jun 18" },
  { id: "#192535", initials: "CH", color: "bg-yellow-600", customer: "Christopher Harris", type: "Pickups", status: "Paid", total: "₹92,300", date: "Jun 18", checked: true },
  { id: "#192534", initials: "MK", color: "bg-cyan-600", customer: "Marcus Kenter", type: "Shipping", status: "Paid", total: "₹2,18,500", date: "Jun 18" },
  { id: "#192533", initials: "JT", color: "bg-red-600", customer: "Joshua Thompson", type: "Shipping", status: "Cancelled", total: "₹41,000", date: "Jun 17" },
  { id: "#192532", initials: "MM", color: "bg-indigo-600", customer: "Megan Martin", type: "Shipping", status: "Paid", total: "₹1,28,600", date: "Jun 17", checked: true },
];

const STATUS_COLORS: Record<string, string> = {
  Paid: "text-emerald-400 bg-emerald-400/10",
  Overdue: "text-red-400 bg-red-400/10",
  Pending: "text-amber-400 bg-amber-400/10",
  Cancelled: "text-zinc-400 bg-zinc-400/10",
};

const CHIPS = ["Type", "Status", "Order date", "All filters"];

export function ListView() {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(ORDERS.filter(o => o.checked).map(o => o.id))
  );
  const [collapsed, setCollapsed] = useState(false);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => selected.size === ORDERS.length
    ? setSelected(new Set())
    : setSelected(new Set(ORDERS.map(o => o.id)));

  const sidebarW = collapsed ? 64 : 220;

  return (
    <div className="flex h-screen bg-[#111111] text-white overflow-hidden font-sans select-none">

      {/* Sidebar */}
      <aside
        style={{ width: sidebarW, minWidth: sidebarW }}
        className="flex flex-col h-full bg-[#0c0c0c] border-r border-white/5 transition-all duration-200"
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-white/5 flex-shrink-0">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <span className="text-[10px] font-bold">M</span>
              </div>
              <span className="font-semibold text-sm tracking-wide">Mystics</span>
            </div>
          )}
          {collapsed && (
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto">
              <span className="text-[10px] font-bold">M</span>
            </div>
          )}
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="text-white/30 hover:text-white/60 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search */}
        {!collapsed && (
          <div className="px-3 pt-3 pb-1 flex-shrink-0">
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
              <Search className="w-3.5 h-3.5 text-white/30" />
              <span className="text-xs text-white/30">Search</span>
              <span className="ml-auto text-[10px] text-white/20 bg-white/5 rounded px-1.5 py-0.5">⌘F</span>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                active
                  ? "bg-white text-black font-medium"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="text-sm">{label}</span>}
            </div>
          ))}
        </nav>

        {/* Bottom nav */}
        <div className="px-2 pb-2 space-y-0.5 border-t border-white/5 pt-2 flex-shrink-0">
          {[{ icon: Bell, label: "Notifications", badge: "7" }, { icon: HelpCircle, label: "Help & support" }, { icon: Settings, label: "Settings" }].map(({ icon: Icon, label, badge }) => (
            <div key={label} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-white/40 hover:text-white hover:bg-white/5 transition-all">
              <div className="relative flex-shrink-0">
                <Icon className="w-4 h-4" />
                {badge && <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">{badge}</span>}
              </div>
              {!collapsed && <span className="text-sm">{label}</span>}
            </div>
          ))}
        </div>

        {/* User */}
        <div className="px-3 pb-4 flex-shrink-0">
          <div className="flex items-center gap-2.5 cursor-pointer group">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 flex-shrink-0 flex items-center justify-center text-[10px] font-semibold">OW</div>
            {!collapsed && (
              <>
                <span className="text-xs text-white/60 group-hover:text-white transition-colors">Olivia Williams</span>
                <MoreHorizontal className="w-3.5 h-3.5 text-white/30 ml-auto" />
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#141414]">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-4 flex-shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white gap-1.5 text-xs h-8">
              <Download className="w-3.5 h-3.5" /> Import
            </Button>
            <Button size="sm" variant="outline" className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white gap-1.5 text-xs h-8">
              <Upload className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 px-8 pb-4 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-violet-500/20 text-violet-300 border border-violet-500/30 rounded-full px-3 py-1 text-xs font-medium cursor-pointer">
            Type <span className="bg-violet-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] ml-0.5">3</span>
            <ChevronDown className="w-3 h-3 ml-0.5" />
          </div>
          {CHIPS.slice(1).map(c => (
            <div key={c} className="flex items-center gap-1.5 bg-white/5 text-white/50 border border-white/8 rounded-full px-3 py-1 text-xs cursor-pointer hover:bg-white/8 hover:text-white/70 transition-all">
              {c} <ChevronDown className="w-3 h-3" />
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-8">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="pb-3 pr-3 w-8">
                  <Checkbox
                    checked={selected.size === ORDERS.length}
                    onCheckedChange={toggleAll}
                    className="border-white/20 data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
                  />
                </th>
                {["Order", "Customer", "Type", "Status", "Total", "Date", ""].map((h, i) => (
                  <th key={i} className="pb-3 text-left text-xs font-medium text-white/30 pr-4">
                    <div className="flex items-center gap-1">
                      {h}
                      {h && h !== "" && <ArrowUpDown className="w-3 h-3 opacity-50" />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ORDERS.map((order) => (
                <tr
                  key={order.id}
                  className={`border-b border-white/[0.04] transition-colors cursor-pointer ${
                    selected.has(order.id) ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"
                  }`}
                  onClick={() => toggle(order.id)}
                >
                  <td className="py-3.5 pr-3">
                    <Checkbox
                      checked={selected.has(order.id)}
                      onCheckedChange={() => toggle(order.id)}
                      className="border-white/20 data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
                    />
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className="text-sm font-medium text-white/80">{order.id}</span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full ${order.color} flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0`}>
                        {order.initials.slice(0, 2)}
                      </div>
                      <span className="text-sm text-white/70">{order.customer}</span>
                    </div>
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className="text-sm text-white/50">{order.type}</span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[order.status]}`}>
                      {order.status === "Paid" && <Check className="w-2.5 h-2.5 inline mr-1" />}
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className="text-sm font-medium text-white/80">{order.total}</span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className="text-sm text-white/40">{order.date}</span>
                  </td>
                  <td className="py-3.5 text-right">
                    <button className="text-white/20 hover:text-white/60 transition-colors p-1">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 text-xs text-white/30">
              <span>Rows per page:</span>
              <div className="flex items-center gap-1 bg-white/5 rounded px-2 py-1 cursor-pointer">
                10 <ChevronDown className="w-3 h-3" />
              </div>
              <span>Showing 1–10 of 248</span>
            </div>
            <div className="flex items-center gap-1">
              {[1,2,3,"…",25].map((p, i) => (
                <button key={i} className={`w-7 h-7 rounded text-xs transition-colors ${p === 1 ? "bg-violet-600 text-white" : "text-white/30 hover:bg-white/5"}`}>
                  {p}
                </button>
              ))}
              <ChevronRight className="w-4 h-4 text-white/30 ml-1" />
            </div>
          </div>
        </div>
      </main>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#1e1e1e] border border-white/10 rounded-xl px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-sm">
          <button
            onClick={() => setSelected(new Set())}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/8 hover:text-white transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-white/50 px-2 border-r border-white/10 mr-1">
            Selected: <span className="text-white font-medium">{selected.size}</span>
          </span>
          {[
            { icon: Upload, label: "Export" },
            { icon: Printer, label: "Print" },
            { icon: Copy, label: "Duplicate" },
          ].map(({ icon: Icon, label }) => (
            <button key={label} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/8 rounded-lg transition-all">
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
          <button className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:bg-white/8 hover:text-white transition-all">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
