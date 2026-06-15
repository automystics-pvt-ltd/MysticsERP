import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { approvalWorkflowsTable } from "./approvalWorkflows";

export const approvalRequestsTable = pgTable(
  "approval_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    workflowId: integer("workflow_id")
      .references(() => approvalWorkflowsTable.id, { onDelete: "set null" }),
    module: text("module").notNull(),
    recordId: integer("record_id").notNull(),
    recordRef: text("record_ref").notNull(),
    currentLevel: integer("current_level").notNull().default(0),
    totalLevels: integer("total_levels").notNull().default(1),
    status: text("status").notNull().default("pending"),
    submittedById: integer("submitted_by_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    orgModuleRecordIdx: index("approval_requests_org_module_record_idx").on(
      t.organizationId,
      t.module,
      t.recordId,
    ),
    orgStatusIdx: index("approval_requests_org_status_idx").on(
      t.organizationId,
      t.status,
    ),
    orgCreatedIdx: index("approval_requests_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  }),
);

export const approvalActionsTable = pgTable(
  "approval_actions",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => approvalRequestsTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    level: integer("level").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index("approval_actions_request_idx").on(t.requestId),
    orgIdx: index("approval_actions_org_idx").on(t.organizationId),
    orgCreatedIdx: index("approval_actions_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  }),
);

export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
export type ApprovalAction = typeof approvalActionsTable.$inferSelect;
