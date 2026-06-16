import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Each autoscale replica is a single Node process. 20 connections give
  // ample headroom for concurrent requests without exhausting Postgres's
  // connection limit (Replit managed Postgres allows ~100).
  max: 20,
  // Release idle connections after 30 s to avoid holding open sockets that
  // the Postgres server may already have discarded.
  idleTimeoutMillis: 30_000,
  // Fail fast when all 20 slots are busy — the caller gets a 500 instead
  // of hanging indefinitely and stacking up more work.
  connectionTimeoutMillis: 5_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
