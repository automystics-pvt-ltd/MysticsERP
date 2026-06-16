import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import compression from "compression";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildSessionMiddleware } from "./lib/sessions";

const app: Express = express();

// We always sit behind a TLS-terminating proxy in production (autoscale /
// Replit preview proxy in dev). Trust the first hop so express-session honours
// `secure` cookies and req.ip reflects the real client.
app.set("trust proxy", 1);

// Gzip/deflate all responses.  Must come before any response-generating
// middleware so the compressed stream is started before data is written.
app.use(compression());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(buildSessionMiddleware());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Return a proper JSON 404 for any /api route that didn't match a handler
// above. Without this, unmatched /api/* requests would fall through to the SPA
// fallback and return index.html with HTTP 200, which confuses API clients.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------------------
// Serve the built frontend SPA when the dist folder exists (production).
// In development Vite runs on its own port; the dist folder won't exist.
// ---------------------------------------------------------------------------
const FRONTEND_DIST = path.resolve(
  // import.meta.dirname is the compiled dist/ folder in production
  // (artifacts/api-server/dist/). Two levels up → artifacts/inventory/dist/public.
  typeof import.meta.dirname !== "undefined"
    ? import.meta.dirname
    : path.dirname(new URL(import.meta.url).pathname),
  "../../inventory/dist/public",
);

if (existsSync(path.join(FRONTEND_DIST, "index.html"))) {
  // Static assets produced by Vite have content-addressed names (e.g.
  // app-BT0K1u9q.js).  Cache them aggressively; a new deploy always produces
  // new filenames so users are never stuck on stale assets.
  app.use(
    express.static(FRONTEND_DIST, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("/index.html")) {
          // index.html must never be cached — it's the entry point that
          // references the versioned asset filenames.
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (
          filePath.includes("/assets/") ||
          /\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|ico|webp)$/.test(filePath)
        ) {
          // Hashed / content-addressed files — safe to cache for 1 year.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          // Everything else (e.g. favicon.ico at root): cache for 10 minutes.
          res.setHeader("Cache-Control", "public, max-age=600");
        }
      },
    }),
  );

  // SPA fallback: any request that isn't /api/* and wasn't served as a static
  // file gets index.html so client-side routing (wouter) handles it.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(FRONTEND_DIST, "index.html"), { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } }, (err) => {
      if (err) next(err);
    });
  });
}

// JSON error handler for the API.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ?? 500;
  const message = (err as { message?: string })?.message ?? "Internal Server Error";
  if (status >= 500) {
    req.log?.error({ err }, "Unhandled error");
  }
  res.status(status).json({ error: message });
});

export default app;
