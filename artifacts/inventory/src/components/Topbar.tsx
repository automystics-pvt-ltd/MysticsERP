import { Bell, Menu, Search, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserMenu } from "./UserMenu";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { useCommandPalette } from "./CommandPalette";
import { useEffect, useState } from "react";
import { useGetMe } from "@/lib/queryKeys";
import { setActiveOrgId } from "@/lib/orgContext";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

function useCommandShortcutLabel() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent.toLowerCase();
      setIsMac(/mac|iphone|ipad|ipod/.test(ua));
    }
  }, []);
  return isMac ? "⌘K" : "Ctrl K";
}

// Map route prefixes → human-readable page titles shown in the mobile topbar
const PAGE_LABELS: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/approvals", "Pending Approvals"],
  ["/items", "Items"],
  ["/barcodes", "Barcodes"],
  ["/warehouses", "Warehouses"],
  ["/write-offs", "Write-offs"],
  ["/pos", "Point of Sale"],
  ["/sales-orders", "Sales Orders"],
  ["/payments", "Payments"],
  ["/customers", "Customers"],
  ["/purchase-orders", "Purchase Orders"],
  ["/job-work", "Job Work"],
  ["/supplier-payments", "Supplier Payments"],
  ["/suppliers", "Suppliers"],
  ["/reports", "Reports"],
  ["/team", "Team"],
  ["/integrations", "Integrations"],
  ["/settings", "Settings"],
  ["/admin", "Admin"],
  ["/transfers", "Stock Transfers"],
  ["/stock", "Stock Movements"],
  ["/subscriptions", "Subscription"],
];

function usePageTitle(): string {
  const [location] = useLocation();
  for (const [prefix, label] of PAGE_LABELS) {
    if (location === prefix || location.startsWith(prefix + "/") || location.startsWith(prefix + "?")) {
      return label;
    }
  }
  return "Mystics";
}

interface Notification {
  id: number;
  type: string;
  message: string;
  requestId: number | null;
  isRead: boolean;
  createdAt: string;
}

const TYPE_DOT_COLORS: Record<string, string> = {
  new_request: "bg-blue-500",
  approved: "bg-green-500",
  rejected: "bg-red-500",
  sent_back: "bg-amber-500",
  overdue: "bg-rose-600",
};

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data } = useQuery<{ notifications: Notification[]; unreadCount: number }>({
    queryKey: ["approval-notifications"],
    queryFn: () => customFetch("/api/approval-notifications?limit=15"),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      customFetch("/api/approval-notifications/mark-read", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-notifications"] });
    },
  });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  const handleOpen = (val: boolean) => {
    setOpen(val);
    if (val && unreadCount > 0) {
      markAllRead.mutate();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          data-testid="btn-notification-bell"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none pointer-events-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {notifications.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground px-2"
              onClick={() => markAllRead.mutate()}
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[20rem] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.map((n) => {
              const dotCls = TYPE_DOT_COLORS[n.type] ?? "bg-muted-foreground";
              return (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border-b last:border-0",
                    !n.isRead && "bg-blue-50/40 dark:bg-blue-950/20",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dotCls)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground leading-snug">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Topbar() {
  const [open, setOpen] = useState(false);
  const { openPalette } = useCommandPalette();
  const shortcut = useCommandShortcutLabel();
  const { data: me } = useGetMe();
  const isViewingAs = me?.role === "super_admin";
  const pageTitle = usePageTitle();

  const exitViewAs = () => {
    setActiveOrgId(null);
    queryClient.clear();
    if (typeof window !== "undefined") window.location.reload();
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/98 backdrop-blur-xl px-4 sm:px-6 lg:px-8 shadow-[0_1px_3px_0_rgba(0,0,0,0.04)]">
      {/* Mobile hamburger */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden h-9 w-9"
            data-testid="btn-mobile-menu"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-[280px] border-r border-sidebar-border">
          <Sidebar onNavigate={() => setOpen(false)} collapsible={false} />
        </SheetContent>
      </Sheet>

      {/* Mobile: current page title */}
      <span className="md:hidden font-semibold text-sm text-foreground truncate mr-auto">
        {pageTitle}
      </span>

      {/* Super-admin "view as" indicator */}
      {isViewingAs && me?.organization ? (
        <div
          className="hidden md:inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-3 h-8 text-xs font-medium text-amber-900 dark:text-amber-200"
          data-testid="badge-viewing-as"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>
            Viewing as{" "}
            <span className="font-semibold">{me.organization.name}</span>
          </span>
          <button
            type="button"
            onClick={exitViewAs}
            aria-label="Exit super-admin view"
            className="ml-1 rounded p-0.5 hover:bg-amber-200/50 dark:hover:bg-amber-500/20"
            data-testid="btn-exit-view-as"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Right-aligned cluster: search trigger, bell, theme toggle, avatar */}
      <div className="hidden md:flex ml-auto items-center gap-2 shrink-0">
        <div className="w-72 lg:w-[30rem]">
          <button
            type="button"
            onClick={openPalette}
            onFocus={openPalette}
            aria-label="Open command palette"
            data-testid="btn-open-command-palette"
            className="group flex w-full items-center h-9 rounded-lg border border-border bg-muted/50 pl-9 pr-3 text-left text-sm text-muted-foreground/80 hover:bg-background hover:border-ring/30 hover:text-muted-foreground transition-all duration-150 relative focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground/60 pointer-events-none group-hover:text-muted-foreground transition-colors" />
            <span className="truncate">Search items, orders, customers...</span>
            <kbd className="ml-auto hidden lg:inline-flex pointer-events-none h-5 select-none items-center gap-1 rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground/70">
              {shortcut}
            </kbd>
          </button>
        </div>
        <NotificationBell />
        <ThemeToggle />
        <UserMenu />
      </div>

      {/* Mobile: compact right side */}
      <div className="md:hidden flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={openPalette}
          aria-label="Open command palette"
          data-testid="btn-open-command-palette-mobile"
          className="h-9 w-9"
        >
          <Search className="h-4 w-4" />
        </Button>
        <NotificationBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
