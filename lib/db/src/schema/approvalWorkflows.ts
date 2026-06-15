import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const approvalWorkflowsTable = pgTable(
  "approval_workflows",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    slaThresholdDays: integer("sla_threshold_days").notNull().default(3),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgModuleUniq: uniqueIndex("approval_workflows_org_module_idx").on(
      t.organizationId,
      t.module,
    ),
    orgIdx: index("approval_workflows_org_idx").on(t.organizationId),
  }),
);

export const approvalRulesTable = pgTable(
  "approval_rules",
  {
    id: serial("id").primaryKey(),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => approvalWorkflowsTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    levelIndex: integer("level_index").notNull(),
    approverType: text("approver_type").notNull().default("role"),
    approverValue: text("approver_value").notNull(),
    minAmount: numeric("min_amount", { precision: 14, scale: 2 }),
    maxAmount: numeric("max_amount", { precision: 14, scale: 2 }),
    slaHours: integer("sla_hours"),
  },
  (t) => ({
    workflowLevelUniq: uniqueIndex("approval_rules_workflow_level_idx").on(
      t.workflowId,
      t.levelIndex,
    ),
    orgIdx: index("approval_rules_org_idx").on(t.organizationId),
  }),
);

export type ApprovalWorkflow = typeof approvalWorkflowsTable.$inferSelect;
export type ApprovalRule = typeof approvalRulesTable.$inferSelect;
