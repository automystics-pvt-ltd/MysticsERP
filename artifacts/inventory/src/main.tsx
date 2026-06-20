import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Diagnostic interceptor — runs in capture phase, before Vite's overlay handler.
// On the NEXT "unknown runtime error" crash, the browser console will print
// CRASH_DETAIL with the exact constructor, type, keys, and string rep of the
// thrown value, telling us precisely what was thrown and where.
if (import.meta.env.DEV) {
  const capture = (label: string, value: unknown) => {
    const info = {
      label,
      type: typeof value,
      constructor: value != null ? (value as object)?.constructor?.name : String(value),
      isError: value instanceof Error,
      message: (value as Error | null)?.message,
      stack: (value as Error | null)?.stack?.split("\n").slice(0, 5),
      ownKeys: value != null && typeof value === "object" ? Object.keys(value as object) : [],
      stringified: (() => { try { return JSON.stringify(value); } catch { return "[unserializable]"; } })(),
    };
    console.error("[CRASH_DETAIL]", JSON.stringify(info, null, 2));
  };

  window.addEventListener("error", (e) => {
    if (!(e.error instanceof Error)) capture("window.onerror", e.error ?? e.message);
  }, true);

  window.addEventListener("unhandledrejection", (e) => {
    if (!(e.reason instanceof Error)) capture("unhandledrejection", e.reason);
  }, true);
}

createRoot(document.getElementById("root")!).render(<App />);
