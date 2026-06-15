---
name: Test bootstrap idempotency
description: Why the per-worker test DB reset uses a two-path approach and must never use DROP DATABASE alone.
---

## Rule
`test/helpers/inMemoryDb.ts` bootstrap uses a two-path DB reset:
1. Try `terminate connections → DROP DATABASE → CREATE DATABASE` (fully fresh DB).
2. If DROP DATABASE fails, fall back to `DROP SCHEMA public CASCADE → CREATE SCHEMA public` (schema-level reset).
`result.apply()` from drizzle-kit's `pushSchema` is used (not a manual statement loop).

**Why:**
`DROP DATABASE` requires no active connections. The pg.Pool from any previous test run can reconnect between the `pg_terminate_backend` sweep and the actual drop, causing DROP to fail silently (no error from `IF EXISTS`) — leaving the old schema in place. `pushSchema` then diffs against the stale DB and generates ALTER/ADD CONSTRAINT statements that fail on already-existing objects, rejecting every worker's `__invTestBootstrap` promise and failing all tests in those workers.

The schema-level reset (`DROP SCHEMA CASCADE`) acquires per-object DDL locks and succeeds even with open pool connections, making it safe as a fallback.

**How to apply:**
- Never change `result.apply()` to a manual `for (stmt of statementsToExecute)` loop with error swallowing — that breaks FK ordering guarantees and causes "relation does not exist" errors.
- The `if (!droppedAndRecreated)` guard ensures schema reset only runs when step 1 failed; in the clean-DB path it's unnecessary (fresh DB has a default empty public schema).
- `adminUrl` (pointing to the `postgres` admin DB) is needed for both the DB existence check and the CREATE DATABASE call — do not remove it.
