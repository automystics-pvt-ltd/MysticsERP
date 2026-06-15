import { useState, useEffect, type ReactNode } from "react";
import { Boxes } from "lucide-react";

function useCachedOrgLogo(): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    try { return localStorage.getItem("__erp_org_logo_src"); } catch { return null; }
  });

  useEffect(() => {
    const stored = (() => {
      try { return localStorage.getItem("__erp_org_logo_src"); } catch { return null; }
    })();
    setSrc(stored);
  }, []);

  return src;
}

export function AuthShell({
  children,
  rightFooter,
}: {
  children: ReactNode;
  rightFooter?: ReactNode;
}) {
  const cachedLogo = useCachedOrgLogo();
  const [logoError, setLogoError] = useState(false);
  const showLogo = cachedLogo && !logoError;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#ece9f7] dark:bg-background px-4 py-10">
      <div className="w-full max-w-[360px] flex flex-col gap-3">
        {/* Main card */}
        <div className="bg-white dark:bg-card border border-[#e5e7eb] dark:border-border rounded-xl px-10 pt-10 pb-8 flex flex-col items-center shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/[0.06]">
          {/* Brand */}
          <div className="flex flex-col items-center mb-8 select-none">
            <div className="h-14 w-14 rounded-2xl shadow-md mb-3 overflow-hidden flex items-center justify-center bg-gradient-to-br from-[hsl(263_75%_52%)] to-[hsl(263_80%_35%)]">
              {showLogo ? (
                <img
                  src={cachedLogo}
                  alt="Logo"
                  className="h-full w-full object-cover"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <Boxes className="h-14 w-14 text-white scale-[1.35]" strokeWidth={1.75} />
              )}
            </div>
            <span
              className="text-[26px] font-bold tracking-tight text-foreground"
              style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
            >
              MM Wear
            </span>
            <span className="text-[9px] font-semibold tracking-[0.08em] uppercase bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent mt-1">
              ✦ Powered by Automystics
            </span>
          </div>

          {/* Form / content */}
          {children}
        </div>

        {/* Footer card */}
        {rightFooter && (
          <div className="bg-white dark:bg-card border border-[#e5e7eb] dark:border-border rounded-xl px-10 py-4 text-center text-[14px] text-foreground shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/[0.06]">
            {rightFooter}
          </div>
        )}

        {/* Bottom copyright */}
        <p className="text-center text-[12px] text-muted-foreground mt-2">
          © {new Date().getFullYear()} MM Wear ERP · Made in India
        </p>
      </div>
    </div>
  );
}
