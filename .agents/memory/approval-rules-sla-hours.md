---
name: Approval rules sla_hours migration
description: Why all approval workflow operations 500'd and how it was fixed — applies to any future schema column additions.
---

## The rule
When a new column is added to any DB table in the Drizzle schema but the migration fails (drizzle-kit TTY issue), Drizzle's `db.select()` with no explicit column list will try to SELECT the new column and PostgreSQL returns "column does not exist" → 500 on every query touching that table.

**Why:** Drizzle auto-selects all schema columns. Missing columns aren't caught at startup — they surface at first query time.

**How to apply:** After any schema change, always verify the column exists in the DB with `psql "$DATABASE_URL" -c "\d <table>"`. If the column is missing, apply manually: `psql "$DATABASE_URL" -c "ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> <type>"`. Never rely on drizzle-kit push in the Replit environment (no TTY).

## Incident: approval_rules.sla_hours
- Task #108 added `slaHours: integer("sla_hours")` to `approvalRulesTable` schema
- Migration never ran → `sla_hours` missing in `approval_rules`
- Every operation touching `approvalRulesTable` (GET/POST/PATCH approval-workflows, `getWorkflowRules` called by `submitForApproval` and `validateActorForLevel`) returned 500
- Fix: `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS sla_hours integer`
- Confirmed working: GET 200, PATCH 200 in live logs post-fix
