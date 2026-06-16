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
        // Split large vendor libraries into stable, cacheable chunks so that a
        // deploy that only changes application code doesn't bust the browser
        // cache for react/tanstack-query/recharts/etc.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // Clerk — auth SDK is large and changes rarely
          if (id.includes("@clerk/")) return "vendor-clerk";

          // Charting — recharts + d3 helpers are heavy
          if (
            id.includes("recharts") ||
            id.includes("/d3-") ||
            id.includes("d3-shape") ||
            id.includes("victory-vendor")
          )
            return "vendor-charts";

          // TanStack — query, table, virtual
          if (id.includes("@tanstack/")) return "vendor-query";

          // Radix UI primitives (used by shadcn/ui)
          if (id.includes("@radix-ui/")) return "vendor-radix";

          // React + react-dom — smallest possible core chunk
          if (
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.match(/node_modules\/react[^-]/)
          )
            return "vendor-react";

          // Lucide icons — large icon set
          if (id.includes("lucide-react")) return "vendor-icons";

          // Heavy on-demand libs — split so they're only downloaded when
          // the user first visits a page / opens a dialog that needs them.
          // @zxing: barcode scanner (WebAssembly, ~600 KB)
          if (id.includes("@zxing/")) return "vendor-scanner";
          // xlsx: spreadsheet import/export (~800 KB)
          if (id.includes("/xlsx/") || id.includes("node_modules/xlsx")) return "vendor-xlsx";
          // jspdf + jspdf-autotable: PDF export (~300 KB)
          if (id.includes("jspdf")) return "vendor-pdf";
          // Uppy: file-upload suite (dashboard + S3 + core, ~400 KB)
          if (id.includes("@uppy/") || id.includes("/uppy/")) return "vendor-uppy";
          // papaparse: CSV parsing (~50 KB — small, but keeps vendor clean)
          if (id.includes("papaparse")) return "vendor-csv";

          // Everything else in node_modules (wouter, clsx, cmdk, vaul, …)
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
