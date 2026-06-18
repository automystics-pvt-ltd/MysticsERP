import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  approvalRequestsTable,
  approvalActionsTable,
  approvalWorkflowsTable,
  approvalRulesTable,
  usersTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { normalizeRole } from "../lib/permissions";
import {
  processAction,
  loadApprovalRequestDetail,
  type ApprovalActionType,
} from "../lib/approvalEngine";
import {
  executeApprovalCallback,
  revertApprovalCallback,
} from "../lib/approvalCallbacks";
import { pushStockToShopify } from "../lib/shopifyOutbound";
import { writeAuditLog, getClientIp } from "../lib/audit";
import { createApprovalNotification } from "../lib/approvalNotify";

const router: IRouter = Router();
router.use(tenantMiddleware);

// ─── List approval requests ────────────────────────────────────────────────

router.get("/approval-requests", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const conds = [eq(approvalRequestsTable.organizationId, t.organizationId)];

    if (req.query.module) {
      conds.push(eq(approvalRequestsTable.module, String(req.query.module)));
    }
    if (req.query.status) {
      conds.push(eq(approvalRequestsTable.status, String(req.query.status)));
    }
    if (req.query.recordId) {
      conds.push(eq(approvalRequestsTable.recordId, Number(req.query.recordId)));
    }

    // "assignee=me" filter: only requests where the current user's role matches the current level's rule
    const filterMine = req.query.assignee === "me";

    const [countRows, rows] = await Promise.all([
      db
        .select({ count: sql<string>`COUNT(*)` })
        .from(approvalRequestsTable)
        .where(and(...conds)),
      db
        .select()
        .from(approvalRequestsTable)
        .where(and(...conds))
        .orderBy(desc(approvalRequestsTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

    // Load workflow SLA info for overdue computation
    const workflowIds = Array.from(
      new Set(rows.map((r) => r.workflowId).filter((id): id is number => id !== null && id !== undefined)),
    );
    const wfRows =
      workflowIds.length > 0
        ? await db
            .select({
              id: approvalWorkflowsTable.id,
              slaThresholdDays: approvalWorkflowsTable.slaThresholdDays,
            })
            .from(approvalWorkflowsTable)
            .where(
              and(
                inArray(approvalWorkflowsTable.id, workflowIds),
                eq(approvalWorkflowsTable.organizationId, t.organizationId),
              ),
            )
        : [];
    const wfMap = new Map(wfRows.map((w) => [w.id, w.slaThresholdDays]));

    // Always load rules: needed for per-level SLA overdue computation and optionally for "assignee=me" filtering
    let rulesMap = new Map<number, Array<{ levelIndex: number; approverType: string; approverValue: string; slaHours: number | null }>>();
    if (workflowIds.length > 0) {
      const ruleRows = await db
        .select()
        .from(approvalRulesTable)
        .where(
          and(
            inArray(approvalRulesTable.workflowId, workflowIds),
            eq(approvalRulesTable.organizationId, t.organizationId),
          ),
        );
      for (const r of ruleRows) {
        const list = rulesMap.get(r.workflowId) ?? [];
        list.push(r);
        rulesMap.set(r.workflowId, list);
      }
    }

    // Resolve effective SLA in hours: rule-level slaHours → workflow slaThresholdDays × 24 → 72h default
    function effectiveSlaHours(workflowId: number | null | undefined, currentLevel: number): number {
      if (workflowId != null) {
        const rule = (rulesMap.get(workflowId) ?? []).find((r) => r.levelIndex === currentLevel);
        if (rule?.slaHours != null && rule.slaHours > 0) return rule.slaHours;
        const wfDays = wfMap.get(workflowId);
        if (wfDays != null) return wfDays * 24;
      }
      return 72;
    }

    const actorRole = normalizeRole(t.role);
    const isAdmin = actorRole === "owner" || actorRole === "admin";

    const nowMs = Date.now();
    let serialized = rows.map((req) => {
      const slaHrs = effectiveSlaHours(req.workflowId, req.currentLevel);
      const ageHours = (nowMs - req.createdAt.getTime()) / (1000 * 60 * 60);
      const isOverdue = req.status === "pending" && ageHours > slaHrs;
      return {
        id: req.id,
        module: req.module,
        recordId: req.recordId,
        recordRef: req.recordRef,
        currentLevel: req.currentLevel,
        totalLevels: req.totalLevels,
        status: req.status,
        submittedById: req.submittedById,
        isOverdue,
        createdAt: req.createdAt.toISOString(),
        resolvedAt: req.resolvedAt ? req.resolvedAt.toISOString() : null,
        workflowId: req.workflowId ?? null,
      };
    });

    if (filterMine) {
      serialized = serialized.filter((req) => {
        if (req.status !== "pending") return false;
        if (isAdmin) return true; // admins see all pending
        if (!req.workflowId) return true;
        const rules = rulesMap.get(req.workflowId) ?? [];
        const rule = rules.find((r) => r.levelIndex === req.currentLevel);
        if (!rule) return true;
        if (rule.approverType === "role") return actorRole === rule.approverValue;
        return String(t.userId) === rule.approverValue;
      });
    }

    res.json({ requests: serialized, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// ─── Get approval request detail ──────────────────────────────────────────

router.get("/approval-requests/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const detail = await loadApprovalRequestDetail(t.organizationId, id);
    if (!detail) {
      res.status(404).json({ error: "Approval request not found" });
      return;
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// ─── Submit for approval (programmatic / test endpoint) ─────────────────

router.post("/approval-requests/submit", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const b = req.body ?? {};
    const { module, recordId, recordRef } = b;
    if (!module || !recordId || !recordRef) {
      res.status(400).json({ error: "module, recordId, and recordRef are required" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const { submitForApproval } = await import("../lib/approvalEngine");
      return submitForApproval(tx, t.organizationId, module, Number(recordId), String(recordRef), t.userId);
    });

    if (!result) {
      res.status(400).json({ error: "No approval workflow configured for this module" });
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Approve ──────────────────────────────────────────────────────────────

router.post("/approval-requests/:id/approve", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!t.can("approvals", "approve")) {
      res.status(403).json({ error: "You do not have permission to approve transactions" });
      return;
    }

    const requestId = Number(req.params.id);
    const comment = req.body?.comment ?? undefined;
    const actorRole = normalizeRole(t.role);

    const { result, touchedItemIds, reqInfo } = await db.transaction(async (tx) => {
      // Load module + recordId so we can call the business callback after action
      const [reqInfo] = await tx
        .select({
          module: approvalRequestsTable.module,
          recordId: approvalRequestsTable.recordId,
          submittedById: approvalRequestsTable.submittedById,
          recordRef: approvalRequestsTable.recordRef,
        })
        .from(approvalRequestsTable)
        .where(
          and(
            eq(approvalRequestsTable.id, requestId),
            eq(approvalRequestsTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      if (!reqInfo) {
        throw Object.assign(new Error("Approval request not found"), {
          status: 404,
        });
      }

      const actionResult = await processAction(
        tx,
        t.organizationId,
        requestId,
        t.userId,
        actorRole,
        "approve",
        comment,
      );

      let touchedItemIds: number[] = [];
      if (actionResult.isFullyApproved) {
        const cb = await executeApprovalCallback(
          tx,
          t.organizationId,
          reqInfo.module,
          reqInfo.recordId,
        );
        touchedItemIds = cb.touchedItemIds;
      }

      return { result: actionResult, touchedItemIds, reqInfo };
    });

    for (const itemId of touchedItemIds) {
      pushStockToShopify(t.organizationId, itemId);
    }

    await writeAuditLog({
      organizationId: t.organizationId,
      userId: t.userId,
      module: "settings",
      action: "approve",
      resourceType: "approval_request",
      resourceId: requestId,
      description: `Approved request #${requestId}`,
      ipAddress: getClientIp(req),
    });

    createApprovalNotification(
      t.organizationId,
      requestId,
      "approved",
      `Your request for ${reqInfo.recordRef} was approved`,
      { submittedById: reqInfo.submittedById },
    );

    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ─── Reject ───────────────────────────────────────────────────────────────

router.post("/approval-requests/:id/reject", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!t.can("approvals", "approve")) {
      res.status(403).json({ error: "You do not have permission to reject transactions" });
      return;
    }

    const requestId = Number(req.params.id);
    const comment = req.body?.comment;
    if (!comment?.trim()) {
      res.status(400).json({ error: "A comment is required when rejecting" });
      return;
    }

    const actorRole = normalizeRole(t.role);
    const { actionResult: result, reqInfo } = await db.transaction(async (tx) => {
      const [reqInfo] = await tx
        .select({
          module: approvalRequestsTable.module,
          recordId: approvalRequestsTable.recordId,
          submittedById: approvalRequestsTable.submittedById,
          recordRef: approvalRequestsTable.recordRef,
        })
        .from(approvalRequestsTable)
        .where(
          and(
            eq(approvalRequestsTable.id, requestId),
            eq(approvalRequestsTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      if (!reqInfo) {
        throw Object.assign(new Error("Approval request not found"), {
          status: 404,
        });
      }
      const actionResult = await processAction(
        tx,
        t.organizationId,
        requestId,
        t.userId,
        actorRole,
        "reject",
        comment,
      );
      await revertApprovalCallback(
        tx,
        t.organizationId,
        reqInfo.module,
        reqInfo.recordId,
      );
      return { actionResult, reqInfo };
    });

    await writeAuditLog({
      organizationId: t.organizationId,
      userId: t.userId,
      module: "settings",
      action: "approve",
      resourceType: "approval_request",
      resourceId: requestId,
      description: `Rejected request #${requestId}: ${comment}`,
      ipAddress: getClientIp(req),
    });

    createApprovalNotification(
      t.organizationId,
      requestId,
      "rejected",
      `Your request for ${reqInfo.recordRef} was rejected`,
      { submittedById: reqInfo.submittedById },
    );

    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ─── Send back ────────────────────────────────────────────────────────────

router.post("/approval-requests/:id/send-back", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!t.can("approvals", "approve")) {
      res.status(403).json({ error: "You do not have permission to send back transactions" });
      return;
    }

    const requestId = Number(req.params.id);
    const comment = req.body?.comment;
    if (!comment?.trim()) {
      res.status(400).json({ error: "A comment is required when sending back" });
      return;
    }

    const actorRole = normalizeRole(t.role);
    const { actionResult: result, reqInfo } = await db.transaction(async (tx) => {
      const [reqInfo] = await tx
        .select({
          module: approvalRequestsTable.module,
          recordId: approvalRequestsTable.recordId,
          submittedById: approvalRequestsTable.submittedById,
          recordRef: approvalRequestsTable.recordRef,
        })
        .from(approvalRequestsTable)
        .where(
          and(
            eq(approvalRequestsTable.id, requestId),
            eq(approvalRequestsTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);
      if (!reqInfo) {
        throw Object.assign(new Error("Approval request not found"), {
          status: 404,
        });
      }
      const actionResult = await processAction(
        tx,
        t.organizationId,
        requestId,
        t.userId,
        actorRole,
        "send_back",
        comment,
      );
      await revertApprovalCallback(
        tx,
        t.organizationId,
        reqInfo.module,
        reqInfo.recordId,
      );
      return { actionResult, reqInfo };
    });

    await writeAuditLog({
      organizationId: t.organizationId,
      userId: t.userId,
      module: "settings",
      action: "approve",
      resourceType: "approval_request",
      resourceId: requestId,
      description: `Sent back request #${requestId}: ${comment}`,
      ipAddress: getClientIp(req),
    });

    createApprovalNotification(
      t.organizationId,
      requestId,
      "sent_back",
      `Your request for ${reqInfo.recordRef} was sent back for revision`,
      { submittedById: reqInfo.submittedById },
    );

    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ─── Bulk approve ─────────────────────────────────────────────────────────

router.patch("/approval-requests/bulk-approve", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!t.can("approvals", "approve")) {
      res.status(403).json({ error: "You do not have permission to approve transactions" });
      return;
    }

    const ids: number[] = req.body?.ids ?? [];
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids[] is required" });
      return;
    }

    const actorRole = normalizeRole(t.role);
    const results: Array<{ id: number; newStatus: string; error?: string }> = [];

    for (const requestId of ids) {
      try {
        const { result, touchedItemIds } = await db.transaction(async (tx) => {
          const [reqInfo] = await tx
            .select({
              module: approvalRequestsTable.module,
              recordId: approvalRequestsTable.recordId,
            })
            .from(approvalRequestsTable)
            .where(
              and(
                eq(approvalRequestsTable.id, requestId),
                eq(approvalRequestsTable.organizationId, t.organizationId),
              ),
            )
            .limit(1);
          if (!reqInfo) throw Object.assign(new Error("Not found"), { status: 404 });

          const actionResult = await processAction(tx, t.organizationId, requestId, t.userId, actorRole, "approve", undefined);
          let touchedItemIds: number[] = [];
          if (actionResult.isFullyApproved) {
            const cb = await executeApprovalCallback(tx, t.organizationId, reqInfo.module, reqInfo.recordId);
            touchedItemIds = cb.touchedItemIds;
          }
          return { result: actionResult, touchedItemIds };
        });

        for (const itemId of touchedItemIds) {
          pushStockToShopify(t.organizationId, itemId);
        }
        results.push({ id: requestId, newStatus: result.newStatus });
      } catch (err) {
        results.push({ id: requestId, newStatus: "error", error: (err as Error).message });
      }
    }

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// ─── Get approval status for a specific record ───────────────────────────

router.get("/approval-status", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const module = String(req.query.module ?? "");
    const recordId = Number(req.query.recordId);
    if (!module || !recordId) {
      res.status(400).json({ error: "module and recordId are required" });
      return;
    }
    const { getApprovalStatus } = await import("../lib/approvalEngine");
    const status = await getApprovalStatus(t.organizationId, module, recordId);
    res.json({ approval: status });
  } catch (err) {
    next(err);
  }
});

// ─── Approval history for a specific record ──────────────────────────────

router.get("/approval-history", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const module = String(req.query.module ?? "");
    const recordId = Number(req.query.recordId);
    if (!module || !recordId) {
      res.status(400).json({ error: "module and recordId are required" });
      return;
    }

    const requests = await db
      .select()
      .from(approvalRequestsTable)
      .where(
        and(
          eq(approvalRequestsTable.organizationId, t.organizationId),
          eq(approvalRequestsTable.module, module),
          eq(approvalRequestsTable.recordId, recordId),
        ),
      )
      .orderBy(desc(approvalRequestsTable.createdAt));

    if (requests.length === 0) {
      res.json({ requests: [] });
      return;
    }

    const requestIds = requests.map((r) => r.id);
    const actions = await db
      .select()
      .from(approvalActionsTable)
      .where(
        and(
          inArray(approvalActionsTable.requestId, requestIds),
          eq(approvalActionsTable.organizationId, t.organizationId),
        ),
      )
      .orderBy(approvalActionsTable.createdAt);

    // Load actor display names
    const actorIds = Array.from(new Set([
      ...requests.map((r) => r.submittedById),
      ...actions.map((a) => a.actorId),
    ]));
    const userRows = actorIds.length > 0
      ? await db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, actorIds)) // org-scope-allow: loading display names for known actor ids from this org
      : [];
    const userMap = new Map(userRows.map((u) => [u.id, u.name]));

    const actionsByRequest = new Map<number, typeof actions>();
    for (const a of actions) {
      const list = actionsByRequest.get(a.requestId) ?? [];
      list.push(a);
      actionsByRequest.set(a.requestId, list);
    }

    res.json({
      requests: requests.map((req) => ({
        id: req.id,
        status: req.status,
        currentLevel: req.currentLevel,
        totalLevels: req.totalLevels,
        submittedBy: userMap.get(req.submittedById) ?? String(req.submittedById),
        submittedById: req.submittedById,
        createdAt: req.createdAt.toISOString(),
        resolvedAt: req.resolvedAt ? req.resolvedAt.toISOString() : null,
        actions: (actionsByRequest.get(req.id) ?? []).map((a) => ({
          id: a.id,
          actorId: a.actorId,
          actorName: userMap.get(a.actorId) ?? String(a.actorId),
          action: a.action,
          level: a.level,
          comment: a.comment,
          createdAt: a.createdAt.toISOString(),
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
