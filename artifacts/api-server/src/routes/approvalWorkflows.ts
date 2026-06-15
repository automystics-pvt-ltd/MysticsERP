import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  approvalWorkflowsTable,
  approvalRulesTable,
  approvalRequestsTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { APPROVABLE_MODULES, type ApprovalModule } from "../lib/approvalEngine";

const router: IRouter = Router();
router.use(tenantMiddleware);

function requireAdmin(req: Parameters<typeof tenantMiddleware>[0], res: Parameters<typeof tenantMiddleware>[1]): boolean {
  const role = req.tenant!.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can manage approval workflows" });
    return false;
  }
  return true;
}

async function loadWorkflowWithRules(orgId: number, workflowId: number) {
  const rows = await db
    .select()
    .from(approvalWorkflowsTable)
    .where(
      and(
        eq(approvalWorkflowsTable.id, workflowId),
        eq(approvalWorkflowsTable.organizationId, orgId),
      ),
    )
    .limit(1);
  const wf = rows[0];
  if (!wf) return null;
  const rules = await db
    .select()
    .from(approvalRulesTable)
    .where(
      and(
        eq(approvalRulesTable.workflowId, workflowId),
        eq(approvalRulesTable.organizationId, orgId),
      ),
    )
    .orderBy(approvalRulesTable.levelIndex);
  return { ...wf, rules };
}

router.get("/approval-workflows", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const workflows = await db
      .select()
      .from(approvalWorkflowsTable)
      .where(eq(approvalWorkflowsTable.organizationId, t.organizationId))
      .orderBy(approvalWorkflowsTable.module);

    if (workflows.length === 0) {
      res.json({ workflows: [] });
      return;
    }

    const workflowIds = workflows.map((w) => w.id);
    const allRules = await db
      .select()
      .from(approvalRulesTable)
      .where(
        and(
          inArray(approvalRulesTable.workflowId, workflowIds),
          eq(approvalRulesTable.organizationId, t.organizationId),
        ),
      )
      .orderBy(approvalRulesTable.workflowId, approvalRulesTable.levelIndex);

    const rulesByWorkflow = new Map<number, typeof allRules>();
    for (const rule of allRules) {
      const list = rulesByWorkflow.get(rule.workflowId) ?? [];
      list.push(rule);
      rulesByWorkflow.set(rule.workflowId, list);
    }

    res.json({
      workflows: workflows.map((wf) => ({
        ...wf,
        rules: rulesByWorkflow.get(wf.id) ?? [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/approval-workflows", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireAdmin(req, res)) return;

    const b = req.body ?? {};
    const module = String(b.module ?? "").trim() as ApprovalModule;
    if (!APPROVABLE_MODULES.includes(module)) {
      res.status(400).json({ error: "Invalid module. Must be one of: " + APPROVABLE_MODULES.join(", ") });
      return;
    }
    const name = String(b.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const rules = Array.isArray(b.rules) ? b.rules : [];
    if (rules.length === 0) {
      res.status(400).json({ error: "At least one approval level is required" });
      return;
    }
    const slaThresholdDays = Number.isFinite(Number(b.slaThresholdDays)) ? Math.max(1, Number(b.slaThresholdDays)) : 3;
    const isEnabled = b.isEnabled !== false;

    const [inserted] = await db
      .insert(approvalWorkflowsTable)
      .values({
        organizationId: t.organizationId,
        module,
        name,
        isEnabled,
        slaThresholdDays,
      })
      .returning()
      .onConflictDoNothing();

    if (!inserted) {
      res.status(409).json({ error: "A workflow for this module already exists" });
      return;
    }

    if (rules.length > 0) {
      await db.insert(approvalRulesTable).values(
        rules.slice(0, 5).map((r: { approverType?: string; approverValue?: string; minAmount?: string; maxAmount?: string; slaHours?: number | string }, i: number) => ({
          workflowId: inserted.id,
          organizationId: t.organizationId,
          levelIndex: i,
          approverType: String(r.approverType ?? "role"),
          approverValue: String(r.approverValue ?? "manager"),
          minAmount: r.minAmount ? String(r.minAmount) : null,
          maxAmount: r.maxAmount ? String(r.maxAmount) : null,
          slaHours: r.slaHours != null && Number.isFinite(Number(r.slaHours)) && Number(r.slaHours) > 0
            ? Math.round(Number(r.slaHours))
            : null,
        })),
      );
    }

    const result = await loadWorkflowWithRules(t.organizationId, inserted.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/approval-workflows/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const result = await loadWorkflowWithRules(t.organizationId, id);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch("/approval-workflows/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireAdmin(req, res)) return;

    const id = Number(req.params.id);
    const existing = await loadWorkflowWithRules(t.organizationId, id);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const b = req.body ?? {};
    const update: Partial<typeof approvalWorkflowsTable.$inferInsert> = {};
    if (typeof b.name === "string" && b.name.trim()) update.name = b.name.trim();
    if (typeof b.isEnabled === "boolean") update.isEnabled = b.isEnabled;
    if (Number.isFinite(Number(b.slaThresholdDays))) {
      update.slaThresholdDays = Math.max(1, Number(b.slaThresholdDays));
    }

    await db
      .update(approvalWorkflowsTable)
      .set(update)
      .where(
        and(
          eq(approvalWorkflowsTable.id, id),
          eq(approvalWorkflowsTable.organizationId, t.organizationId),
        ),
      );

    // Replace rules if provided
    if (Array.isArray(b.rules)) {
      if (b.rules.length === 0) {
        res.status(400).json({ error: "At least one approval level is required" });
        return;
      }
      await db
        .delete(approvalRulesTable)
        .where(
          and(
            eq(approvalRulesTable.workflowId, id),
            eq(approvalRulesTable.organizationId, t.organizationId),
          ),
        );
      await db.insert(approvalRulesTable).values(
        b.rules.slice(0, 5).map((r: { approverType?: string; approverValue?: string; minAmount?: string; maxAmount?: string; slaHours?: number | string }, i: number) => ({
          workflowId: id,
          organizationId: t.organizationId,
          levelIndex: i,
          approverType: String(r.approverType ?? "role"),
          approverValue: String(r.approverValue ?? "manager"),
          minAmount: r.minAmount ? String(r.minAmount) : null,
          maxAmount: r.maxAmount ? String(r.maxAmount) : null,
          slaHours: r.slaHours != null && Number.isFinite(Number(r.slaHours)) && Number(r.slaHours) > 0
            ? Math.round(Number(r.slaHours))
            : null,
        })),
      );
    }

    const result = await loadWorkflowWithRules(t.organizationId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete("/approval-workflows/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    if (!requireAdmin(req, res)) return;

    const id = Number(req.params.id);
    const rows = await db
      .select({ id: approvalWorkflowsTable.id })
      .from(approvalWorkflowsTable)
      .where(
        and(
          eq(approvalWorkflowsTable.id, id),
          eq(approvalWorkflowsTable.organizationId, t.organizationId),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Block deletion if there are any pending approval requests for this workflow
    const pendingRows = await db
      .select({ id: approvalRequestsTable.id })
      .from(approvalRequestsTable)
      .where(
        and(
          eq(approvalRequestsTable.organizationId, t.organizationId),
          eq(approvalRequestsTable.workflowId, id),
          eq(approvalRequestsTable.status, "pending"),
        ),
      )
      .limit(1);
    if (pendingRows[0]) {
      res.status(409).json({
        error: "Cannot delete a workflow with pending approval requests. Resolve or reject them first.",
      });
      return;
    }

    await db
      .delete(approvalWorkflowsTable)
      .where(
        and(
          eq(approvalWorkflowsTable.id, id),
          eq(approvalWorkflowsTable.organizationId, t.organizationId),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
