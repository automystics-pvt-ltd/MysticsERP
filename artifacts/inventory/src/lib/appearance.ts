export interface AppearanceSettings {
  primaryAccent: string;
  secondaryAccent: string;
  font: string;
  sidebarStyle: "dark" | "light" | "accent";
  borderRadius: number;
  tableDensity: "compact" | "default" | "comfortable";
}

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  primaryAccent: "#7c3aed",
  secondaryAccent: "#2563eb",
  font: "Inter (Default)",
  sidebarStyle: "dark",
  borderRadius: 12,
  tableDensity: "default",
};

export const PRESET_ACCENTS = [
  "#7c3aed", "#2563eb", "#059669", "#d97706",
  "#dc2626", "#db2777", "#0891b2", "#4f46e5",
];

export const FONTS = [
  "Inter (Default)",
  "Plus Jakarta Sans",
  "DM Sans",
  "Geist",
  "Manrope",
  "Outfit",
];

const FONT_FAMILIES: Record<string, string> = {
  "Inter (Default)": "'Inter', ui-sans-serif, system-ui, sans-serif",
  "Plus Jakarta Sans": "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
  "DM Sans": "'DM Sans', ui-sans-serif, system-ui, sans-serif",
  "Geist": "'Geist', ui-sans-serif, system-ui, sans-serif",
  "Manrope": "'Manrope', ui-sans-serif, system-ui, sans-serif",
  "Outfit": "'Outfit', ui-sans-serif, system-ui, sans-serif",
};

const FONT_GOOGLE_URLS: Record<string, string> = {
  "Plus Jakarta Sans": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap",
  "DM Sans": "https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap",
  "Geist": "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap",
  "Manrope": "https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&display=swap",
  "Outfit": "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap",
};

const STORAGE_KEY = "mystics-appearance";

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hsl(h: number, s: number, l: number) {
  return `${h} ${s}% ${l}%`;
}

function loadGoogleFont(font: string) {
  const url = FONT_GOOGLE_URLS[font];
  if (!url || document.querySelector(`link[data-font="${CSS.escape(font)}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.font = font;
  document.head.appendChild(link);
}

export function applyAppearance(settings: Partial<AppearanceSettings>) {
  if (typeof document === "undefined") return;
  const s: AppearanceSettings = { ...APPEARANCE_DEFAULTS, ...settings };
  const root = document.documentElement;

  const primary = hexToHsl(s.primaryAccent);
  if (primary) {
    root.style.setProperty("--primary", hsl(primary.h, primary.s, primary.l));
    root.style.setProperty("--ring", hsl(primary.h, primary.s, primary.l));
    root.style.setProperty("--accent", hsl(primary.h, Math.max(primary.s - 10, 0), Math.min(primary.l + 46, 97)));
    root.style.setProperty("--accent-foreground", hsl(primary.h, primary.s, Math.max(primary.l - 12, 20)));
  }

  const secondary = hexToHsl(s.secondaryAccent);
  if (secondary) {
    root.style.setProperty("--chart-2", hsl(secondary.h, secondary.s, secondary.l));
  }

  if (s.sidebarStyle === "dark") {
    root.style.removeProperty("--sidebar");
    root.style.removeProperty("--sidebar-foreground");
    root.style.removeProperty("--sidebar-border");
    root.style.removeProperty("--sidebar-accent");
    root.style.removeProperty("--sidebar-accent-foreground");
    root.style.removeProperty("--sidebar-primary");
    root.style.removeProperty("--sidebar-primary-foreground");
  } else if (s.sidebarStyle === "light") {
    root.style.setProperty("--sidebar", "0 0% 100%");
    root.style.setProperty("--sidebar-foreground", "252 45% 14%");
    root.style.setProperty("--sidebar-border", "252 20% 88%");
    root.style.setProperty("--sidebar-accent", "252 25% 93%");
    root.style.setProperty("--sidebar-accent-foreground", "252 45% 12%");
    root.style.setProperty("--sidebar-primary", "263 70% 50%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 100%");
  } else if (s.sidebarStyle === "accent" && primary) {
    root.style.setProperty("--sidebar", hsl(primary.h, primary.s, primary.l));
    root.style.setProperty("--sidebar-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-border", hsl(primary.h, primary.s, Math.max(primary.l - 6, 5)));
    root.style.setProperty("--sidebar-accent", hsl(primary.h, primary.s, Math.min(primary.l + 9, 85)));
    root.style.setProperty("--sidebar-accent-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-primary", "38 95% 62%");
    root.style.setProperty("--sidebar-primary-foreground", "252 45% 12%");
  }

  loadGoogleFont(s.font);
  root.style.setProperty("--app-font-sans", FONT_FAMILIES[s.font] ?? FONT_FAMILIES["Inter (Default)"]);

  root.style.setProperty("--radius", `${(s.borderRadius / 16).toFixed(4)}rem`);

  root.classList.remove("density-compact", "density-default", "density-comfortable");
  root.classList.add(`density-${s.tableDensity}`);
}

export function loadAppearance(): AppearanceSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...APPEARANCE_DEFAULTS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return { ...APPEARANCE_DEFAULTS };
}

export function saveAppearance(settings: AppearanceSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function initAppearance() {
  const settings = loadAppearance();
  applyAppearance(settings);
  return settings;
}
