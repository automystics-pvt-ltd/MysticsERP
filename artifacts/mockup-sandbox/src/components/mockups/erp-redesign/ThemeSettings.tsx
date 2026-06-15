import { useState } from "react";
import {
  Palette, Type, Image, Monitor, PanelLeft, Globe, Bell, Shield,
  Users, Building2, ChevronRight, Check, Sun, Moon, Laptop,
  Upload, RotateCcw, Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const SIDEBAR_SECTIONS = [
  { icon: Building2, label: "Organization" },
  { icon: Palette, label: "Appearance", active: true },
  { icon: Globe, label: "Localization" },
  { icon: Bell, label: "Notifications" },
  { icon: Users, label: "Team & Roles" },
  { icon: Shield, label: "Security" },
];

const PRESET_ACCENTS = [
  "#7c3aed", "#2563eb", "#059669", "#d97706",
  "#dc2626", "#db2777", "#0891b2", "#4f46e5",
];

const FONTS = ["Inter (Default)", "Plus Jakarta Sans", "DM Sans", "Geist", "Manrope", "Outfit"];

const SIDEBAR_STYLES = [
  { id: "dark", label: "Dark", preview: "bg-zinc-900" },
  { id: "light", label: "Light", preview: "bg-white border border-zinc-200" },
  { id: "colored", label: "Accent", preview: "bg-violet-700" },
];

export function ThemeSettings() {
  const [accent, setAccent] = useState("#7c3aed");
  const [secondary, setSecondary] = useState("#2563eb");
  const [font, setFont] = useState("Inter (Default)");
  const [mode, setMode] = useState<"light" | "dark" | "system">("dark");
  const [sidebar, setSidebar] = useState("dark");
  const [radius, setRadius] = useState([6]);
  const [density, setDensity] = useState<"compact" | "default" | "comfortable">("default");

  return (
    <div className="flex h-screen bg-[#141414] text-white font-sans overflow-hidden select-none">

      {/* Settings sidebar */}
      <aside className="w-56 flex-shrink-0 bg-[#0c0c0c] border-r border-white/5 flex flex-col">
        <div className="px-4 h-14 flex items-center gap-2 border-b border-white/5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <span className="text-[10px] font-bold">M</span>
          </div>
          <span className="font-semibold text-sm">Settings</span>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {SIDEBAR_SECTIONS.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                active ? "bg-white/8 text-white" : "text-white/40 hover:text-white/70 hover:bg-white/4"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm">{label}</span>
              </div>
              {active && <ChevronRight className="w-3.5 h-3.5 text-white/40" />}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main settings area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl px-10 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold">Appearance</h1>
              <p className="text-sm text-white/40 mt-0.5">Customize how Mystics looks for your team</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white/50 hover:bg-white/8 hover:text-white gap-1.5 text-xs h-8">
                <RotateCcw className="w-3.5 h-3.5" /> Reset defaults
              </Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-500 text-white gap-1.5 text-xs h-8">
                <Save className="w-3.5 h-3.5" /> Save changes
              </Button>
            </div>
          </div>

          {/* Logo */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Image className="w-4 h-4 text-white/40" /> Logo & Brand
            </h2>
            <p className="text-xs text-white/35 mb-4">Appears in the sidebar and email notifications</p>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-bold">M</span>
              </div>
              <div className="flex flex-col gap-2">
                <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white/60 hover:bg-white/8 hover:text-white gap-1.5 text-xs h-8 w-fit">
                  <Upload className="w-3.5 h-3.5" /> Upload logo
                </Button>
                <p className="text-[10px] text-white/25">SVG, PNG up to 1MB. Recommended 64×64px.</p>
              </div>
            </div>
          </section>

          <div className="border-t border-white/5 mb-8" />

          {/* Color scheme */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Palette className="w-4 h-4 text-white/40" /> Color Scheme
            </h2>
            <p className="text-xs text-white/35 mb-5">Sets the primary action color across buttons, highlights, and status indicators</p>

            <div className="grid grid-cols-2 gap-6">
              {/* Primary */}
              <div>
                <label className="text-xs text-white/50 mb-3 block">Primary accent</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESET_ACCENTS.map(c => (
                    <button
                      key={c}
                      onClick={() => setAccent(c)}
                      style={{ backgroundColor: c }}
                      className="w-8 h-8 rounded-lg transition-transform hover:scale-110 relative flex-shrink-0"
                    >
                      {accent === c && <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto" />}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-white/5 border border-white/8 rounded-lg px-3 py-2">
                  <div className="w-5 h-5 rounded" style={{ backgroundColor: accent }} />
                  <span className="text-xs text-white/50 font-mono">{accent}</span>
                </div>
              </div>

              {/* Secondary */}
              <div>
                <label className="text-xs text-white/50 mb-3 block">Secondary / info</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESET_ACCENTS.map(c => (
                    <button
                      key={c}
                      onClick={() => setSecondary(c)}
                      style={{ backgroundColor: c }}
                      className="w-8 h-8 rounded-lg transition-transform hover:scale-110 relative flex-shrink-0"
                    >
                      {secondary === c && <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto" />}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-white/5 border border-white/8 rounded-lg px-3 py-2">
                  <div className="w-5 h-5 rounded" style={{ backgroundColor: secondary }} />
                  <span className="text-xs text-white/50 font-mono">{secondary}</span>
                </div>
              </div>
            </div>
          </section>

          <div className="border-t border-white/5 mb-8" />

          {/* Mode */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-white/40" /> Theme Mode
            </h2>
            <p className="text-xs text-white/35 mb-4">Choose a default appearance for all team members (they can override in their profile)</p>
            <div className="flex gap-3">
              {([
                { id: "light", icon: Sun, label: "Light" },
                { id: "dark", icon: Moon, label: "Dark" },
                { id: "system", icon: Laptop, label: "System" },
              ] as const).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={`flex-1 flex flex-col items-center gap-2.5 py-4 rounded-xl border transition-all ${
                    mode === id
                      ? "border-violet-500/60 bg-violet-500/10 text-white"
                      : "border-white/8 bg-white/3 text-white/40 hover:text-white/60 hover:border-white/15"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{label}</span>
                  {mode === id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                  )}
                </button>
              ))}
            </div>
          </section>

          <div className="border-t border-white/5 mb-8" />

          {/* Typography */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Type className="w-4 h-4 text-white/40" /> Typography
            </h2>
            <p className="text-xs text-white/35 mb-4">Interface font used across labels, tables, and forms</p>
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map(f => (
                <button
                  key={f}
                  onClick={() => setFont(f)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all ${
                    font === f
                      ? "border-violet-500/50 bg-violet-500/8 text-white"
                      : "border-white/6 bg-white/3 text-white/40 hover:text-white/60 hover:border-white/12"
                  }`}
                >
                  <span className="text-xs">{f}</span>
                  {font === f && <Check className="w-3.5 h-3.5 text-violet-400" />}
                </button>
              ))}
            </div>
          </section>

          <div className="border-t border-white/5 mb-8" />

          {/* Sidebar style */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <PanelLeft className="w-4 h-4 text-white/40" /> Sidebar Style
            </h2>
            <p className="text-xs text-white/35 mb-4">Controls sidebar background and active nav item treatment</p>
            <div className="flex gap-3">
              {SIDEBAR_STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSidebar(s.id)}
                  className={`flex-1 flex flex-col items-center gap-2.5 py-3 rounded-xl border transition-all ${
                    sidebar === s.id
                      ? "border-violet-500/60 bg-violet-500/8 text-white"
                      : "border-white/8 text-white/40 hover:text-white/60"
                  }`}
                >
                  {/* Mini sidebar preview */}
                  <div className={`w-16 h-10 rounded-md ${s.preview} flex items-center`}>
                    <div className="flex flex-col gap-1 px-1.5 w-full">
                      <div className={`h-1.5 rounded-full ${s.id === "dark" ? "bg-white/80 w-10" : s.id === "light" ? "bg-zinc-800/80 w-10" : "bg-white/90 w-10"}`} />
                      {[0,1,2].map(j => (
                        <div key={j} className={`h-1 rounded-full w-7 ${s.id === "dark" ? "bg-white/25" : s.id === "light" ? "bg-zinc-400/40" : "bg-white/40"}`} />
                      ))}
                    </div>
                  </div>
                  <span className="text-xs font-medium">{s.label}</span>
                  {sidebar === s.id && <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
                </button>
              ))}
            </div>
          </section>

          <div className="border-t border-white/5 mb-8" />

          {/* Border radius + density */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-5 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-white/40" /> Layout & Density
            </h2>
            <div className="grid grid-cols-2 gap-8">
              <div>
                <label className="text-xs text-white/50 mb-3 block">Border radius — {radius[0]}px</label>
                <Slider
                  value={radius}
                  onValueChange={setRadius}
                  min={0} max={16} step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-white/20 mt-1.5">
                  <span>Square</span><span>Rounded</span><span>Pill</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 mb-3 block">Table density</label>
                <div className="flex gap-2">
                  {(["compact", "default", "comfortable"] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setDensity(d)}
                      className={`flex-1 py-1.5 text-[11px] rounded-lg border capitalize transition-all ${
                        density === d ? "border-violet-500/50 bg-violet-500/10 text-white" : "border-white/8 text-white/35 hover:text-white/55"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Preview strip */}
          <div className="rounded-xl border border-white/8 overflow-hidden">
            <div className="px-4 py-3 bg-white/3 border-b border-white/5 text-xs text-white/40">Preview</div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <button
                  style={{ backgroundColor: accent, borderRadius: radius[0] }}
                  className="px-4 py-2 text-xs text-white font-medium"
                >
                  Primary action
                </button>
                <button
                  style={{ backgroundColor: `${accent}20`, borderRadius: radius[0], color: accent, border: `1px solid ${accent}40` }}
                  className="px-4 py-2 text-xs font-medium"
                >
                  Secondary
                </button>
                <span className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: `${accent}15`, color: accent }}>
                  ✓ Paid
                </span>
              </div>
              <div className="flex items-center gap-2 border border-white/8 rounded-lg px-3 py-2 bg-white/3">
                <span className="text-xs text-white/30">Search items…</span>
                <span className="ml-auto text-[10px] text-white/15 border border-white/10 rounded px-1.5">⌘K</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
