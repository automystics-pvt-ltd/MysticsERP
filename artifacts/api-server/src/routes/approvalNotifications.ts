import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  approvalNotificationsTable,
  approvalRequestsTable,
  organizationMembersTable,
  usersTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { normalizeRole } from "../lib/permissions";

const router: IRouter = Router();
router.use(tenantMiddleware);

// ─── List notifications for the current user ─────────────────────────────

router.get("/approval-notifications", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const onlyUnread = req.query.unread === "true";
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const conds = [
      eq(approvalNotificationsTable.organizationId, t.organizationId),
      eq(approvalNotificationsTable.userId, t.userId),
    ];
    if (onlyUnread) {
      conds.push(eq(approvalNotificationsTable.isRead, false));
    }

    const rows = await db
      .select()
      .from(approvalNotificationsTable)
      .where(and(...conds))
      .orderBy(desc(approvalNotificationsTable.createdAt))
      .limit(limit);

    const unreadCount = onlyUnread
      ? rows.length
      : await db
          .select()
          .from(approvalNotificationsTable)
          .where(
            and(
              eq(approvalNotificationsTable.organizationId, t.organizationId),
              eq(approvalNotificationsTable.userId, t.userId),
              eq(approvalNotificationsTable.isRead, false),
            ),
          )
          .then((r) => r.length);

    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        requestId: n.requestId,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Mark notifications as read ──────────────────────────────────────────

router.post("/approval-notifications/mark-read", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const ids: number[] | undefined = req.body?.ids;

    if (ids && ids.length > 0) {
      // Mark specific notifications as read
      await db
        .update(approvalNotificationsTable)
        .set({ isRead: true })
        .where(
          and(
            eq(approvalNotificationsTable.organizationId, t.organizationId),
            eq(approvalNotificationsTable.userId, t.userId),
            inArray(approvalNotificationsTable.id, ids),
          ),
        );
    } else {
      // Mark all as read
      await db
        .update(approvalNotificationsTable)
        .set({ isRead: true })
        .where(
          and(
            eq(approvalNotificationsTable.organizationId, t.organizationId),
            eq(approvalNotificationsTable.userId, t.userId),
            eq(approvalNotificationsTable.isRead, false),
          ),
        );
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Create a notification (internal helper also exposed for testing) ─────

router.post("/approval-notifications", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const actorRole = normalizeRole(t.role);
    if (actorRole !== "owner" && actorRole !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { userIds, requestId, type, message } = req.body ?? {};
    if (!userIds || !Array.isArray(userIds) || !type || !message) {
      res.status(400).json({ error: "userIds[], type, and message are required" });
      return;
    }

    const rows = (userIds as number[]).map((uid) => ({
      organizationId: t.organizationId,
      userId: uid,
      requestId: requestId ?? null,
      type: String(type),
      message: String(message),
    }));

    await db.insert(approvalNotificationsTable).values(rows);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
