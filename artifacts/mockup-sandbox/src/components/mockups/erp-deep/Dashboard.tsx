import React from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ShoppingBag,
  Users,
  Truck,
  Building2,
  ArrowRightLeft,
  Briefcase,
  Wrench,
  Settings,
  Bell,
  Search,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Activity,
  MoreVertical,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Zap
} from "lucide-react";

export function Dashboard() {
  return (
    <div className="min-h-screen bg-[#06080D] text-slate-300 font-sans selection:bg-cyan-500/30 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0A0D14] border-r border-slate-800/50 flex flex-col z-20 relative">
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />
        
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-slate-800/50">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.4)]">
            <Zap className="w-4 h-4 text-white fill-white" />
          </div>
          <span className="ml-3 text-white font-bold tracking-wide text-lg">Mystics<span className="text-cyan-400 font-medium">ERP</span></span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1 scrollbar-hide">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2 px-3">Overview</div>
          <NavItem icon={LayoutDashboard} label="Dashboard" active />
          
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mt-6 mb-2 px-3">Inventory & Sales</div>
          <NavItem icon={Package} label="Items" />
          <NavItem icon={ShoppingCart} label="Sales Orders" />
          <NavItem icon={ShoppingBag} label="Purchase Orders" />
          
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mt-6 mb-2 px-3">Network</div>
          <NavItem icon={Users} label="Customers" />
          <NavItem icon={Truck} label="Suppliers" />
          
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mt-6 mb-2 px-3">Operations</div>
          <NavItem icon={Building2} label="Warehouses" />
          <NavItem icon={ArrowRightLeft} label="Stock Transfers" />
          <NavItem icon={Briefcase} label="Job Work" />
          
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mt-6 mb-2 px-3">System</div>
          <NavItem icon={Wrench} label="Integrations" />
          <NavItem icon={Settings} label="Settings" />
        </nav>

        {/* User */}
        <div className="p-4 border-t border-slate-800/50">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/30 cursor-pointer transition-colors">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 font-medium">
              AK
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-200 font-medium truncate">Amit Kumar</div>
              <div className="text-xs text-slate-500 truncate">Administrator</div>
            </div>
            <MoreVertical className="w-4 h-4 text-slate-500" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <div className="absolute top-0 right-0 w-[800px] h-[500px] bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[400px] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none" />

        {/* Header */}
        <header className="h-16 border-b border-slate-800/50 bg-[#0A0D14]/80 backdrop-blur-md flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-white tracking-tight">Command Center</h1>
            <div className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Sync
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="relative group">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-cyan-400 transition-colors" />
              <input 
                type="text" 
                placeholder="Search orders, items, customers..." 
                className="w-64 bg-slate-900/50 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50 focus:bg-slate-900 transition-all shadow-inner"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 font-mono text-[10px] font-medium text-slate-400">⌘</kbd>
                <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 font-mono text-[10px] font-medium text-slate-400">K</kbd>
              </div>
            </div>
            
            <button className="relative p-2 text-slate-400 hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 border border-[#0A0D14]" />
            </button>
            
            <button className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-all shadow-[0_0_15px_rgba(8,145,178,0.4)]">
              <Plus className="w-4 h-4" />
              <span>New Order</span>
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 z-10 scrollbar-hide">
          <div className="max-w-7xl mx-auto space-y-8">
            
            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <KpiCard 
                title="Total Revenue (MTD)" 
                value="₹ 45,23,000" 
                trend="+14.2%" 
                trendUp={true}
                color="cyan"
                sparkline={[20, 30, 25, 45, 35, 60, 50, 70, 65, 80]}
              />
              <KpiCard 
                title="Active Orders" 
                value="142" 
                trend="+8.1%" 
                trendUp={true}
                color="emerald"
                sparkline={[40, 35, 45, 40, 55, 50, 60, 55, 70, 75]}
              />
              <KpiCard 
                title="Stock Valuation" 
                value="₹ 1.12 Cr" 
                trend="-2.4%" 
                trendUp={false}
                color="purple"
                sparkline={[80, 75, 78, 70, 72, 65, 68, 60, 62, 58]}
              />
              <KpiCard 
                title="Pending Payables" 
                value="₹ 8,45,000" 
                trend="+5.0%" 
                trendUp={false}
                color="rose"
                sparkline={[30, 35, 32, 40, 38, 45, 42, 50, 48, 55]}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Chart Section */}
              <div className="lg:col-span-2 bg-[#0A0D14]/80 backdrop-blur border border-slate-800/60 rounded-xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-[80px]" />
                
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Revenue vs Target</h2>
                    <p className="text-sm text-slate-400">Monthly performance tracking</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                      <span className="text-slate-300">Revenue</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-slate-600" />
                      <span className="text-slate-400">Target</span>
                    </div>
                    <button className="flex items-center gap-1 px-3 py-1 bg-slate-900 border border-slate-700 rounded-md text-slate-300 hover:bg-slate-800 transition-colors ml-2">
                      Last 6 Months <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Mock Chart */}
                <div className="h-64 flex items-end gap-2 relative z-10 mt-4">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="w-full h-[1px] bg-slate-800/40" />
                    ))}
                  </div>
                  
                  {/* Y-axis labels */}
                  <div className="absolute -left-2 inset-y-0 flex flex-col justify-between items-end text-[10px] text-slate-500 font-mono py-1 pointer-events-none">
                    <span>10M</span>
                    <span>7.5M</span>
                    <span>5M</span>
                    <span>2.5M</span>
                    <span>0</span>
                  </div>

                  {/* Bars */}
                  <div className="w-full h-full flex items-end justify-between px-8 relative">
                    {[
                      { month: 'Jan', val: 40, target: 50 },
                      { month: 'Feb', val: 55, target: 55 },
                      { month: 'Mar', val: 45, target: 60 },
                      { month: 'Apr', val: 70, target: 65 },
                      { month: 'May', val: 85, target: 70 },
                      { month: 'Jun', val: 95, target: 75 },
                    ].map((d, i) => (
                      <div key={i} className="flex flex-col items-center gap-3 w-full group">
                        <div className="relative w-16 h-[200px] flex items-end justify-center">
                          {/* Target Bar (Background) */}
                          <div 
                            className="absolute bottom-0 w-8 bg-slate-800/50 border-t border-slate-700/50 rounded-t-sm"
                            style={{ height: `${d.target}%` }}
                          />
                          {/* Value Bar (Foreground) */}
                          <div 
                            className="absolute bottom-0 w-4 bg-gradient-to-t from-cyan-600 to-cyan-400 rounded-t-sm group-hover:from-cyan-500 group-hover:to-cyan-300 transition-all shadow-[0_0_15px_rgba(34,211,238,0.2)] group-hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] z-10"
                            style={{ height: `${d.val}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400 font-medium">{d.month}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Quick Actions / Activity */}
              <div className="bg-[#0A0D14]/80 backdrop-blur border border-slate-800/60 rounded-xl p-6 shadow-xl flex flex-col">
                <h2 className="text-lg font-semibold text-white mb-6">Quick Actions</h2>
                <div className="grid grid-cols-2 gap-3 mb-8">
                  <ActionBtn icon={ShoppingCart} label="Create SO" color="cyan" />
                  <ActionBtn icon={ShoppingBag} label="Create PO" color="purple" />
                  <ActionBtn icon={ArrowRightLeft} label="Transfer" color="emerald" />
                  <ActionBtn icon={Users} label="Add Client" color="rose" />
                </div>

                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
                  <button className="text-xs text-cyan-400 hover:text-cyan-300">View All</button>
                </div>
                
                <div className="flex-1 space-y-4 overflow-hidden relative">
                  <div className="absolute left-[11px] top-2 bottom-2 w-[1px] bg-slate-800" />
                  
                  <ActivityItem 
                    time="10 min ago"
                    title="Payment Received"
                    desc="₹ 1,45,000 from Sharma Traders"
                    icon={TrendingUp}
                    color="text-emerald-400"
                    bg="bg-emerald-400/10"
                  />
                  <ActivityItem 
                    time="1 hour ago"
                    title="Stock Alert"
                    desc="Basmati Rice 25kg below minimum"
                    icon={Activity}
                    color="text-rose-400"
                    bg="bg-rose-400/10"
                  />
                  <ActivityItem 
                    time="3 hours ago"
                    title="New Sales Order"
                    desc="SO-260614-0045 created"
                    icon={ShoppingCart}
                    color="text-cyan-400"
                    bg="bg-cyan-400/10"
                  />
                </div>
              </div>
            </div>

            {/* Data Table */}
            <div className="bg-[#0A0D14]/80 backdrop-blur border border-slate-800/60 rounded-xl shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Recent Sales Orders</h2>
                  <p className="text-sm text-slate-400">Latest orders needing attention</p>
                </div>
                <div className="flex items-center gap-3">
                  <button className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-2">
                    <Search className="w-4 h-4" /> Filter
                  </button>
                  <button className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-2">
                    Export
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-900/50 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px] font-semibold">
                    <tr>
                      <th className="px-6 py-4">Order ID</th>
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Customer</th>
                      <th className="px-6 py-4 text-right">Amount (₹)</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 text-slate-300">
                    <TableRow 
                      id="SO-260614-0042" 
                      date="Today, 10:42 AM" 
                      customer="Sharma Traders" 
                      amount="1,45,000" 
                      status="Delivered" 
                    />
                    <TableRow 
                      id="SO-260614-0043" 
                      date="Today, 09:15 AM" 
                      customer="Balaji Enterprises" 
                      amount="45,200" 
                      status="Processing" 
                    />
                    <TableRow 
                      id="SO-260614-0044" 
                      date="Yesterday" 
                      customer="Verma & Sons" 
                      amount="3,12,000" 
                      status="Pending" 
                    />
                    <TableRow 
                      id="SO-260614-0045" 
                      date="Yesterday" 
                      customer="Gupta Distributors" 
                      amount="89,000" 
                      status="Delivered" 
                    />
                    <TableRow 
                      id="SO-260614-0046" 
                      date="12 Jun 2024" 
                      customer="Ramesh Wholesalers" 
                      amount="5,60,000" 
                      status="Processing" 
                    />
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-slate-800/50 text-center">
                <button className="text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
                  View All Orders →
                </button>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}

// Subcomponents

function NavItem({ icon: Icon, label, active = false }: { icon: any, label: string, active?: boolean }) {
  return (
    <a href="#" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative ${
      active 
        ? 'text-white bg-gradient-to-r from-cyan-500/20 to-transparent' 
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
    }`}>
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-400 rounded-r shadow-[0_0_10px_rgba(34,211,238,0.6)]" />
      )}
      <Icon className={`w-4 h-4 ${active ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
      {label}
    </a>
  );
}

function KpiCard({ title, value, trend, trendUp, color, sparkline }: any) {
  const colorMap: Record<string, string> = {
    cyan: 'from-cyan-500/20 to-cyan-500/5 text-cyan-400 border-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.1)]',
    emerald: 'from-emerald-500/20 to-emerald-500/5 text-emerald-400 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]',
    purple: 'from-purple-500/20 to-purple-500/5 text-purple-400 border-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.1)]',
    rose: 'from-rose-500/20 to-rose-500/5 text-rose-400 border-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.1)]',
  };

  const lineColors: Record<string, string> = {
    cyan: 'stroke-cyan-400',
    emerald: 'stroke-emerald-400',
    purple: 'stroke-purple-400',
    rose: 'stroke-rose-400',
  };

  const points = sparkline.map((val: number, i: number) => {
    const x = (i / (sparkline.length - 1)) * 100;
    const y = 100 - val; // invert y
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="bg-[#0A0D14]/80 backdrop-blur border border-slate-800/60 rounded-xl p-5 relative overflow-hidden group hover:border-slate-700 transition-colors">
      <div className={`absolute inset-0 bg-gradient-to-br ${colorMap[color]} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
      
      <div className="relative z-10 flex flex-col h-full justify-between gap-4">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-medium text-slate-400">{title}</h3>
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border ${
            trendUp 
              ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' 
              : 'text-rose-400 bg-rose-400/10 border-rose-400/20'
          }`}>
            {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend}
          </div>
        </div>
        
        <div>
          <div className="text-2xl font-bold text-white tracking-tight mb-2 drop-shadow-md">{value}</div>
          
          <div className="h-8 w-full mt-2 opacity-60 group-hover:opacity-100 transition-opacity">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
              <polyline
                fill="none"
                strokeWidth="3"
                className={`${lineColors[color]} drop-shadow-[0_0_5px_currentColor]`}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, color }: any) {
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border-cyan-500/20',
    purple: 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border-purple-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border-rose-500/20',
  };

  return (
    <button className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all ${colorMap[color]}`}>
      <Icon className="w-5 h-5" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function ActivityItem({ time, title, desc, icon: Icon, color, bg }: any) {
  return (
    <div className="relative pl-8 pb-4 group">
      <div className={`absolute left-0 top-1 w-6 h-6 rounded-full ${bg} flex items-center justify-center z-10 border border-[#0A0D14]`}>
        <Icon className={`w-3 h-3 ${color}`} />
      </div>
      <div className="flex flex-col">
        <div className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{title}</div>
        <div className="text-xs text-slate-500 mb-1">{desc}</div>
        <div className="text-[10px] text-slate-600 font-medium">{time}</div>
      </div>
    </div>
  );
}

function TableRow({ id, date, customer, amount, status }: any) {
  const getStatusColor = (s: string) => {
    switch(s.toLowerCase()) {
      case 'delivered': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'processing': return 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20';
      case 'pending': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      default: return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
    }
  };

  return (
    <tr className="hover:bg-slate-800/30 transition-colors group">
      <td className="px-6 py-4 font-mono text-xs font-medium text-cyan-400">{id}</td>
      <td className="px-6 py-4 text-slate-400">{date}</td>
      <td className="px-6 py-4 font-medium">{customer}</td>
      <td className="px-6 py-4 text-right font-mono text-slate-200">{amount}</td>
      <td className="px-6 py-4">
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border uppercase tracking-wider ${getStatusColor(status)}`}>
          {status}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <button className="p-1 text-slate-500 hover:text-cyan-400 transition-colors opacity-0 group-hover:opacity-100">
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

export default Dashboard;
