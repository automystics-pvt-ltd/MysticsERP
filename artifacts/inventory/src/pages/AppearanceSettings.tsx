import { useState, useEffect, useCallback } from "react";
import {
  Palette, Type, Image, Monitor, PanelLeft, Globe, Bell, Shield,
  Users, Building2, ChevronRight, Check, Sun, Moon, Laptop,
  Upload, RotateCcw, Save, ScanLine, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import {
  applyAppearance, loadAppearance, saveAppearance,
  APPEARANCE_DEFAULTS, PRESET_ACCENTS, FONTS,
  type AppearanceSettings,
} from "@/lib/appearance";
import {
  useGetCurrentOrganization,
  useUpdateCurrentOrganization,
  getGetCurrentOrganizationQueryKey,
} from "@/lib/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import { ImageUploader } from "@/components/ImageUploader";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const SIDEBAR_NAV = [
  { icon: Building2, label: "Organization", href: "/settings" },
  { icon: Palette,   label: "Appearance",   href: "/settings/appearance" },
  { icon: Globe,     label: "Localization",  href: null },
  { icon: Bell,      label: "Notifications", href: "/settings/email" },
  { icon: Users,     label: "Team & Roles",  href: "/team" },
  { icon: ScanLine,  label: "Barcode",       href: "/settings/barcode" },
  { icon: Shield,    label: "Security",      href: null },
];

const SIDEBAR_STYLES = [
  {
    id: "dark" as const,
    label: "Dark",
    previewBg: "bg-violet-700",
    previewLine: "bg-white/80",
    previewSub: "bg-white/25",
  },
  {
    id: "light" as const,
    label: "Light",
    previewBg: "bg-white border border-zinc-200",
    previewLine: "bg-zinc-800/80",
    previewSub: "bg-zinc-400/40",
  },
  {
    id: "accent" as const,
    label: "Accent",
    previewBg: "",
    previewLine: "bg-white/90",
    previewSub: "bg-white/40",
  },
];

export default function AppearanceSettings() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const { data: org } = useGetCurrentOrganization();
  const [location] = useLocation();

  const [settings, setSettings] = useState<AppearanceSettings>(() => loadAppearance());
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoDirty, setLogoDirty] = useState(false);

  useEffect(() => {
    if (org?.logoUrl !== undefined) {
      setLogoUrl(org.logoUrl ?? null);
    }
  }, [org?.logoUrl]);

  const updateOrg = useUpdateCurrentOrganization({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCurrentOrganizationQueryKey() });
      },
    },
  });

  const patch = useCallback(<K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      applyAppearance(next);
      return next;
    });
  }, []);

  const handleSave = () => {
    saveAppearance(settings);
    if (logoDirty) {
      updateOrg.mutate({ data: { logoUrl: logoUrl ?? null } });
      setLogoDirty(false);
    }
    toast({ title: "Appearance saved", description: "Your theme preferences have been applied." });
  };

  const handleReset = () => {
    const defaults = { ...APPEARANCE_DEFAULTS };
    setSettings(defaults);
    applyAppearance(defaults);
    setTheme("system");
    saveAppearance(defaults);
    toast({ title: "Reset to defaults" });
  };

  const orgInitial = org?.name?.charAt(0).toUpperCase() ?? "M";
  const primaryHex = settings.primaryAccent;

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 overflow-hidden">

      {/* Settings sub-sidebar */}
      <aside className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col">
        <div className="px-4 h-12 flex items-center border-b border-border">
          <span className="text-sm font-semibold text-foreground">Settings</span>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {SIDEBAR_NAV.map(({ icon: Icon, label, href }) => {
            const isActive = href === location || (href === "/settings/appearance" && location === "/settings/appearance");
            const inner = (
              <div
                className={cn(
                  "flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer select-none",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : href
                    ? "text-muted-foreground hover:text-foreground hover:bg-accent"
                    : "text-muted-foreground/50 cursor-default",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                </div>
                {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-40" />}
              </div>
            );
            return href ? (
              <Link key={label} href={href}>{inner}</Link>
            ) : (
              <div key={label}>{inner}</div>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-2xl px-10 py-8">

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Appearance</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Customize how Mystics looks for your team</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-xs h-8">
                <RotateCcw className="w-3.5 h-3.5" /> Reset defaults
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateOrg.isPending} className="gap-1.5 text-xs h-8">
                <Save className="w-3.5 h-3.5" /> Save changes
              </Button>
            </div>
          </div>

          {/* Logo & Brand */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2 text-foreground">
              <Image className="w-4 h-4 text-muted-foreground" /> Logo & Brand
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Appears in the sidebar and email notifications</p>
            <div className="flex items-start gap-4">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xl font-bold"
                style={{ background: `linear-gradient(135deg, ${primaryHex}cc, ${primaryHex})` }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="w-full h-full object-contain rounded-xl" />
                ) : (
                  orgInitial
                )}
              </div>
              <div className="flex-1 min-w-0">
                <ImageUploader
                  value={logoUrl}
                  onChange={(v) => { setLogoUrl(v ?? null); setLogoDirty(true); }}
                  testId="appearance-logo"
                />
                <p className="text-[11px] text-muted-foreground mt-2">SVG, PNG up to 2 MB. Recommended 64×64px.</p>
              </div>
            </div>
          </section>

          <div className="border-t border-border mb-8" />

          {/* Color Scheme */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2 text-foreground">
              <Palette className="w-4 h-4 text-muted-foreground" /> Color Scheme
            </h2>
            <p className="text-xs text-muted-foreground mb-5">Sets the primary action color across buttons, highlights, and status indicators</p>
            <div className="grid grid-cols-2 gap-6">
              {/* Primary */}
              <div>
                <label className="text-xs text-muted-foreground mb-3 block">Primary accent</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESET_ACCENTS.map(c => (
                    <button
                      key={c}
                      onClick={() => patch("primaryAccent", c)}
                      style={{ backgroundColor: c }}
                      className="w-8 h-8 rounded-lg transition-transform hover:scale-110 relative flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={c}
                    >
                      {settings.primaryAccent === c && (
                        <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2">
                  <div className="w-5 h-5 rounded flex-shrink-0" style={{ backgroundColor: settings.primaryAccent }} />
                  <input
                    type="text"
                    value={settings.primaryAccent}
                    onChange={e => {
                      const v = e.target.value;
                      if (/^#[0-9a-fA-F]{0,6}$/.test(v)) patch("primaryAccent", v);
                    }}
                    className="text-xs font-mono text-muted-foreground bg-transparent border-none outline-none w-full"
                    spellCheck={false}
                  />
                  <input
                    type="color"
                    value={settings.primaryAccent}
                    onChange={e => patch("primaryAccent", e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer opacity-0 absolute"
                    aria-label="Pick primary color"
                  />
                </div>
              </div>

              {/* Secondary */}
              <div>
                <label className="text-xs text-muted-foreground mb-3 block">Secondary / info</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESET_ACCENTS.map(c => (
                    <button
                      key={c}
                      onClick={() => patch("secondaryAccent", c)}
                      style={{ backgroundColor: c }}
                      className="w-8 h-8 rounded-lg transition-transform hover:scale-110 relative flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={c}
                    >
                      {settings.secondaryAccent === c && (
                        <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2">
                  <div className="w-5 h-5 rounded flex-shrink-0" style={{ backgroundColor: settings.secondaryAccent }} />
                  <input
                    type="text"
                    value={settings.secondaryAccent}
                    onChange={e => {
                      const v = e.target.value;
                      if (/^#[0-9a-fA-F]{0,6}$/.test(v)) patch("secondaryAccent", v);
                    }}
                    className="text-xs font-mono text-muted-foreground bg-transparent border-none outline-none w-full"
                    spellCheck={false}
                  />
                  <input
                    type="color"
                    value={settings.secondaryAccent}
                    onChange={e => patch("secondaryAccent", e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer opacity-0 absolute"
                    aria-label="Pick secondary color"
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="border-t border-border mb-8" />

          {/* Theme Mode */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2 text-foreground">
              <Monitor className="w-4 h-4 text-muted-foreground" /> Theme Mode
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Choose a default appearance for all team members (they can override in their profile)
            </p>
            <div className="flex gap-3">
              {([
                { id: "light" as const, icon: Sun, label: "Light" },
                { id: "dark" as const, icon: Moon, label: "Dark" },
                { id: "system" as const, icon: Laptop, label: "System" },
              ]).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-2.5 py-4 rounded-xl border transition-all",
                    theme === id
                      ? "border-primary/60 bg-primary/8 text-foreground"
                      : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border/80",
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{label}</span>
                  {theme === id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </section>

          <div className="border-t border-border mb-8" />

          {/* Typography */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2 text-foreground">
              <Type className="w-4 h-4 text-muted-foreground" /> Typography
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Interface font used across labels, tables, and forms</p>
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map(f => (
                <button
                  key={f}
                  onClick={() => patch("font", f)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all",
                    settings.font === f
                      ? "border-primary/50 bg-primary/8 text-foreground"
                      : "border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:border-border/80",
                  )}
                >
                  <span className="text-xs">{f}</span>
                  {settings.font === f && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                </button>
              ))}
            </div>
          </section>

          <div className="border-t border-border mb-8" />

          {/* Sidebar Style */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2 text-foreground">
              <PanelLeft className="w-4 h-4 text-muted-foreground" /> Sidebar Style
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Controls the sidebar background and active navigation treatment</p>
            <div className="flex gap-3">
              {SIDEBAR_STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => patch("sidebarStyle", s.id)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-2.5 py-3 rounded-xl border transition-all",
                    settings.sidebarStyle === s.id
                      ? "border-primary/60 bg-primary/8 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <div
                    className={cn("w-16 h-10 rounded-md flex items-center", s.previewBg)}
                    style={s.id === "accent" ? { backgroundColor: settings.primaryAccent } : undefined}
                  >
                    <div className="flex flex-col gap-1 px-1.5 w-full">
                      <div className={cn("h-1.5 rounded-full w-10", s.previewLine)} />
                      {[0, 1, 2].map(j => (
                        <div key={j} className={cn("h-1 rounded-full w-7", s.previewSub)} />
                      ))}
                    </div>
                  </div>
                  <span className="text-xs font-medium">{s.label}</span>
                  {settings.sidebarStyle === s.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </section>

          <div className="border-t border-border mb-8" />

          {/* Layout & Density */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-5 flex items-center gap-2 text-foreground">
              <Monitor className="w-4 h-4 text-muted-foreground" /> Layout & Density
            </h2>
            <div className="grid grid-cols-2 gap-8">
              <div>
                <label className="text-xs text-muted-foreground mb-3 block">
                  Border radius — {settings.borderRadius}px
                </label>
                <Slider
                  value={[settings.borderRadius]}
                  onValueChange={([v]) => patch("borderRadius", v)}
                  min={0}
                  max={20}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/50 mt-1.5">
                  <span>Square</span><span>Rounded</span><span>Pill</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-3 block">Table density</label>
                <div className="flex gap-2">
                  {(["compact", "default", "comfortable"] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => patch("tableDensity", d)}
                      className={cn(
                        "flex-1 py-1.5 text-[11px] rounded-lg border capitalize transition-all",
                        settings.tableDensity === d
                          ? "border-primary/50 bg-primary/8 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Preview strip */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 border-b border-border text-xs text-muted-foreground font-medium">
              Preview
            </div>
            <div className="p-4 space-y-3 bg-card">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  style={{
                    backgroundColor: settings.primaryAccent,
                    borderRadius: settings.borderRadius,
                  }}
                  className="px-4 py-2 text-xs text-white font-medium transition-opacity hover:opacity-90"
                >
                  Primary action
                </button>
                <button
                  style={{
                    backgroundColor: `${settings.primaryAccent}18`,
                    borderRadius: settings.borderRadius,
                    color: settings.primaryAccent,
                    border: `1px solid ${settings.primaryAccent}38`,
                  }}
                  className="px-4 py-2 text-xs font-medium"
                >
                  Secondary
                </button>
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{
                    backgroundColor: `${settings.primaryAccent}15`,
                    color: settings.primaryAccent,
                  }}
                >
                  ✓ Paid
                </span>
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{
                    backgroundColor: `${settings.secondaryAccent}15`,
                    color: settings.secondaryAccent,
                  }}
                >
                  Info
                </span>
              </div>
              <div
                className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-muted/30"
                style={{ borderRadius: settings.borderRadius }}
              >
                <span className="text-xs text-muted-foreground">Search items…</span>
                <span className="ml-auto text-[10px] text-muted-foreground/50 border border-border rounded px-1.5 py-0.5">⌘K</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ backgroundColor: settings.primaryAccent, borderRadius: Math.min(settings.borderRadius, 10) }}
                >
                  Aa
                </span>
                <span>Font: <span className="text-foreground font-medium">{settings.font.replace(" (Default)", "")}</span></span>
                <span>·</span>
                <span>Radius: <span className="text-foreground font-medium">{settings.borderRadius}px</span></span>
                <span>·</span>
                <span>Density: <span className="text-foreground font-medium capitalize">{settings.tableDensity}</span></span>
              </div>
            </div>
          </div>

          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}
