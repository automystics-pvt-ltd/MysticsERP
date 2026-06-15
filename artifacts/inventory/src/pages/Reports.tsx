import { PageHeader } from "@/components/PageHeader";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  FileText,
  AlertTriangle,
  TrendingUp,
  ShoppingBag,
  Clock,
  Warehouse,
  Receipt,
  BookText,
  Scissors,
  Hourglass,
  ChevronRight,
  RotateCcw,
  Tag,
  ArrowLeftRight,
  BarChart3,
  MonitorSmartphone,
  Store,
  TimerIcon,
  ListChecks,
} from "lucide-react";

interface Report {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  colorCls: string;
}

interface ReportGroup {
  label: string;
  reports: Report[];
}

const REPORT_GROUPS: ReportGroup[] = [
  {
    label: "Inventory",
    reports: [
      {
        title: "Inventory Valuation",
        description: "Current stock value broken down by item based on unit cost.",
        href: "/reports/inventory-valuation",
        icon: FileText,
        colorCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      },
      {
        title: "Warehouse-Wise Valuation",
        description: "Stock value for every item broken down by warehouse location.",
        href: "/reports/warehouse-valuation",
        icon: Warehouse,
        colorCls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
      },
      {
        title: "Low Stock",
        description: "Items that have fallen below their configured min stock level.",
        href: "/reports/low-stock",
        icon: AlertTriangle,
        colorCls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      },
      {
        title: "Inventory Ageing",
        description: "How long current stock has been sitting, bucketed by age since last receipt.",
        href: "/reports/inventory-ageing",
        icon: TimerIcon,
        colorCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      },
      {
        title: "Stock Transfers",
        description: "History of warehouse-to-warehouse transfer movements and their status.",
        href: "/reports/stock-transfers",
        icon: ArrowLeftRight,
        colorCls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
      },
    ],
  },
  {
    label: "Sales & Purchases",
    reports: [
      {
        title: "Sales Summary",
        description: "Revenue performance and top customers.",
        href: "/reports/sales-summary",
        icon: TrendingUp,
        colorCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      },
      {
        title: "Purchase Summary",
        description: "Procurement expenses and top suppliers.",
        href: "/reports/purchase-summary",
        icon: ShoppingBag,
        colorCls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
      },
      {
        title: "Profit & Loss",
        description: "Revenue vs cost of goods sold with gross margin analysis per item.",
        href: "/reports/profit-loss",
        icon: BarChart3,
        colorCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
      },
      {
        title: "Receivables Aging",
        description: "Outstanding customer balances bucketed by days overdue.",
        href: "/reports/receivables-aging",
        icon: Clock,
        colorCls: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      },
      {
        title: "Payables Aging",
        description: "Outstanding supplier balances bucketed by days overdue.",
        href: "/reports/payables-aging",
        icon: Clock,
        colorCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      },
      {
        title: "Returns",
        description: "Cancelled shipments and returned units by reason, customer, and warehouse.",
        href: "/reports/returns",
        icon: RotateCcw,
        colorCls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
      },
      {
        title: "Discounts",
        description: "Discounts given across sales orders, broken down by item and trend over time.",
        href: "/reports/discounts",
        icon: Tag,
        colorCls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
      },
      {
        title: "Shopify Orders",
        description: "Sales orders imported from your Shopify store with revenue trend.",
        href: "/reports/shopify-orders",
        icon: Store,
        colorCls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      },
      {
        title: "POS Sessions",
        description: "Point-of-sale session performance and cash reconciliation per session.",
        href: "/reports/pos-sessions",
        icon: MonitorSmartphone,
        colorCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      },
    ],
  },
  {
    label: "Manufacturing & Compliance",
    reports: [
      {
        title: "Stock with Job Workers",
        description: "Materials currently held at outside job workers, by worker.",
        href: "/reports/stock-with-job-workers",
        icon: Scissors,
        colorCls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
      },
      {
        title: "Pending Job Work",
        description: "Open job work orders with how much is still to be received.",
        href: "/reports/pending-job-work",
        icon: Hourglass,
        colorCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
      },
      {
        title: "GST Returns",
        description: "Preview GSTR-1, GSTR-3B and HSN summary, then download CSV or GSTN JSON.",
        href: "/reports/gst-returns",
        icon: Receipt,
        colorCls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
      },
      {
        title: "Tally Export",
        description: "Download a Tally-importable XML of vouchers (sales, purchases, payments).",
        href: "/reports/tally-export",
        icon: BookText,
        colorCls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
      },
      {
        title: "Approval Analytics",
        description: "Approval request trends, SLA compliance, and average resolution times by module.",
        href: "/reports/approvals",
        icon: ListChecks,
        colorCls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
      },
    ],
  },
];

function ReportCard({ report }: { report: Report }) {
  const Icon = report.icon;
  return (
    <Link
      href={report.href}
      data-testid={`link-report-${report.title.toLowerCase().replace(/\s+/g, "-")}`}
      className="group flex items-start gap-4 p-4 rounded-xl border border-border/60 bg-card hover:border-border hover:shadow-sm transition-all duration-150 cursor-pointer"
    >
      <div
        className={cn(
          "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105",
          report.colorCls,
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">
          {report.title}
        </p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
          {report.description}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  );
}

export default function Reports() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Business intelligence and analytics for your inventory."
      />

      <div className="space-y-7">
        {REPORT_GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-3">
              {group.label}
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {group.reports.map((report) => (
                <ReportCard key={report.href} report={report} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
