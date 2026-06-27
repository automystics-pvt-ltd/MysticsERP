import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  Users,
  Truck,
  Warehouse,
  AlertTriangle,
  ArrowLeftRight,
  Repeat,
  ShoppingCart,
  ShoppingBag,
  ScanLine,
  IndianRupee,
  BarChart3,
  Blocks,
  Scissors,
  Settings,
  UserCog,
  Boxes,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  CalendarCheck,
  ClipboardList,
  GitMerge,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useGetCurrentOrganization, useGetMe } from "@/lib/queryKeys";
import type { LucideIcon } from "lucide-react";
import { useOptionalSidebarCollapse } from "./SidebarContext";
import { useImageSrc } from "@/hooks/use-image-src";
import { useMyPermissions } from "@/hooks/usePermissions";

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
  collapsible?: boolean;
}

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  module?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const platformSection: NavSection = {
  label: "Platform",
  items: [{ name: "Admin", href: "/admin", icon: ShieldCheck }],
};

const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
      { name: "Approvals", href: "/approvals", icon: ListChecks, module: "approvals" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { name: "Items", href: "/items", icon: Package, module: "items" },
      { name: "Barcodes", href: "/barcodes", icon: ScanLine, module: "barcodes" },
      { name: "Warehouses", href: "/warehouses", icon: Warehouse, module: "warehouses" },
      { name: "Transfers", href: "/transfers", icon: ArrowLeftRight, module: "stock_transfers" },
      { name: "Write-offs", href: "/write-offs", icon: AlertTriangle, module: "write_offs" },
    ],
  },
  {
    label: "Sales",
    items: [
      { name: "POS", href: "/pos", icon: ScanLine, module: "pos" },
      { name: "Day Closing", href: "/pos/sessions", icon: CalendarCheck, module: "pos" },
      { name: "Orders", href: "/sales-orders", icon: ShoppingCart, module: "sales_orders" },
      { name: "Payments", href: "/payments", icon: IndianRupee, module: "payments" },
      { name: "Customers", href: "/customers", icon: Users, module: "customers" },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { name: "Purchase Orders", href: "/purchase-orders", icon: ShoppingBag, module: "purchase_orders" },
      { name: "Job Work", href: "/job-work", icon: Scissors, module: "job_work" },
      { name: "Supplier Payments", href: "/supplier-payments", icon: IndianRupee, module: "supplier_payments" },
      { name: "Suppliers", href: "/suppliers", icon: Truck, module: "suppliers" },
    ],
  },
  {
    label: "Insights",
    items: [{ name: "Reports", href: "/reports", icon: BarChart3, module: "reports" }],
  },
  {
    label: "Workspace",
    items: [
      { name: "Users & Roles", href: "/team", icon: UserCog, module: "team" },
      { name: "Integrations", href: "/integrations", icon: Blocks, module: "integrations" },
      { name: "POS Counters", href: "/pos/counters", icon: Boxes, module: "pos" },
      { name: "Approval Workflows", href: "/settings/approval-workflows", icon: GitMerge, module: "settings" },
      { name: "Audit Log", href: "/settings/audit-log", icon: ClipboardList, module: "settings" },
      { name: "Settings", href: "/settings", icon: Settings, module: "settings" },
    ],
  },
];

// Flat set of every href in the sidebar — used by isActivePath to detect when
// a more-specific child item also matches so we don't highlight the parent too.
const ALL_NAV_HREFS: ReadonlySet<string> = new Set([
  ...navSections.flatMap((s) => s.items.map((i) => i.href)),
  ...platformSection.items.map((i) => i.href),
]);

function isActivePath(location: string, href: string): boolean {
  if (href === "/dashboard") return location === "/dashboard";
  if (location === href) return true;
  if (!location.startsWith(href + "/")) return false;
  const moreSpecificExists = [...ALL_NAV_HREFS].some(
    (h) => h !== href && h.startsWith(href + "/") && location.startsWith(h),
  );
  return !moreSpecificExists;
}

const COLLAPSED_SECTIONS_KEY = "mystics.sidebar.collapsedSections";

function loadCollapsedSections(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveCollapsedSections(value: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...value]));
  } catch { /* ignore */ }
}

function useCollapsedSections(location: string) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() =>
    loadCollapsedSections(),
  );

  useEffect(() => {
    saveCollapsedSections(collapsedSections);
  }, [collapsedSections]);

  useEffect(() => {
    setCollapsedSections((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const section of navSections) {
        if (next.has(section.label) && section.items.some((it) => isActivePath(location, it.href))) {
          next.delete(section.label);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [location]);

  const toggleSection = useCallback((label: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  return { collapsedSections, toggleSection };
}

function NavLink({
  item,
  collapsed,
  active,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.name : undefined}
      data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "group relative flex items-center rounded-lg text-sm font-medium",
        "transition-all duration-150 ease-out",
        collapsed
          ? "h-10 w-10 mx-auto justify-center"
          : "gap-3 px-3 py-[7px] w-full",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      )}
    >
      {/* Active left bar */}
      {active && !collapsed && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-sidebar-primary transition-all duration-200"
        />
      )}
      {/* Active dot (collapsed) */}
      {active && collapsed && (
        <span
          aria-hidden
          className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-sidebar-primary"
        />
      )}

      <item.icon
        className={cn(
          "shrink-0 transition-all duration-150",
          collapsed ? "h-[18px] w-[18px]" : "h-[16px] w-[16px]",
          active
            ? "text-sidebar-accent-foreground"
            : "text-sidebar-foreground/45 group-hover:text-sidebar-foreground group-hover:scale-110",
        )}
        strokeWidth={active ? 2.25 : 2}
      />
      {!collapsed && (
        <span className="truncate leading-none">{item.name}</span>
      )}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="font-medium">
        {item.name}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({
  className,
  onNavigate,
  collapsible = true,
}: SidebarProps) {
  const [location] = useLocation();
  const { data: org } = useGetCurrentOrganization();
  const orgAny = org as (typeof org & {
    sidebarLogoUrl?: string | null;
    loginLogoUrl?: string | null;
  }) | undefined;
  const { src: orgLogoSrc } = useImageSrc(orgAny?.sidebarLogoUrl ?? org?.logoUrl);
  const { src: loginLogoSrc } = useImageSrc(orgAny?.loginLogoUrl ?? org?.logoUrl);
  const { data: me } = useGetMe();

  useEffect(() => {
    if (loginLogoSrc) {
      try { localStorage.setItem("__erp_org_logo_src", loginLogoSrc); } catch { /* ignore */ }
    } else if (org && !orgAny?.loginLogoUrl && !org.logoUrl) {
      try { localStorage.removeItem("__erp_org_logo_src"); } catch { /* ignore */ }
    }
  }, [loginLogoSrc, org, orgAny?.loginLogoUrl]);

  const ctx = useOptionalSidebarCollapse();
  const collapsed = collapsible && ctx ? ctx.collapsed : false;
  const toggle = ctx?.toggle;
  const { collapsedSections, toggleSection } = useCollapsedSections(location);

  const { data: perms } = useMyPermissions();
  const isSuperAdmin = me?.user.isSuperAdmin ?? false;
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((it) => {
        if (isSuperAdmin) return true;
        if (!me || !perms) return true;
        if (!it.module) return true;
        return (perms.permissions[it.module]?.length ?? 0) > 0;
      }),
    }))
    .filter((section) => section.items.length > 0);

  const renderSection = (section: NavSection, sectionIdx: number) => {
    const sectionHasActive = section.items.some((it) => isActivePath(location, it.href));
    const sectionOpen = !collapsedSections.has(section.label) || sectionHasActive;

    const items = section.items.map((item) => (
      <NavLink
        key={item.href}
        item={item}
        collapsed={collapsed}
        active={isActivePath(location, item.href)}
        onNavigate={onNavigate}
      />
    ));

    if (collapsed) {
      return (
        <div key={section.label}>
          {sectionIdx > 0 && (
            <div aria-hidden className="mx-3 my-1.5 h-px bg-sidebar-border/50" />
          )}
          <div className="space-y-0.5">{items}</div>
        </div>
      );
    }

    return (
      <Collapsible
        key={section.label}
        open={sectionOpen}
        onOpenChange={() => toggleSection(section.label)}
        className="space-y-0.5"
      >
        <CollapsibleTrigger
          data-testid={`btn-sidebar-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
          className={cn(
            "group flex w-full items-center justify-between rounded-md px-3 py-1 mt-1",
            "text-[10px] font-semibold uppercase tracking-[0.1em]",
            "text-sidebar-foreground/35 hover:text-sidebar-foreground/60",
            "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          )}
          aria-expanded={sectionOpen}
          aria-controls={`sidebar-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <span>{section.label}</span>
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/50",
              "transition-transform duration-200 ease-out",
              sectionOpen && "rotate-90",
            )}
            strokeWidth={2.5}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent
          id={`sidebar-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
          className="space-y-0.5"
        >
          {items}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <TooltipProvider delayDuration={100} disableHoverableContent>
      <div
        className={cn(
          "group/sidebar relative flex h-full flex-col bg-sidebar border-r border-sidebar-border",
          className,
        )}
        data-collapsed={collapsed ? "true" : "false"}
      >
        {/* ── Brand header ─────────────────────────────────────── */}
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-sidebar-border",
            collapsed ? "flex-col justify-center gap-1 px-2 py-2" : "justify-between px-4",
          )}
        >
          <Link
            href="/dashboard"
            onClick={onNavigate}
            className={cn(
              "flex items-center min-w-0",
              collapsed ? "justify-center" : "gap-2.5 flex-1 min-w-0",
            )}
            data-testid="link-logo"
          >
            {orgLogoSrc ? (
              <div className="h-8 w-8 rounded-lg overflow-hidden ring-1 ring-sidebar-border shadow-sm shrink-0">
                <img src={orgLogoSrc} alt={org?.name ?? "Logo"} className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center shadow-sm shrink-0 ring-1 ring-sidebar-primary/20">
                <Boxes className="h-4 w-4 text-sidebar-primary-foreground" strokeWidth={2.5} />
              </div>
            )}
            {!collapsed && (
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-[14px] font-semibold tracking-tight text-sidebar-foreground truncate">
                  {org?.name ?? "MM Wear"}
                </span>
                <span className="text-[8px] font-semibold tracking-[0.04em] uppercase whitespace-nowrap bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
                  ✦ Powered by Automystics
                </span>
              </div>
            )}
          </Link>

          {/* Inline toggle button in header */}
          {collapsible && toggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  data-testid="btn-sidebar-toggle"
                  className={cn(
                    "flex items-center justify-center rounded-md shrink-0",
                    "text-sidebar-foreground/40 hover:text-sidebar-foreground",
                    "hover:bg-sidebar-accent/70 transition-all duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    collapsed
                      ? "h-6 w-6"
                      : "h-7 w-7 ml-1",
                  )}
                >
                  {collapsed
                    ? <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={2} />
                    : <PanelLeftClose className="h-4 w-4" strokeWidth={2} />
                  }
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* ── Floating edge handle (hover affordance) ────────────── */}
        {collapsible && toggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                tabIndex={-1}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 -right-3 z-50",
                  "flex h-6 w-6 items-center justify-center rounded-full",
                  "border border-sidebar-border bg-background shadow-sm",
                  "text-sidebar-foreground/40 hover:text-sidebar-foreground",
                  "hover:bg-sidebar-accent hover:scale-110 hover:shadow-md",
                  "transition-all duration-200 ease-out",
                  "opacity-0 group-hover/sidebar:opacity-100",
                )}
              >
                {collapsed
                  ? <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                  : <ChevronLeft className="h-3 w-3" strokeWidth={2.5} />
                }
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={14}>
              {collapsed ? "Expand" : "Collapse"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* ── Nav ──────────────────────────────────────────────── */}
        <ScrollArea className="flex-1 overflow-hidden">
          <nav
            className={cn(
              "py-3",
              collapsed ? "px-1.5 space-y-0" : "px-2 space-y-0",
            )}
          >
            {visibleSections.map((section, idx) => renderSection(section, idx))}

            {/* Platform admin — super admins only */}
            {me?.user.isSuperAdmin && (() => {
              const section = platformSection;
              const sectionHasActive = section.items.some((it) => isActivePath(location, it.href));
              const sectionOpen = !collapsedSections.has(section.label) || sectionHasActive;
              const items = section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  active={isActivePath(location, item.href)}
                  onNavigate={onNavigate}
                />
              ));

              if (collapsed) {
                return (
                  <div key={section.label}>
                    <div aria-hidden className="mx-3 my-1.5 h-px bg-sidebar-border/50" />
                    <div className="space-y-0.5">{items}</div>
                  </div>
                );
              }

              return (
                <Collapsible
                  key={section.label}
                  open={sectionOpen}
                  onOpenChange={() => toggleSection(section.label)}
                  className="space-y-0.5"
                >
                  <CollapsibleTrigger
                    data-testid={`btn-sidebar-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className="group flex w-full items-center justify-between rounded-md px-3 py-1 mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/35 hover:text-sidebar-foreground/60 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                    aria-expanded={sectionOpen}
                  >
                    <span>{section.label}</span>
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 shrink-0 text-sidebar-foreground/30 transition-transform duration-200 ease-out",
                        sectionOpen && "rotate-90",
                      )}
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-0.5">{items}</CollapsibleContent>
                </Collapsible>
              );
            })()}
          </nav>
        </ScrollArea>

        {/* ── Footer strip ─────────────────────────────────────── */}
        {!collapsed && (
          <div className="shrink-0 border-t border-sidebar-border px-4 py-2.5">
            <p className="text-[10px] text-sidebar-foreground/25 tracking-wide">
              © {new Date().getFullYear()} Automystics
            </p>
          </div>
        )}
        {collapsed && <div className="shrink-0 h-3" />}
      </div>
    </TooltipProvider>
  );
}
