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
