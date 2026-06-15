import { and, eq } from "drizzle-orm";
import {
  db,
  approvalNotificationsTable,
  approvalRequestsTable,
  organizationMembersTable,
  approvalWorkflowsTable,
  approvalRulesTable,
  usersTable,
} from "@workspace/db";

export type NotificationType =
  | "new_request"
  | "approved"
  | "rejected"
  | "sent_back"
  | "overdue";

/**
 * Fan-out a notification to all org members who should see it.
 * - new_request: notify designated approvers + admins/owners
 * - approved/rejected/sent_back: notify the submitter
 * Fire-and-forget (does not throw on failure).
 */
export async function createApprovalNotification(
  orgId: number,
  requestId: number,
  type: NotificationType,
  message: string,
  opts?: { submittedById?: number; workflowId?: number | null; currentLevel?: number },
): Promise<void> {
  try {
    // Determine recipient user IDs
    let recipientIds: number[] = [];

    if (type === "new_request") {
      // Notify all admins/owners + designated approver if rule-based
      const memberRows = await db
        .select({ userId: organizationMembersTable.userId, role: organizationMembersTable.role })
        .from(organizationMembersTable)
        .where(eq(organizationMembersTable.organizationId, orgId));

      const adminIds = memberRows
        .filter((m) => m.role === "owner" || m.role === "admin")
        .map((m) => m.userId);

      let ruleUserIds: number[] = [];
      if (opts?.workflowId && opts?.currentLevel !== undefined) {
        const rules = await db
          .select()
          .from(approvalRulesTable) // org-scope-allow: workflowId already org-scoped via FK
          .where(
            and(
              eq(approvalRulesTable.workflowId, opts.workflowId),
              eq(approvalRulesTable.levelIndex, opts.currentLevel),
            ),
          )
          .limit(1);
        const rule = rules[0];
        if (rule?.approverType === "user") {
          ruleUserIds = [Number(rule.approverValue)];
        }
      }

      recipientIds = Array.from(new Set([...adminIds, ...ruleUserIds]));
    } else if (
      type === "approved" ||
      type === "rejected" ||
      type === "sent_back"
    ) {
      // Notify the original submitter
      if (opts?.submittedById) {
        recipientIds = [opts.submittedById];
      } else {
        const rows = await db
          .select({ submittedById: approvalRequestsTable.submittedById })
          .from(approvalRequestsTable)
          .where(
            and(
              eq(approvalRequestsTable.id, requestId),
              eq(approvalRequestsTable.organizationId, orgId),
            ),
          )
          .limit(1);
        if (rows[0]) recipientIds = [rows[0].submittedById];
      }
    } else if (type === "overdue") {
      // Notify all admins/owners
      const memberRows = await db
        .select({ userId: organizationMembersTable.userId, role: organizationMembersTable.role })
        .from(organizationMembersTable)
        .where(eq(organizationMembersTable.organizationId, orgId));
      recipientIds = memberRows
        .filter((m) => m.role === "owner" || m.role === "admin")
        .map((m) => m.userId);
    }

    if (recipientIds.length === 0) return;

    await db.insert(approvalNotificationsTable).values(
      recipientIds.map((uid) => ({
        organizationId: orgId,
        userId: uid,
        requestId,
        type,
        message,
      })),
    );
  } catch {
    // Fire-and-forget — never throw
  }
}
