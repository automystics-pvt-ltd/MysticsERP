import { Router, type IRouter } from "express";
import { and, eq, desc, asc, gte, ilike, lte, inArray, or, sql } from "drizzle-orm";
import {
  db,
  posCountersTable,
  posSessionsTable,
  posSessionExpensesTable,
  posSessionAuditLogsTable,
  warehousesTable,
  usersTable,
  salesOrdersTable,
  salesOrderLinesTable,
  itemsTable,
  customerPaymentsTable,
  customerPaymentAllocationsTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { toNum, toStr } from "../lib/numeric";
import { nextOrderNumber } from "../lib/orderHelpers";

const router: IRouter = Router();
router.use(tenantMiddleware);

const MANAGER_AND_UP = ["owner", "admin", "manager"] as const;
const OWNER_AND_ADMIN = ["owner", "admin"] as const;

function requireManagerOrUp(req: Parameters<typeof tenantMiddleware>[0], res: Parameters<typeof tenantMiddleware>[1]): boolean {
  const role = req.tenant?.role;
  if (!role || !(MANAGER_AND_UP as readonly string[]).includes(role)) {
    res.status(403).json({ error: "Manager or higher role required" });
    return false;
  }
  return true;
}

function requireOwnerOrAdmin(req: Parameters<typeof tenantMiddleware>[0], res: Parameters<typeof tenantMiddleware>[1]): boolean {
  const role = req.tenant?.role;
  if (!role || !(OWNER_AND_ADMIN as readonly string[]).includes(role)) {
    res.status(403).json({ error: "Owner or admin role required" });
    return false;
  }
  return true;
}

async function getUserDisplayName(userId: number): Promise<string> {
  const [u] = await db
    .select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable) // org-scope-allow: global users table – no organizationId column
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.name ?? u?.email ?? `User #${userId}`;
}

async function addAuditLog(
  organizationId: number,
  sessionId: number,
  action: string,
  performedByUserId: number,
  performedByName: string,
  metadata?: Record<string, unknown>,
) {
  await db.insert(posSessionAuditLogsTable).values({
    organizationId,
    sessionId,
    action,
    performedByUserId,
    performedByName,
    metadata: metadata ?? null,
  });
}

// ─── Counters ─────────────────────────────────────────────────────────────────

router.get("/pos/counters", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const includeInactive = req.query.includeInactive === "true";

    const rows = await db
      .select({
        id: posCountersTable.id,
        organizationId: posCountersTable.organizationId,
        warehouseId: posCountersTable.warehouseId,
        warehouseName: warehousesTable.name,
        name: posCountersTable.name,
        code: posCountersTable.code,
        isActive: posCountersTable.isActive,
        createdAt: posCountersTable.createdAt,
        updatedAt: posCountersTable.updatedAt,
      })
      .from(posCountersTable)
      .leftJoin(
        warehousesTable,
        and(
          eq(warehousesTable.id, posCountersTable.warehouseId),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .where(
        and(
          eq(posCountersTable.organizationId, t.organizationId),
          includeInactive ? undefined : eq(posCountersTable.isActive, true),
        ),
      )
      .orderBy(asc(posCountersTable.name));

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/pos/counters", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireManagerOrUp(req, res)) return;

    const { name, code, warehouseId } = req.body as {
      name?: string;
      code?: string;
      warehouseId?: number;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "Counter name is required" });
      return;
    }
    if (!code?.trim()) {
      res.status(400).json({ error: "Counter code is required" });
      return;
    }
    if (!warehouseId) {
      res.status(400).json({ error: "Warehouse is required" });
      return;
    }

    const [wh] = await db
      .select({ id: warehousesTable.id })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, warehouseId),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!wh) {
      res.status(400).json({ error: "Warehouse not found" });
      return;
    }

    const [counter] = await db
      .insert(posCountersTable)
      .values({
        organizationId: t.organizationId,
        warehouseId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        isActive: true,
      })
      .returning();

    res.status(201).json(counter);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({ error: "A counter with this code already exists" });
      return;
    }
    next(err);
  }
});

router.patch("/pos/counters/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireManagerOrUp(req, res)) return;
    const counterId = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(posCountersTable)
      .where(
        and(
          eq(posCountersTable.id, counterId),
          eq(posCountersTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Counter not found" });
      return;
    }

    const { name, code, warehouseId, isActive } = req.body as {
      name?: string;
      code?: string;
      warehouseId?: number;
      isActive?: boolean;
    };

    const updates: Partial<typeof posCountersTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name.trim();
    if (code !== undefined) updates.code = code.trim().toUpperCase();
    if (isActive !== undefined) updates.isActive = isActive;
    if (warehouseId !== undefined) {
      const [wh] = await db
        .select({ id: warehousesTable.id })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.id, warehouseId),
            eq(warehousesTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      if (!wh) {
        res.status(400).json({ error: "Warehouse not found" });
        return;
      }
      updates.warehouseId = warehouseId;
    }

    const [updated] = await db
      .update(posCountersTable)
      .set(updates)
      .where(
        and(
          eq(posCountersTable.id, counterId),
          eq(posCountersTable.organizationId, t.organizationId),
        ),
      )
      .returning();

    res.json(updated);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({ error: "A counter with this code already exists" });
      return;
    }
    next(err);
  }
});

router.delete("/pos/counters/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireManagerOrUp(req, res)) return;
    const counterId = Number(req.params.id);

    await db
      .update(posCountersTable)
      .set({ isActive: false })
      .where(
        and(
          eq(posCountersTable.id, counterId),
          eq(posCountersTable.organizationId, t.organizationId),
        ),
      );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

router.get("/pos/sessions", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const { status, warehouseId, counterId, cashierId, from, to, search } = req.query as Record<string, string | undefined>;

    const conditions = [eq(posSessionsTable.organizationId, t.organizationId)];
    if (status) conditions.push(eq(posSessionsTable.status, status));
    if (warehouseId) conditions.push(eq(posSessionsTable.warehouseId, Number(warehouseId)));
    if (counterId) conditions.push(eq(posSessionsTable.counterId, Number(counterId)));
    if (cashierId) conditions.push(eq(posSessionsTable.cashierId, Number(cashierId)));
    if (from) conditions.push(gte(posSessionsTable.openedAt, new Date(from)));
    if (to) conditions.push(lte(posSessionsTable.openedAt, new Date(to)));
    if (search) conditions.push(ilike(posSessionsTable.sessionNumber, `%${search}%`));

    const cashierUser = db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable) // org-scope-allow: global users table – no organizationId column
      .as("cashier_user");

    const approverUser = db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable) // org-scope-allow: global users table – no organizationId column
      .as("approver_user");

    const rawPage = Number(req.query.page) || 1;
    const rawPageSize = Number(req.query.pageSize) || 50;
    const page = Math.max(1, rawPage);
    const pageSize = Math.min(100, Math.max(10, rawPageSize));
    const offset = (page - 1) * pageSize;

    const [countRow] = await db
      .select({ total: sql<string>`COUNT(*)` })
      .from(posSessionsTable)
      .where(and(...conditions));
    const total = Number(countRow?.total ?? 0);

    const sessionSelect = {
      id: posSessionsTable.id,
      organizationId: posSessionsTable.organizationId,
      counterId: posSessionsTable.counterId,
      counterName: posCountersTable.name,
      counterCode: posCountersTable.code,
      warehouseId: posSessionsTable.warehouseId,
      warehouseName: warehousesTable.name,
      cashierId: posSessionsTable.cashierId,
      cashierName: cashierUser.name,
      cashierEmail: cashierUser.email,
      sessionNumber: posSessionsTable.sessionNumber,
      status: posSessionsTable.status,
      openedAt: posSessionsTable.openedAt,
      closedAt: posSessionsTable.closedAt,
      openingCash: posSessionsTable.openingCash,
      closingCash: posSessionsTable.closingCash,
      notes: posSessionsTable.notes,
      approvedById: posSessionsTable.approvedById,
      approvedByName: approverUser.name,
      approvedAt: posSessionsTable.approvedAt,
      approvalRemarks: posSessionsTable.approvalRemarks,
      rejectionReason: posSessionsTable.rejectionReason,
      createdAt: posSessionsTable.createdAt,
    };

    const rows = await db
      .select(sessionSelect)
      .from(posSessionsTable)
      .leftJoin(
        posCountersTable,
        and(
          eq(posCountersTable.id, posSessionsTable.counterId),
          eq(posCountersTable.organizationId, t.organizationId),
        ),
      )
      .leftJoin(
        warehousesTable,
        and(
          eq(warehousesTable.id, posSessionsTable.warehouseId),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .leftJoin(cashierUser, eq(cashierUser.id, posSessionsTable.cashierId))
      .leftJoin(approverUser, eq(approverUser.id, posSessionsTable.approvedById))
      .where(and(...conditions))
      .orderBy(desc(posSessionsTable.openedAt))
      .limit(pageSize)
      .offset(offset);

    res.json({ sessions: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get("/pos/sessions/my-active", async (req, res, next) => {
  try {
    const t = req.tenant!;

    const [session] = await db
      .select({
        id: posSessionsTable.id,
        sessionNumber: posSessionsTable.sessionNumber,
        status: posSessionsTable.status,
        openedAt: posSessionsTable.openedAt,
        warehouseId: posSessionsTable.warehouseId,
        warehouseName: warehousesTable.name,
        counterName: posCountersTable.name,
        openingCash: posSessionsTable.openingCash,
      })
      .from(posSessionsTable)
      .leftJoin(
        posCountersTable,
        and(
          eq(posCountersTable.id, posSessionsTable.counterId),
          eq(posCountersTable.organizationId, t.organizationId),
        ),
      )
      .leftJoin(
        warehousesTable,
        and(
          eq(warehousesTable.id, posSessionsTable.warehouseId),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .where(
        and(
          eq(posSessionsTable.organizationId, t.organizationId),
          eq(posSessionsTable.cashierId, t.userId),
          eq(posSessionsTable.status, "open"),
          ...(req.query.warehouseId
            ? [eq(posSessionsTable.warehouseId, Number(req.query.warehouseId))]
            : []),
        ),
      )
      .orderBy(desc(posSessionsTable.openedAt))
      .limit(1);

    res.json(session ?? null);
  } catch (err) {
    next(err);
  }
});

router.post("/pos/sessions", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const { warehouseId, counterId, openingCash, notes } = req.body as {
      warehouseId?: number;
      counterId?: number | null;
      openingCash?: number | string;
      notes?: string;
    };

    if (!warehouseId) {
      res.status(400).json({ error: "Warehouse is required" });
      return;
    }

    const [wh] = await db
      .select({ id: warehousesTable.id })
      .from(warehousesTable)
      .where(
        and(
          eq(warehousesTable.id, warehouseId),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!wh) {
      res.status(400).json({ error: "Warehouse not found" });
      return;
    }

    let session: typeof posSessionsTable.$inferSelect;
    try {
      session = await db.transaction(async (tx) => {
        if (counterId) {
          const [ctr] = await tx
            .select({ id: posCountersTable.id })
            .from(posCountersTable)
            .where(
              and(
                eq(posCountersTable.id, counterId),
                eq(posCountersTable.organizationId, t.organizationId),
                eq(posCountersTable.isActive, true),
              ),
            )
            .for("update")
            .limit(1);
          if (!ctr) {
            const err = new Error("Counter not found or inactive") as Error & { status?: number };
            err.status = 400;
            throw err;
          }

          const [existingOpen] = await tx
            .select({ id: posSessionsTable.id })
            .from(posSessionsTable)
            .where(
              and(
                eq(posSessionsTable.organizationId, t.organizationId),
                eq(posSessionsTable.counterId, counterId),
                eq(posSessionsTable.status, "open"),
              ),
            )
            .limit(1);
          if (existingOpen) {
            const err = new Error("This counter already has an open session") as Error & { status?: number };
            err.status = 409;
            throw err;
          }
        }

        const sessionNumber = nextOrderNumber("SES");
        const openingCashNum = toStr(Math.max(0, toNum(openingCash)));

        const [inserted] = await tx
          .insert(posSessionsTable)
          .values({
            organizationId: t.organizationId,
            warehouseId,
            counterId: counterId ?? null,
            cashierId: t.userId,
            sessionNumber,
            status: "open",
            openedAt: new Date(),
            openingCash: openingCashNum,
            notes: notes?.trim() ?? null,
          })
          .returning();

        return inserted!;
      });
    } catch (err: unknown) {
      const typed = err as Error & { status?: number; code?: string };
      if (typed.status === 400) {
        res.status(400).json({ error: typed.message });
        return;
      }
      if (typed.status === 409) {
        res.status(409).json({ error: typed.message });
        return;
      }
      if (typed.code === "23505") {
        res.status(409).json({ error: "Session number conflict — please try again" });
        return;
      }
      throw err;
    }

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, session.id, "opened", t.userId, performerName, {
      warehouseId,
      counterId,
      openingCash: session.openingCash,
    });

    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

router.get("/pos/sessions/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const sessionId = Number(req.params.id);

    const cashierUser = db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable) // org-scope-allow: global users table – no organizationId column
      .as("cashier_user2");

    const approverUser = db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable) // org-scope-allow: global users table – no organizationId column
      .as("approver_user2");

    const [session] = await db
      .select({
        id: posSessionsTable.id,
        organizationId: posSessionsTable.organizationId,
        counterId: posSessionsTable.counterId,
        counterName: posCountersTable.name,
        counterCode: posCountersTable.code,
        warehouseId: posSessionsTable.warehouseId,
        warehouseName: warehousesTable.name,
        cashierId: posSessionsTable.cashierId,
        cashierName: cashierUser.name,
        cashierEmail: cashierUser.email,
        sessionNumber: posSessionsTable.sessionNumber,
        status: posSessionsTable.status,
        openedAt: posSessionsTable.openedAt,
        closedAt: posSessionsTable.closedAt,
        openingCash: posSessionsTable.openingCash,
        closingCash: posSessionsTable.closingCash,
        notes: posSessionsTable.notes,
        approvedById: posSessionsTable.approvedById,
        approvedByName: approverUser.name,
        approvedAt: posSessionsTable.approvedAt,
        approvalRemarks: posSessionsTable.approvalRemarks,
        rejectionReason: posSessionsTable.rejectionReason,
        createdAt: posSessionsTable.createdAt,
      })
      .from(posSessionsTable)
      .leftJoin(
        posCountersTable,
        and(
          eq(posCountersTable.id, posSessionsTable.counterId),
          eq(posCountersTable.organizationId, t.organizationId),
        ),
      )
      .leftJoin(
        warehousesTable,
        and(
          eq(warehousesTable.id, posSessionsTable.warehouseId),
          eq(warehousesTable.organizationId, t.organizationId),
        ),
      )
      .leftJoin(cashierUser, eq(cashierUser.id, posSessionsTable.cashierId))
      .leftJoin(approverUser, eq(approverUser.id, posSessionsTable.approvedById))
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const expenses = await db
      .select()
      .from(posSessionExpensesTable)
      .where(
        and(
          eq(posSessionExpensesTable.sessionId, sessionId),
          eq(posSessionExpensesTable.organizationId, t.organizationId),
        ),
      )
      .orderBy(asc(posSessionExpensesTable.createdAt));

    const auditLogs = await db
      .select()
      .from(posSessionAuditLogsTable)
      .where(
        and(
          eq(posSessionAuditLogsTable.sessionId, sessionId),
          eq(posSessionAuditLogsTable.organizationId, t.organizationId),
        ),
      )
      .orderBy(asc(posSessionAuditLogsTable.createdAt));

    res.json({ ...session, expenses, auditLogs });
  } catch (err) {
    next(err);
  }
});

// Close session (cashier submits closing cash)
router.post("/pos/sessions/:id/close", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "open") {
      res.status(409).json({ error: "Only open sessions can be closed" });
      return;
    }
    if (session.cashierId !== t.userId && !MANAGER_AND_UP.includes(t.role as typeof MANAGER_AND_UP[number])) {
      res.status(403).json({ error: "Only the cashier or a manager can close this session" });
      return;
    }

    const { closingCash, notes } = req.body as {
      closingCash?: number | string;
      notes?: string;
    };

    const closingCashNum = toStr(Math.max(0, toNum(closingCash)));

    const [updated] = await db
      .update(posSessionsTable)
      .set({
        status: "closed",
        closedAt: new Date(),
        closingCash: closingCashNum,
        notes: notes?.trim() ?? session.notes,
      })
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .returning();

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "closed", t.userId, performerName, {
      closingCash: closingCashNum,
      notes: notes?.trim(),
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Submit for approval (cashier) — closed → pending_approval
router.post("/pos/sessions/:id/submit", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "closed") {
      res.status(409).json({ error: "Only closed sessions can be submitted for approval" });
      return;
    }
    if (session.cashierId !== t.userId && !MANAGER_AND_UP.includes(t.role as typeof MANAGER_AND_UP[number])) {
      res.status(403).json({ error: "Only the cashier or a manager can submit this session" });
      return;
    }

    const [updated] = await db
      .update(posSessionsTable)
      .set({ status: "pending_approval" })
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .returning();

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "submitted", t.userId, performerName, {});

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Approve session (manager+) — accepts optional remarks
router.post("/pos/sessions/:id/approve", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireManagerOrUp(req, res)) return;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "pending_approval") {
      res.status(409).json({ error: "Only sessions pending approval can be approved" });
      return;
    }

    const { remarks } = req.body as { remarks?: string };

    const [updated] = await db
      .update(posSessionsTable)
      .set({
        status: "approved",
        approvedById: t.userId,
        approvedAt: new Date(),
        approvalRemarks: remarks?.trim() ?? null,
        rejectionReason: null,
      })
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .returning();

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "approved", t.userId, performerName, {
      remarks: remarks?.trim(),
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Reject session (manager+) — pending_approval → rejected (stays rejected until cashier resubmits)
router.post("/pos/sessions/:id/reject", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireManagerOrUp(req, res)) return;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "pending_approval") {
      res.status(409).json({ error: "Only sessions pending approval can be rejected" });
      return;
    }

    const { reason } = req.body as { reason?: string };

    const [updated] = await db
      .update(posSessionsTable)
      .set({
        status: "rejected",
        rejectionReason: reason?.trim() ?? null,
      })
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .returning();

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "rejected", t.userId, performerName, {
      reason: reason?.trim(),
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Resubmit for approval (cashier) — rejected → pending_approval
router.post("/pos/sessions/:id/resubmit", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "rejected") {
      res.status(409).json({ error: "Only rejected sessions can be resubmitted" });
      return;
    }
    if (session.cashierId !== t.userId && !MANAGER_AND_UP.includes(t.role as typeof MANAGER_AND_UP[number])) {
      res.status(403).json({ error: "Only the cashier or a manager can resubmit this session" });
      return;
    }

    const [updated] = await db
      .update(posSessionsTable)
      .set({
        status: "pending_approval",
        rejectionReason: null,
      })
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .returning();

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "resubmitted", t.userId, performerName, {});

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Reopen approved/rejected session (manager+) — reverses approval for correction
router.post("/pos/sessions/:id/reopen", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireManagerOrUp(req, res)) return;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "approved" && session.status !== "rejected") {
      res.status(409).json({ error: "Only approved or rejected sessions can be reopened" });
      return;
    }

    const { reason } = req.body as { reason?: string };

    const [updated] = await db
      .update(posSessionsTable)
      .set({
        status: "open",
        closedAt: null,
        closingCash: null,
        approvedById: null,
        approvedAt: null,
        approvalRemarks: null,
        rejectionReason: reason?.trim() ?? null,
      })
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .returning();

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "reopened", t.userId, performerName, {
      reason: reason?.trim(),
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Session reconciliation report — comprehensive breakdown
router.get("/pos/sessions/:id/report", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Sales orders directly linked to this session
    const posOrders = await db
      .select({
        id: salesOrdersTable.id,
        orderNumber: salesOrdersTable.orderNumber,
        total: salesOrdersTable.total,
        subtotal: salesOrdersTable.subtotal,
        status: salesOrdersTable.status,
        createdAt: salesOrdersTable.createdAt,
      })
      .from(salesOrdersTable)
      .where(
        and(
          eq(salesOrdersTable.organizationId, t.organizationId),
          eq(salesOrdersTable.posSessionId, sessionId),
        ),
      )
      .orderBy(asc(salesOrdersTable.createdAt));

    const totalOrders = posOrders.length;
    const cancelledOrders = posOrders.filter((o) => o.status === "cancelled");
    const activeOrders = posOrders.filter((o) => o.status !== "cancelled");
    const totalSales = activeOrders.reduce((acc, o) => acc + toNum(o.total), 0);

    let paymentsByMode: Array<{ mode: string; total: string }> = [];
    let totalDiscounts = 0;
    let topItems: Array<{ itemId: number; itemName: string; itemSku: string; totalQty: string; totalAmount: string }> = [];

    if (posOrders.length > 0) {
      const posOrderIds = posOrders.map((o) => o.id);

      // Payment mode breakdown
      const modeRows = await db
        .select({
          mode: customerPaymentsTable.mode,
          total: sql<string>`COALESCE(SUM(${customerPaymentsTable.amount}), '0')`,
        })
        .from(customerPaymentsTable)
        .innerJoin(
          customerPaymentAllocationsTable,
          and(
            eq(customerPaymentAllocationsTable.paymentId, customerPaymentsTable.id),
            eq(customerPaymentAllocationsTable.organizationId, t.organizationId),
            inArray(customerPaymentAllocationsTable.salesOrderId, posOrderIds),
          ),
        )
        .where(eq(customerPaymentsTable.organizationId, t.organizationId))
        .groupBy(customerPaymentsTable.mode);

      paymentsByMode = modeRows;

      // Total discounts: sum of line-level discounts + order-level discounts
      const [discountRow] = await db
        .select({
          totalDiscounts: sql<string>`COALESCE(SUM(${salesOrderLinesTable.discountAmount}), '0')`,
        })
        .from(salesOrderLinesTable)
        .where(inArray(salesOrderLinesTable.salesOrderId, posOrderIds));

      // Order-level discount = baked-in reduction: (subtotal + taxTotal) - total
      const [orderDiscountRow] = await db
        .select({
          total: sql<string>`COALESCE(SUM(GREATEST(0, ${salesOrdersTable.subtotal}::numeric + ${salesOrdersTable.taxTotal}::numeric - ${salesOrdersTable.total}::numeric)), '0')`,
        })
        .from(salesOrdersTable)
        .where(
          and(
            eq(salesOrdersTable.organizationId, t.organizationId),
            inArray(salesOrdersTable.id, posOrderIds),
          ),
        );

      totalDiscounts =
        toNum(discountRow?.totalDiscounts ?? "0") +
        toNum(orderDiscountRow?.total ?? "0");

      // Top items sold (by quantity)
      const topItemRows = await db
        .select({
          itemId: salesOrderLinesTable.itemId,
          itemName: itemsTable.name,
          itemSku: itemsTable.sku,
          totalQty: sql<string>`SUM(${salesOrderLinesTable.quantity})`,
          totalAmount: sql<string>`SUM(${salesOrderLinesTable.lineSubtotal})`,
        })
        .from(salesOrderLinesTable)
        .innerJoin(itemsTable, eq(itemsTable.id, salesOrderLinesTable.itemId))
        .where(inArray(salesOrderLinesTable.salesOrderId, posOrderIds))
        .groupBy(salesOrderLinesTable.itemId, itemsTable.name, itemsTable.sku)
        .orderBy(desc(sql`SUM(${salesOrderLinesTable.quantity})`))
        .limit(10);

      topItems = topItemRows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        itemSku: r.itemSku,
        totalQty: toStr(toNum(r.totalQty)),
        totalAmount: toStr(toNum(r.totalAmount)),
      }));
    }

    const expenseRows = await db
      .select()
      .from(posSessionExpensesTable)
      .where(
        and(
          eq(posSessionExpensesTable.sessionId, sessionId),
          eq(posSessionExpensesTable.organizationId, t.organizationId),
        ),
      );

    const totalExpenses = expenseRows.reduce((acc, e) => acc + toNum(e.amount), 0);

    // Cash paid for cancelled orders must be physically returned to customers (cash out of till)
    const cancelledOrderIds = cancelledOrders.map((o) => o.id);
    let cashReturns = 0;
    if (cancelledOrderIds.length > 0) {
      const [returnRow] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${customerPaymentsTable.amount}), '0')`,
        })
        .from(customerPaymentsTable)
        .innerJoin(
          customerPaymentAllocationsTable,
          and(
            eq(customerPaymentAllocationsTable.paymentId, customerPaymentsTable.id),
            eq(customerPaymentAllocationsTable.organizationId, t.organizationId),
            inArray(customerPaymentAllocationsTable.salesOrderId, cancelledOrderIds),
          ),
        )
        .where(
          and(
            eq(customerPaymentsTable.organizationId, t.organizationId),
            eq(customerPaymentsTable.mode, "cash"),
          ),
        );
      cashReturns = toNum(returnRow?.total ?? "0");
    }

    const cashPayments = toNum(paymentsByMode.find((m) => m.mode === "cash")?.total ?? "0");
    const openingCash = toNum(session.openingCash);
    // Expected = opening + gross cash received - cash refunded on cancellations - expenses
    const expectedClosingCash = openingCash + cashPayments - cashReturns - totalExpenses;
    const actualClosingCash = session.closingCash !== null ? toNum(session.closingCash) : null;
    const cashVariance = actualClosingCash !== null ? actualClosingCash - expectedClosingCash : null;

    res.json({
      sessionId,
      warehouseId: session.warehouseId,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openingCash: toStr(openingCash),
      closingCash: session.closingCash,
      totalOrders,
      activeOrders: activeOrders.length,
      cancelledOrders: cancelledOrders.length,
      totalSales: toStr(totalSales),
      totalDiscounts: toStr(totalDiscounts),
      paymentsByMode,
      cashReturns: toStr(cashReturns),
      totalExpenses: toStr(totalExpenses),
      expenses: expenseRows,
      expectedClosingCash: toStr(expectedClosingCash),
      actualClosingCash: actualClosingCash !== null ? toStr(actualClosingCash) : null,
      cashVariance: cashVariance !== null ? toStr(cashVariance) : null,
      topItems,
      orders: activeOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        total: toStr(toNum(o.total)),
        status: o.status,
        createdAt: o.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Expenses ─────────────────────────────────────────────────────────────────

router.post("/pos/sessions/:id/expenses", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const sessionId = Number(req.params.id);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "open") {
      res.status(409).json({ error: "Expenses can only be added to an open session" });
      return;
    }

    const { label, amount, category } = req.body as {
      label?: string;
      amount?: number | string;
      category?: string;
    };

    if (!label?.trim()) {
      res.status(400).json({ error: "Expense label is required" });
      return;
    }
    const amountNum = toNum(amount);
    if (!amountNum || amountNum <= 0) {
      res.status(400).json({ error: "Expense amount must be greater than zero" });
      return;
    }

    const [expense] = await db
      .insert(posSessionExpensesTable)
      .values({
        organizationId: t.organizationId,
        sessionId,
        label: label.trim(),
        amount: toStr(amountNum),
        category: category?.trim() ?? null,
        createdById: t.userId,
      })
      .returning();

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "expense_added", t.userId, performerName, {
      label: label.trim(),
      amount: toStr(amountNum),
      category: category?.trim(),
    });

    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

router.delete("/pos/sessions/:id/expenses/:expId", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const sessionId = Number(req.params.id);
    const expId = Number(req.params.expId);

    const [session] = await db
      .select()
      .from(posSessionsTable)
      .where(
        and(
          eq(posSessionsTable.id, sessionId),
          eq(posSessionsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "open") {
      res.status(409).json({ error: "Expenses can only be deleted from an open session" });
      return;
    }

    const [expense] = await db
      .select()
      .from(posSessionExpensesTable)
      .where(
        and(
          eq(posSessionExpensesTable.id, expId),
          eq(posSessionExpensesTable.sessionId, sessionId),
          eq(posSessionExpensesTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);

    if (!expense) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }

    await db
      .delete(posSessionExpensesTable)
      .where(
        and(
          eq(posSessionExpensesTable.id, expId),
          eq(posSessionExpensesTable.sessionId, sessionId),
          eq(posSessionExpensesTable.organizationId, t.organizationId),
        ),
      );

    const performerName = await getUserDisplayName(t.userId);
    await addAuditLog(t.organizationId, sessionId, "expense_deleted", t.userId, performerName, {
      label: expense.label,
      amount: expense.amount,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
