import { Router } from "express";
import { z } from "zod/v4";
import { tenantMiddleware } from "../lib/tenant";
import {
  MODULES,
  ACTIONS,
  MODULE_LABELS,
  ACTION_LABELS,
  MODULE_GROUPS,
  MODULE_APPLICABLE_ACTIONS,
  DEFAULT_PERMISSIONS,
  resolvePermissions,
  invalidatePermissionsCache,
  normalizeRole,
  ROLE_VALUES,
  type Module,
  type Action,
  type PermissionKey,
} from "../lib/permissions";
import { db, orgRolePermissionsTable, auditLogsTable, usersTable, permissionChangeLogTable } from "@workspace/db";
import { and, eq, desc, sql, gte, lte, ilike, or } from "drizzle-orm";
import { writeAuditLog, getClientIp } from "../lib/audit";

const router = Router();
router.use(tenantMiddleware);

// ─── GET /permissions/me ────────────────────────────────────────────────────
// Returns the current user's resolved permissions as a module→action[] map.
router.get("/permissions/me", async (req, res) => {
  const tenant = req.tenant!;
  const role = normalizeRole(tenant.role);
  const permSet = tenant.isSuperAdmin
    ? new Set<PermissionKey>(
        MODULES.flatMap((m) => ACTIONS.map((a) => `${m}.${a}` as PermissionKey)),
      )
    : tenant.permissions;

  const result: Record<string, string[]> = {};
  for (const mod of MODULES) {
    const actions: string[] = [];
    for (const act of ACTIONS) {
      if (permSet.has(`${mod}.${act}`)) actions.push(act);
    }
    if (actions.length > 0) result[mod] = actions;
  }

  res.json({
    role,
    isSuperAdmin: tenant.isSuperAdmin,
    permissions: result,
    modules: MODULES.reduce(
      (acc, m) => {
        acc[m] = MODULE_LABELS[m];
        return acc;
      },
      {} as Record<string, string>,
    ),
    actions: ACTIONS.reduce(
      (acc, a) => {
        acc[a] = ACTION_LABELS[a];
        return acc;
      },
      {} as Record<string, string>,
    ),
    // Drives Roles & Permissions UI layout — auto-includes future modules in "Other"
    moduleGroups: MODULE_GROUPS.map((g) => ({ label: g.label, modules: [...g.modules] })),
    // Drives per-module action toggles — only shows relevant actions per module
    moduleActions: MODULES.reduce(
      (acc, m) => {
        acc[m] = [...MODULE_APPLICABLE_ACTIONS[m]];
        return acc;
      },
      {} as Record<string, string[]>,
    ),
  });
});

// ─── GET /role-permissions ──────────────────────────────────────────────────
// Returns the full permission matrix for this org (defaults + overrides).
router.get("/role-permissions", async (req, res) => {
  const tenant = req.tenant!;

  if (!tenant.isSuperAdmin && !tenant.can("roles", "view")) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const orgId = tenant.organizationId;

  // Load all overrides for this org
  const overrides = await db
    .select()
    .from(orgRolePermissionsTable)
    // org-scope-allow: loading all role overrides for this org's permission matrix
    .where(eq(orgRolePermissionsTable.organizationId, orgId));

  // Build a map of overrides: role:module.action -> granted
  const overrideMap = new Map<string, boolean>();
  for (const row of overrides) {
    overrideMap.set(`${row.role}:${row.module}.${row.action}`, row.granted);
  }

  // Build the full matrix: for each role, for each module+action, state = default | granted | denied
  const matrix: Record<
    string,
    Record<string, Record<string, { granted: boolean; isOverride: boolean }>>
  > = {};

  for (const role of ROLE_VALUES) {
    matrix[role] = {};
    const defaultPerms = DEFAULT_PERMISSIONS[role];
    for (const mod of MODULES) {
      matrix[role][mod] = {};
      for (const action of ACTIONS) {
        const key = `${mod}.${action}` as PermissionKey;
        const overrideKey = `${role}:${key}`;
        const hasOverride = overrideMap.has(overrideKey);
        const granted = hasOverride
          ? (overrideMap.get(overrideKey) ?? false)
          : defaultPerms.has(key);
        matrix[role][mod][action] = { granted, isOverride: hasOverride };
      }
    }
  }

  res.json({
    modules: MODULES,
    actions: ACTIONS,
    moduleLabels: MODULE_LABELS,
    actionLabels: ACTION_LABELS,
    // Server-driven group layout — frontend renders these directly; new modules
    // added to MODULE_GROUPS here will auto-appear in the UI with no frontend changes.
    moduleGroups: MODULE_GROUPS.map((g) => ({ label: g.label, modules: [...g.modules] })),
    // Per-module applicable actions — only semantically relevant toggles are shown.
    moduleActions: MODULES.reduce(
      (acc, m) => {
        acc[m] = [...MODULE_APPLICABLE_ACTIONS[m]];
        return acc;
      },
      {} as Record<string, string[]>,
    ),
    roles: ROLE_VALUES,
    matrix,
  });
});

// ─── PUT /role-permissions ──────────────────────────────────────────────────
// Batch upsert role permission overrides for this org.
const PutSchema = z.object({
  overrides: z.array(
    z.object({
      role: z.enum(ROLE_VALUES),
      module: z.string(),
      action: z.string(),
      granted: z.boolean(),
      isDefault: z.boolean().optional(),
    }),
  ),
});

router.put("/role-permissions", async (req, res) => {
  const tenant = req.tenant!;

  if (!tenant.isSuperAdmin && !tenant.can("roles", "settings")) {
    res.status(403).json({ error: "Only owners and admins can manage role permissions" });
    return;
  }

  const parsed = PutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { overrides } = parsed.data;
  const orgId = tenant.organizationId;

  // Fetch existing overrides so we can record oldGranted in the change log.
  const existingOverrides = await db
    .select({
      role: orgRolePermissionsTable.role,
      module: orgRolePermissionsTable.module,
      action: orgRolePermissionsTable.action,
      granted: orgRolePermissionsTable.granted,
    })
    .from(orgRolePermissionsTable)
    .where(eq(orgRolePermissionsTable.organizationId, orgId));

  const overrideMap = new Map(
    existingOverrides.map((o) => [`${o.role}:${o.module}.${o.action}`, o.granted]),
  );

  for (const o of overrides) {
    if (o.isDefault) {
      // Remove override (revert to default)
      await db
        .delete(orgRolePermissionsTable)
        .where(
          and(
            eq(orgRolePermissionsTable.organizationId, orgId),
            eq(orgRolePermissionsTable.role, o.role),
            eq(orgRolePermissionsTable.module, o.module),
            eq(orgRolePermissionsTable.action, o.action),
          ),
        );
    } else {
      await db
        .insert(orgRolePermissionsTable)
        .values({
          organizationId: orgId,
          role: o.role,
          module: o.module,
          action: o.action,
          granted: o.granted,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            orgRolePermissionsTable.organizationId,
            orgRolePermissionsTable.role,
            orgRolePermissionsTable.module,
            orgRolePermissionsTable.action,
          ],
          set: { granted: o.granted, updatedAt: new Date() },
        });
    }
  }

  // Write per-change rows to the dedicated permission change log.
  if (overrides.length > 0) {
    await db.insert(permissionChangeLogTable).values(
      overrides.map((o) => {
        const key = `${o.role}:${o.module}.${o.action}`;
        const oldGranted = overrideMap.has(key) ? overrideMap.get(key)! : null;
        const newGranted = o.isDefault ? null : o.granted;
        return {
          organizationId: orgId,
          actorId: tenant.userId,
          role: o.role,
          module: o.module,
          action: o.action,
          oldGranted,
          newGranted,
          isReset: false,
        };
      }),
    );
  }

  // Invalidate cache for this org immediately so all in-flight
  // requests pick up the new permissions within the same second.
  invalidatePermissionsCache(orgId);

  await writeAuditLog({
    organizationId: orgId,
    userId: tenant.userId,
    module: "roles",
    action: "settings",
    description: `Updated ${overrides.length} role permission override(s)`,
    changes: {
      overrides: overrides.map((o) => ({
        role: o.role,
        module: o.module,
        action: o.action,
        granted: o.granted,
        reverted: o.isDefault ?? false,
      })),
    },
    ipAddress: getClientIp(req),
  });

  res.set("X-Permissions-Updated", "1");
  res.json({ success: true });
});

// ─── DELETE /role-permissions/reset ─────────────────────────────────────────
// Resets all org overrides back to defaults.
router.delete("/role-permissions/reset", async (req, res) => {
  const tenant = req.tenant!;

  if (!tenant.isSuperAdmin && !tenant.can("roles", "settings")) {
    res.status(403).json({ error: "Only owners and admins can reset role permissions" });
    return;
  }

  const orgId = tenant.organizationId;
  await db
    .delete(orgRolePermissionsTable)
    .where(eq(orgRolePermissionsTable.organizationId, orgId));

  // Record the bulk reset in the dedicated change log.
  await db.insert(permissionChangeLogTable).values({
    organizationId: orgId,
    actorId: tenant.userId,
    role: "*",
    module: "*",
    action: "*",
    oldGranted: null,
    newGranted: null,
    isReset: true,
  });

  invalidatePermissionsCache(orgId);

  await writeAuditLog({
    organizationId: orgId,
    userId: tenant.userId,
    module: "roles",
    action: "settings",
    description: "Reset all role permissions to defaults",
    ipAddress: getClientIp(req),
  });

  res.set("X-Permissions-Updated", "1");
  res.json({ success: true });
});

// ─── GET /role-permissions/audit-log ────────────────────────────────────────
// Returns per-change rows from the dedicated permission_change_log table.
router.get("/role-permissions/audit-log", async (req, res) => {
  const tenant = req.tenant!;

  if (!tenant.isSuperAdmin && !tenant.can("roles", "settings")) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const cond = eq(permissionChangeLogTable.organizationId, tenant.organizationId);

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: permissionChangeLogTable.id,
        actorId: permissionChangeLogTable.actorId,
        role: permissionChangeLogTable.role,
        module: permissionChangeLogTable.module,
        action: permissionChangeLogTable.action,
        oldGranted: permissionChangeLogTable.oldGranted,
        newGranted: permissionChangeLogTable.newGranted,
        isReset: permissionChangeLogTable.isReset,
        createdAt: permissionChangeLogTable.createdAt,
        actorName: usersTable.name,
        actorEmail: usersTable.email,
      })
      .from(permissionChangeLogTable)
      // org-scope-allow: scoped to organizationId via cond
      .leftJoin(usersTable, eq(usersTable.id, permissionChangeLogTable.actorId))
      .where(cond)
      .orderBy(desc(permissionChangeLogTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ c: sql<string>`COUNT(*)` })
      // org-scope-allow: scoped to organizationId via cond
      .from(permissionChangeLogTable)
      .where(cond),
  ]);

  const total = Number(countRow[0]?.c ?? 0);

  res.json({
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── GET /audit-logs ────────────────────────────────────────────────────────
router.get("/audit-logs", async (req, res) => {
  const tenant = req.tenant!;

  if (!tenant.isSuperAdmin && !tenant.can("settings", "view")) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const module = req.query.module as string | undefined;
  const action = req.query.action as string | undefined;
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const search = (req.query.search as string | undefined)?.trim();

  const conds = [eq(auditLogsTable.organizationId, tenant.organizationId)];
  if (module) conds.push(eq(auditLogsTable.module, module));
  if (action) conds.push(eq(auditLogsTable.action, action));
  if (userId) conds.push(eq(auditLogsTable.userId, userId));
  if (search) conds.push(or(
    ilike(auditLogsTable.description, `%${search}%`),
    ilike(auditLogsTable.resourceType, `%${search}%`),
  )!);
  if (from) conds.push(gte(auditLogsTable.createdAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setUTCHours(23, 59, 59, 999);
    conds.push(lte(auditLogsTable.createdAt, toDate));
  }

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: auditLogsTable.id,
        organizationId: auditLogsTable.organizationId,
        userId: auditLogsTable.userId,
        module: auditLogsTable.module,
        action: auditLogsTable.action,
        resourceType: auditLogsTable.resourceType,
        resourceId: auditLogsTable.resourceId,
        description: auditLogsTable.description,
        changes: auditLogsTable.changes,
        ipAddress: auditLogsTable.ipAddress,
        createdAt: auditLogsTable.createdAt,
        actorName: usersTable.name,
        actorEmail: usersTable.email,
      })
      .from(auditLogsTable)
      .leftJoin(usersTable, eq(usersTable.id, auditLogsTable.userId))
      .where(and(...conds))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ c: sql<string>`COUNT(*)` })
      .from(auditLogsTable)
      .where(and(...conds)),
  ]);

  const total = Number(countRow[0]?.c ?? 0);

  res.json({
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

export default router;
