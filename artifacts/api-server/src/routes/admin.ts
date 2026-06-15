import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationMembersTable,
  itemsTable,
  salesOrdersTable,
  usersTable,
} from "@workspace/db";
import { z } from "zod";
import { validateBody } from "../lib/validate";
import { hashPassword, validatePasswordStrength } from "../lib/password";
import { tenantMiddleware } from "../lib/tenant";

const router: IRouter = Router();

router.use("/admin", tenantMiddleware, (req, res, next) => {
  if (req.tenant?.isSuperAdmin) {
    next();
    return;
  }
  res.status(403).json({ error: "Super admin access required" });
});

router.get("/admin/organizations", async (_req, res, next) => {
  try {
    const memberCounts = db
      .select({
        organizationId: organizationMembersTable.organizationId,
        count: sql<number>`COUNT(*)::int`.as("member_count"),
      })
      // org-scope-allow: super-admin dashboard aggregates per-org counts
      // across all tenants (route is gated by isSuperAdmin above).
      .from(organizationMembersTable)
      .groupBy(organizationMembersTable.organizationId)
      .as("member_counts");

    const itemCounts = db
      .select({
        organizationId: itemsTable.organizationId,
        count: sql<number>`COUNT(*)::int`.as("item_count"),
      })
      // org-scope-allow: super-admin dashboard aggregate.
      .from(itemsTable)
      .groupBy(itemsTable.organizationId)
      .as("item_counts");

    const orderCounts = db
      .select({
        organizationId: salesOrdersTable.organizationId,
        count: sql<number>`COUNT(*)::int`.as("order_count"),
      })
      // org-scope-allow: super-admin dashboard aggregate.
      .from(salesOrdersTable)
      .groupBy(salesOrdersTable.organizationId)
      .as("order_counts");

    const rows = await db
      .select({
        id: organizationsTable.id,
        name: organizationsTable.name,
        slug: organizationsTable.slug,
        plan: organizationsTable.plan,
        subscriptionStatus: organizationsTable.subscriptionStatus,
        currency: organizationsTable.currency,
        gstNumber: organizationsTable.gstNumber,
        createdAt: organizationsTable.createdAt,
        trialEndsAt: organizationsTable.trialEndsAt,
        memberCount: sql<number>`COALESCE(${memberCounts.count}, 0)`,
        itemCount: sql<number>`COALESCE(${itemCounts.count}, 0)`,
        salesOrderCount: sql<number>`COALESCE(${orderCounts.count}, 0)`,
      })
      .from(organizationsTable)
      .leftJoin(
        memberCounts,
        eq(memberCounts.organizationId, organizationsTable.id),
      )
      .leftJoin(
        itemCounts,
        eq(itemCounts.organizationId, organizationsTable.id),
      )
      .leftJoin(
        orderCounts,
        eq(orderCounts.organizationId, organizationsTable.id),
      )
      .orderBy(organizationsTable.createdAt);

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        plan: r.plan,
        subscriptionStatus: r.subscriptionStatus,
        currency: r.currency,
        gstNumber: r.gstNumber,
        createdAt: r.createdAt.toISOString(),
        trialEndsAt: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
        memberCount: Number(r.memberCount ?? 0),
        itemCount: Number(r.itemCount ?? 0),
        salesOrderCount: Number(r.salesOrderCount ?? 0),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/admin/stats", async (_req, res, next) => {
  try {
    const [orgCount] = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(organizationsTable);
    const [userCount] = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(usersTable);
    const [orderCount] = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      // org-scope-allow: super-admin global order count.
      .from(salesOrdersTable);
    res.json({
      organizationCount: Number(orgCount?.c ?? 0),
      userCount: Number(userCount?.c ?? 0),
      salesOrderCount: Number(orderCount?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/users", async (_req, res, next) => {
  try {
    const rows = await db
      // org-scope-allow: super-admin user list across all tenants
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        isSuperAdmin: usersTable.isSuperAdmin,
        emailVerifiedAt: usersTable.emailVerifiedAt,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(desc(usersTable.createdAt));
    res.json(
      rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isSuperAdmin: u.isSuperAdmin,
        emailVerified: u.emailVerifiedAt !== null,
        createdAt: u.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

const createUserSchema = z.object({
  email: z.string().email().max(254),
  password: z.string(),
  name: z.string().trim().min(1).max(120).optional(),
});

router.post(
  "/admin/users",
  validateBody(createUserSchema),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof createUserSchema>;
      const pwErr = validatePasswordStrength(b.password);
      if (pwErr) {
        res.status(400).json({ error: pwErr });
        return;
      }
      const email = b.email.toLowerCase().trim();
      const existing = await db
        // org-scope-allow: super-admin checks global email uniqueness
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (existing[0]) {
        res.status(409).json({ error: "A user with that email already exists" });
        return;
      }
      const passwordHash = await hashPassword(b.password);
      const inserted = await db
        .insert(usersTable)
        .values({
          email,
          name: b.name ?? null,
          passwordHash,
          emailVerifiedAt: new Date(),
        })
        .returning();
      const u = inserted[0]!;
      res.status(201).json({
        id: u.id,
        email: u.email,
        name: u.name,
        isSuperAdmin: u.isSuperAdmin,
        emailVerified: u.emailVerifiedAt !== null,
        createdAt: u.createdAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.delete("/admin/users/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    if (id === req.tenant?.userId) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }
    const deleted = await db
      // org-scope-allow: super-admin deleting any user
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id });
    if (!deleted[0]) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/users/:id/verify", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const rows = await db
      // org-scope-allow: super-admin verifying any user
      .select({ id: usersTable.id, emailVerifiedAt: usersTable.emailVerifiedAt })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    const user = rows[0];
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const updated = await db
      .update(usersTable)
      .set({
        emailVerifiedAt: user.emailVerifiedAt ? null : new Date(),
        verifyToken: null,
        verifyTokenExpiresAt: null,
      })
      .where(eq(usersTable.id, id))
      .returning();
    const u = updated[0]!;
    res.json({
      id: u.id,
      email: u.email,
      name: u.name,
      isSuperAdmin: u.isSuperAdmin,
      emailVerified: u.emailVerifiedAt !== null,
      createdAt: u.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
