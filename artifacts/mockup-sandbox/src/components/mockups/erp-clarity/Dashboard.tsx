import React from "react";
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Truck, 
  Users, 
  Store, 
  Building2, 
  ArrowRightLeft, 
  Hammer, 
  Blocks, 
  Settings,
  Search,
  Bell,
  ChevronDown,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  MoreHorizontal
} from "lucide-react";

export function Dashboard() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-900">
      {/* Sidebar */}
      <aside className="w-[260px] bg-white border-r border-slate-200 flex flex-col fixed h-full z-10">
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center">
              <Blocks className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Mystics</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3 mt-2">Core</div>
          <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" active />
          <NavItem icon={<Package size={18} />} label="Items" />
          <NavItem icon={<ShoppingCart size={18} />} label="Sales Orders" />
          <NavItem icon={<Truck size={18} />} label="Purchase Orders" />
          
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3 mt-8">Network</div>
          <NavItem icon={<Users size={18} />} label="Customers" />
          <NavItem icon={<Store size={18} />} label="Suppliers" />
          
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3 mt-8">Operations</div>
          <NavItem icon={<Building2 size={18} />} label="Warehouses" />
          <NavItem icon={<ArrowRightLeft size={18} />} label="Stock Transfers" />
          <NavItem icon={<Hammer size={18} />} label="Job Work" />
        </div>

        <div className="p-4 border-t border-slate-100">
          <NavItem icon={<Blocks size={18} />} label="Integrations" />
          <NavItem icon={<Settings size={18} />} label="Settings" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-[260px] flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-20">
          <div className="flex items-center w-96">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search orders, items, or customers..." 
                className="w-full pl-9 pr-4 py-2 bg-slate-100/50 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all placeholder:text-slate-400"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-5">
            <button className="relative text-slate-500 hover:text-slate-700 transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-0 right-0 w-2 h-2 bg-rose-500 rounded-full border border-white"></span>
            </button>
            <div className="h-6 w-px bg-slate-200"></div>
            <button className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-medium text-sm">
                AK
              </div>
              <div className="text-left hidden md:block">
                <div className="text-sm font-medium leading-none">Arjun Kumar</div>
                <div className="text-xs text-slate-500 mt-0.5">Admin</div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-8 max-w-7xl mx-auto w-full flex-1">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Overview</h1>
              <p className="text-sm text-slate-500 mt-1">Here's what's happening with your business today.</p>
            </div>
            <div className="flex gap-3">
              <select className="bg-white border border-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer shadow-sm">
                <option>Today</option>
                <option>Last 7 Days</option>
                <option selected>This Month</option>
                <option>This Year</option>
              </select>
              <button className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-indigo-600/20 transition-all flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                New Order
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <KpiCard 
              title="Total Revenue" 
              value="₹24,50,000" 
              trend="+12.5%" 
              isPositive={true}
              subtitle="vs last month"
            />
            <KpiCard 
              title="Sales Orders" 
              value="142" 
              trend="+8.2%" 
              isPositive={true}
              subtitle="vs last month"
            />
            <KpiCard 
              title="Purchase Value" 
              value="₹18,20,500" 
              trend="-2.4%" 
              isPositive={false}
              subtitle="vs last month"
            />
            <KpiCard 
              title="Pending Job Works" 
              value="28" 
              trend="+14" 
              isPositive={false}
              subtitle="needs attention"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            {/* Chart Area */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-base font-semibold">Revenue Trend</h2>
                  <p className="text-sm text-slate-500">Daily revenue for current month</p>
                </div>
                <button className="text-slate-400 hover:text-slate-600">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
              <div className="h-64 flex items-end gap-2 pt-4 relative">
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 bottom-6 w-12 flex flex-col justify-between text-xs text-slate-400 text-right pr-2">
                  <span>100k</span>
                  <span>75k</span>
                  <span>50k</span>
                  <span>25k</span>
                  <span>0</span>
                </div>
                {/* Chart grid lines */}
                <div className="absolute left-12 right-0 top-0 bottom-6 flex flex-col justify-between pointer-events-none">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-full h-px bg-slate-100"></div>
                  ))}
                </div>
                
                {/* Bars */}
                <div className="flex-1 flex items-end justify-between h-[calc(100%-1.5rem)] ml-12 z-10 pb-px">
                  {[40, 65, 45, 80, 55, 90, 70, 85, 60, 100, 75, 50, 85, 65].map((height, i) => (
                    <div key={i} className="w-full max-w-[24px] flex flex-col items-center group cursor-pointer">
                      <div className="w-full bg-indigo-100 hover:bg-indigo-200 transition-colors rounded-t-sm relative flex items-end">
                        <div 
                          className="w-full bg-indigo-600 rounded-t-sm transition-all group-hover:bg-indigo-500" 
                          style={{ height: `${height}%` }}
                        ></div>
                        {/* Tooltip */}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                          ₹{height * 1000}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* X-axis labels */}
                <div className="absolute left-12 right-0 bottom-0 h-6 flex justify-between items-end text-xs text-slate-400">
                  <span>1</span>
                  <span>5</span>
                  <span>10</span>
                  <span>15</span>
                  <span>20</span>
                  <span>25</span>
                  <span>30</span>
                </div>
              </div>
            </div>

            {/* Quick Actions / Activity */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
              <h2 className="text-base font-semibold mb-6">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-3 mb-8">
                <QuickAction icon={<Package className="w-5 h-5 text-emerald-600" />} label="Add Item" bg="bg-emerald-50 hover:bg-emerald-100" />
                <QuickAction icon={<Users className="w-5 h-5 text-blue-600" />} label="Add Customer" bg="bg-blue-50 hover:bg-blue-100" />
                <QuickAction icon={<ArrowRightLeft className="w-5 h-5 text-amber-600" />} label="Transfer Stock" bg="bg-amber-50 hover:bg-amber-100" />
                <QuickAction icon={<Store className="w-5 h-5 text-purple-600" />} label="Add Supplier" bg="bg-purple-50 hover:bg-purple-100" />
              </div>

              <h2 className="text-base font-semibold mb-4">Low Stock Alerts</h2>
              <div className="flex-1 flex flex-col gap-3">
                <AlertItem item="Basmati Rice 25kg" location="Main Warehouse" qty="5 bags" />
                <AlertItem item="Refined Sugar 5L" location="South Depot" qty="12 units" />
                <AlertItem item="Whole Wheat Flour" location="Main Warehouse" qty="8 bags" />
              </div>
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-white">
              <div>
                <h2 className="text-base font-semibold">Recent Sales Orders</h2>
                <p className="text-sm text-slate-500">Latest orders needing fulfillment.</p>
              </div>
              <button className="text-sm text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-1">
                View All <ArrowRightLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50/50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 font-medium">Order ID</th>
                    <th className="px-6 py-4 font-medium">Date</th>
                    <th className="px-6 py-4 font-medium">Customer</th>
                    <th className="px-6 py-4 font-medium text-right">Amount</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <TableRow 
                    id="SO-260614-0042" 
                    date="Today, 10:42 AM" 
                    customer="Sharma Traders" 
                    amount="₹45,200" 
                    status="Confirmed"
                    statusColor="bg-sky-100 text-sky-700"
                  />
                  <TableRow 
                    id="SO-260614-0041" 
                    date="Today, 09:15 AM" 
                    customer="Verma Enterprises" 
                    amount="₹1,12,500" 
                    status="Dispatched"
                    statusColor="bg-indigo-100 text-indigo-700"
                  />
                  <TableRow 
                    id="SO-260613-0040" 
                    date="Yesterday, 04:30 PM" 
                    customer="Gupta Provision Store" 
                    amount="₹28,400" 
                    status="Delivered"
                    statusColor="bg-emerald-100 text-emerald-700"
                  />
                  <TableRow 
                    id="SO-260613-0039" 
                    date="Yesterday, 02:10 PM" 
                    customer="Sri Balaji Mart" 
                    amount="₹84,000" 
                    status="Pending"
                    statusColor="bg-amber-100 text-amber-700"
                  />
                  <TableRow 
                    id="SO-260612-0038" 
                    date="Jun 12, 2024" 
                    customer="National Wholesalers" 
                    amount="₹2,45,000" 
                    status="Delivered"
                    statusColor="bg-emerald-100 text-emerald-700"
                  />
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <a 
      href="#" 
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active 
          ? "bg-slate-100 text-slate-900" 
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <div className={`${active ? "text-indigo-600" : "text-slate-400"}`}>
        {icon}
      </div>
      {label}
    </a>
  );
}

function KpiCard({ title, value, trend, isPositive, subtitle }: { title: string, value: string, trend: string, isPositive: boolean, subtitle: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-medium text-slate-500 mb-1">{title}</h3>
      <div className="text-3xl font-semibold text-slate-900 tracking-tight mb-3">{value}</div>
      <div className="flex items-center gap-2 text-sm">
        <div className={`flex items-center gap-0.5 font-medium px-2 py-0.5 rounded-md ${
          isPositive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {isPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
          {trend}
        </div>
        <span className="text-slate-400">{subtitle}</span>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, bg }: { icon: React.ReactNode, label: string, bg: string }) {
  return (
    <button className={`${bg} rounded-lg p-3 flex flex-col items-center justify-center gap-2 transition-colors border border-transparent hover:border-black/5`}>
      <div className="bg-white p-2 rounded-md shadow-sm">
        {icon}
      </div>
      <span className="text-xs font-medium text-slate-700">{label}</span>
    </button>
  );
}

function AlertItem({ item, location, qty }: { item: string, location: string, qty: string }) {
  return (
    <div className="flex items-start justify-between p-3 rounded-lg border border-slate-100 bg-slate-50/50">
      <div>
        <div className="text-sm font-medium text-slate-900">{item}</div>
        <div className="text-xs text-slate-500 mt-0.5">{location}</div>
      </div>
      <div className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-1 rounded">
        {qty} left
      </div>
    </div>
  );
}

function TableRow({ id, date, customer, amount, status, statusColor }: { id: string, date: string, customer: string, amount: string, status: string, statusColor: string }) {
  return (
    <tr className="hover:bg-slate-50 transition-colors group cursor-pointer">
      <td className="px-6 py-4 font-medium text-indigo-600">{id}</td>
      <td className="px-6 py-4 text-slate-500">{date}</td>
      <td className="px-6 py-4 text-slate-900 font-medium">{customer}</td>
      <td className="px-6 py-4 text-right font-medium text-slate-900">{amount}</td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusColor}`}>
          {status}
        </span>
      </td>
    </tr>
  );
}
