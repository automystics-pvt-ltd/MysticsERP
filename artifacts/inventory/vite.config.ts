import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Replit's artifact system expects this workflow to open port 18174.
// A separate dev-proxy.mjs bridges port 5000 (external :80) → 18174.
const port = 18174;

// BASE_PATH controls the URL prefix baked into the build. Replit's
// dev workflow injects the artifact's prefix; self-hosted deploys
// usually serve from the root, so default to "/" when unset.
const basePath = process.env.BASE_PATH ?? "/";

// Load .env from the monorepo root rather than artifacts/inventory,
// so a single root-level .env file feeds both the API server (read
// at runtime) and the Vite build (read at compile time, for VITE_*
// variables). Without this, vite would only look in this directory.
const envDir = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  envDir,
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          runtimeErrorOverlay(),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Raise the warning threshold slightly — this app has many large page
    // bundles and the vendor splitting below keeps them well under 1 MB.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // shadcn/ui components are copied files with no resolvable source maps —
        // suppress the noise; the build output is unaffected.
        if (
          warning.code === "SOURCEMAP_ERROR" ||
          (warning.message ?? "").includes(
            "Can't resolve original location of error",
          )
        ) {
          return;
        }
        defaultHandler(warning);
      },
      output: {
        // manualChunks strategy:
        //
        // Rule: only split a library into its own chunk when it has NO
        // React-dependency cycle risk — i.e. it is either pure JS (no React
        // import at all) or its React imports are strictly one-way
        // (it imports React from "vendor"; "vendor" never imports back from it).
        //
        // React, Radix, TanStack, Lucide, and the rest of the React ecosystem
        // all stay in the single "vendor" chunk.  Fine-grained splitting of
        // these packages creates circular initialisation races that cause
        // "Cannot read/set properties of undefined" crashes in production.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // Pure-JS / WebAssembly libs with no React dependency — safe to split
          if (id.includes("@zxing/")) return "vendor-scanner";
          if (id.includes("/xlsx/") || id.includes("node_modules/xlsx")) return "vendor-xlsx";
          if (id.includes("jspdf")) return "vendor-pdf";
          if (id.includes("papaparse")) return "vendor-csv";

          // Heavy libs that import React but have no reverse dep from "vendor"
          // (one-way dep: vendor-charts → vendor, never the other way round)
          if (
            id.includes("recharts") ||
            id.includes("/d3-") ||
            id.includes("d3-shape") ||
            id.includes("victory-vendor")
          )
            return "vendor-charts";

          // Everything else — React, react-dom, Radix, TanStack, Lucide,
          // Clerk, Uppy, wouter, cmdk, vaul, clsx, … — in one stable chunk.
          return "vendor";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
