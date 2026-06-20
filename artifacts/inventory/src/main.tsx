import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// "ResizeObserver loop completed with undelivered notifications." is a browser-
// native string thrown via window.onerror (not a real Error object). Vite's
// overlay catches any non-Error onerror value and shows a fatal crash screen —
// this intercept runs in capture phase (before Vite) and swallows only this
// harmless browser quirk, preventing the false-positive overlay.
window.addEventListener(
  "error",
  (e) => {
    if (
      typeof e.message === "string" &&
      e.message.includes("ResizeObserver loop")
    ) {
      e.stopImmediatePropagation();
    }
  },
  true,
);

createRoot(document.getElementById("root")!).render(<App />);
