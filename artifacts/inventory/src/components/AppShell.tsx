import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { RequireSignedIn } from "./RequireSignedIn";
import { CommandPaletteProvider } from "./CommandPalette";
import { SidebarProvider, useSidebarCollapse } from "./SidebarContext";
import { NavigationProgress } from "./NavigationProgress";

interface AppShellProps {
  children: ReactNode;
}

function AnimatedPage({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div
      key={location}
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ease-out"
    >
      {children}
    </div>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebarCollapse();
  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside
        className={cn(
          "hidden md:flex md:flex-col md:fixed md:inset-y-0 z-40 transition-[width] duration-200 ease-out",
          collapsed ? "md:w-[68px]" : "md:w-[260px]",
        )}
      >
        <Sidebar />
      </aside>
      <div
        className={cn(
          "flex flex-col flex-1 min-w-0 transition-[padding] duration-200 ease-out",
          collapsed ? "md:pl-[68px]" : "md:pl-[260px]",
        )}
      >
        <NavigationProgress />
        <Topbar />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-8">
          <div className="mx-auto w-full max-w-[1600px]">
            <AnimatedPage>{children}</AnimatedPage>
          </div>
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <RequireSignedIn>
      <CommandPaletteProvider>
        <SidebarProvider>
          <ShellLayout>{children}</ShellLayout>
        </SidebarProvider>
      </CommandPaletteProvider>
    </RequireSignedIn>
  );
}
