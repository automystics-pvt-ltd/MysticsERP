import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  approvalWorkflowsTable,
  approvalRulesTable,
  approvalRequestsTable,
  approvalActionsTable,
  organizationMembersTable,
} from "@workspace/db";

export type ApprovalModule =
  | "purchase_orders"
  | "stock_transfers"
  | "supplier_payments"
  | "write_offs"
  | "goods_receipts";

export const APPROVABLE_MODULES: ApprovalModule[] = [
  "purchase_orders",
  "stock_transfers",
  "supplier_payments",
  "write_offs",
  "goods_receipts",
];

export const APPROVABLE_MODULE_LABELS: Record<ApprovalModule, string> = {
  purchase_orders: "Purchase Orders",
  stock_transfers: "Stock Transfers",
  supplier_payments: "Supplier Payments",
  write_offs: "Write-offs",
  goods_receipts: "Goods Receipts (GRN)",
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "sent_back";

export interface ActiveApproval {
  requestId: number;
  status: ApprovalStatus;
  currentLevel: number;
  totalLevels: number;
  isOverdue: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getEnabledWorkflow(orgId: number, module: string) {
  const rows = await db
    .select()
    .from(approvalWorkflowsTable)
    .where(
      and(
        eq(approvalWorkflowsTable.organizationId, orgId),
        eq(approvalWorkflowsTable.module, module),
        eq(approvalWorkflowsTable.isEnabled, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getWorkflowRules(workflowId: number) {
  return db
    .select()
    .from(approvalRulesTable) // org-scope-allow: workflowId FK guarantees org isolation — workflow was already fetched with org check
    .where(eq(approvalRulesTable.workflowId, workflowId))
    .orderBy(approvalRulesTable.levelIndex);
}

/**
 * Submit a transaction for approval. Returns null if no workflow is configured
 * for this module (caller should proceed without approval). Returns the new
 * approval_request row if approval is required.
 *
 * When `amount` is provided, rules with a minAmount/maxAmount constraint are
 * filtered so only levels whose range includes the amount participate. If no
 * rules remain after filtering, the record is below all thresholds and null is
 * returned (no approval required).
 */
export async function submitForApproval(
  tx: Tx,
  orgId: number,
  module: string,
  recordId: number,
  recordRef: string,
  submittedById: number,
  amount?: number | null,
): Promise<{ requestId: number; totalLevels: number } | null> {
  const workflow = await getEnabledWorkflow(orgId, module);
  if (!workflow) return null;

  const allRules = await getWorkflowRules(workflow.id);
  if (allRules.length === 0) return null;

  // Filter by amount thresholds when a monetary amount is provided
  const rules = amount != null
    ? allRules.filter((r) => {
        const min = r.minAmount != null ? Number(r.minAmount) : null;
        const max = r.maxAmount != null ? Number(r.maxAmount) : null;
        if (min != null && amount < min) return false;
        if (max != null && amount > max) return false;
        return true;
      })
    : allRules;

  if (rules.length === 0) return null;

  const [inserted] = await tx
    .insert(approvalRequestsTable)
    .values({
      organizationId: orgId,
      workflowId: workflow.id,
      module,
      recordId,
      recordRef,
      currentLevel: 0,
      totalLevels: rules.length,
      status: "pending",
      submittedById,
    })
    .returning();

  return { requestId: inserted!.id, totalLevels: rules.length };
}

/**
 * Check whether a given module + record currently has an active (pending)
 * approval request. Returns the request details if so, null if none.
 */
export async function getApprovalStatus(
  orgId: number,
  module: string,
  recordId: number,
): Promise<ActiveApproval | null> {
  const rows = await db
    .select()
    .from(approvalRequestsTable)
    .where(
      and(
        eq(approvalRequestsTable.organizationId, orgId),
        eq(approvalRequestsTable.module, module),
        eq(approvalRequestsTable.recordId, recordId),
      ),
    )
    .orderBy(desc(approvalRequestsTable.createdAt))
    .limit(1);

  const req = rows[0];
  if (!req) return null;

  // Determine SLA overdue
  let isOverdue = false;
  if (req.status === "pending") {
    const workflow = req.workflowId
      ? await db
          .select({ slaThresholdDays: approvalWorkflowsTable.slaThresholdDays })
          .from(approvalWorkflowsTable)
          .where(
            and(
              eq(approvalWorkflowsTable.id, req.workflowId),
              eq(approvalWorkflowsTable.organizationId, orgId),
            ),
          )
          .limit(1)
          .then((r) => r[0])
      : null;
    if (workflow) {
      const ageMs = Date.now() - req.createdAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      isOverdue = ageDays > workflow.slaThresholdDays;
    }
  }

  return {
    requestId: req.id,
    status: req.status as ApprovalStatus,
    currentLevel: req.currentLevel,
    totalLevels: req.totalLevels,
    isOverdue,
    createdAt: req.createdAt.toISOString(),
    resolvedAt: req.resolvedAt ? req.resolvedAt.toISOString() : null,
  };
}

/**
 * Validate that the given actor (userId + role) is entitled to act on the
 * current approval level. Returns the matching rule or throws a 403 error.
 */
async function validateActorForLevel(
  orgId: number,
  workflowId: number | null,
  currentLevel: number,
  actorId: number,
  actorRole: string,
): Promise<void> {
  if (!workflowId) {
    // No workflow attached — any user with approve permission can act
    return;
  }

  const rules = await getWorkflowRules(workflowId);
  const rule = rules.find((r) => r.levelIndex === currentLevel);
  if (!rule) {
    // No rule for this level — any approver can act
    return;
  }

  let authorized = false;
  if (rule.approverType === "role") {
    authorized = actorRole === rule.approverValue;
    // owner and admin can always approve any level
    if (actorRole === "owner" || actorRole === "admin") authorized = true;
  } else {
    // user type — match by userId
    authorized = String(actorId) === rule.approverValue;
  }

  if (!authorized) {
    const err = new Error(
      "You are not the designated approver for this level",
    ) as Error & { status?: number };
    err.status = 403;
    throw err;
  }
}

export type ApprovalActionType = "approve" | "reject" | "send_back";

/**
 * Process an approval action (approve / reject / send_back).
 * Returns the new status of the request after the action.
 */
export async function processAction(
  tx: Tx,
  orgId: number,
  requestId: number,
  actorId: number,
  actorRole: string,
  action: ApprovalActionType,
  comment: string | undefined,
): Promise<{ newStatus: ApprovalStatus; isFullyApproved: boolean }> {
  // Load request with a row lock to prevent concurrent approval races
  const rows = await tx
    .select()
    .from(approvalRequestsTable)
    .where(
      and(
        eq(approvalRequestsTable.id, requestId),
        eq(approvalRequestsTable.organizationId, orgId),
      ),
    )
    .for("update")
    .limit(1);

  const req = rows[0];
  if (!req) {
    const err = new Error("Approval request not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (req.status !== "pending") {
    const err = new Error(
      `This approval request is already ${req.status}`,
    ) as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  // Reject and send_back require a comment
  if ((action === "reject" || action === "send_back") && !comment?.trim()) {
    const err = new Error(
      "A comment is required when rejecting or sending back",
    ) as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  // Validate the actor is allowed to act on this level
  await validateActorForLevel(
    orgId,
    req.workflowId ?? null,
    req.currentLevel,
    actorId,
    actorRole,
  );

  // Record the action
  await tx.insert(approvalActionsTable).values({
    requestId,
    organizationId: orgId,
    actorId,
    action,
    level: req.currentLevel,
    comment: comment?.trim() ?? null,
  });

  let newStatus: ApprovalStatus;
  let isFullyApproved = false;
  const nextLevel = req.currentLevel + 1;

  if (action === "approve") {
    if (nextLevel >= req.totalLevels) {
      // All levels approved
      newStatus = "approved";
      isFullyApproved = true;
      await tx
        .update(approvalRequestsTable)
        .set({ status: "approved", resolvedAt: new Date() })
        .where(
          and(
            eq(approvalRequestsTable.id, requestId),
            eq(approvalRequestsTable.organizationId, orgId),
          ),
        );
    } else {
      // Advance to next level
      newStatus = "pending";
      await tx
        .update(approvalRequestsTable)
        .set({ currentLevel: nextLevel })
        .where(
          and(
            eq(approvalRequestsTable.id, requestId),
            eq(approvalRequestsTable.organizationId, orgId),
          ),
        );
    }
  } else {
    newStatus = action === "reject" ? "rejected" : "sent_back";
    await tx
      .update(approvalRequestsTable)
      .set({ status: newStatus, resolvedAt: new Date() })
      .where(
        and(
          eq(approvalRequestsTable.id, requestId),
          eq(approvalRequestsTable.organizationId, orgId),
        ),
      );
  }

  return { newStatus, isFullyApproved };
}

/**
 * Load the full approval request detail (with actions + actor names).
 */
export async function loadApprovalRequestDetail(
  orgId: number,
  requestId: number,
) {
  const rows = await db
    .select()
    .from(approvalRequestsTable)
    .where(
      and(
        eq(approvalRequestsTable.id, requestId),
        eq(approvalRequestsTable.organizationId, orgId),
      ),
    )
    .limit(1);

  const req = rows[0];
  if (!req) return null;

  const actions = await db
    .select()
    .from(approvalActionsTable)
    .where(
      and(
        eq(approvalActionsTable.requestId, requestId),
        eq(approvalActionsTable.organizationId, orgId),
      ),
    )
    .orderBy(approvalActionsTable.createdAt);

  // Load actor names
  const actorIds = Array.from(new Set(actions.map((a) => a.actorId)));
  const memberRows =
    actorIds.length > 0
      ? await db
          .select({
            userId: organizationMembersTable.userId,
            name: organizationMembersTable.userId,
          })
          .from(organizationMembersTable)
          .where(
            and(
              eq(organizationMembersTable.organizationId, orgId),
              inArray(organizationMembersTable.userId, actorIds),
            ),
          )
      : [];
  const memberMap = new Map(memberRows.map((m) => [m.userId, m.name]));

  return {
    id: req.id,
    module: req.module,
    recordId: req.recordId,
    recordRef: req.recordRef,
    currentLevel: req.currentLevel,
    totalLevels: req.totalLevels,
    status: req.status,
    submittedById: req.submittedById,
    createdAt: req.createdAt.toISOString(),
    resolvedAt: req.resolvedAt ? req.resolvedAt.toISOString() : null,
    actions: actions.map((a) => ({
      id: a.id,
      actorId: a.actorId,
      actorName: memberMap.get(a.actorId) ?? a.actorId,
      action: a.action,
      level: a.level,
      comment: a.comment,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
