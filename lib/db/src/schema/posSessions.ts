import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { warehousesTable } from "./warehouses";
import { usersTable } from "./users";

export const posCountersTable = pgTable(
  "pos_counters",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    orgCode: uniqueIndex("pos_counters_org_code_idx").on(t.organizationId, t.code),
    orgWarehouseIdx: index("pos_counters_org_warehouse_idx").on(t.organizationId, t.warehouseId),
  }),
);

export const posSessionsTable = pgTable(
  "pos_sessions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    counterId: integer("counter_id").references(() => posCountersTable.id, {
      onDelete: "set null",
    }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    cashierId: integer("cashier_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    sessionNumber: text("session_number").notNull(),
    status: text("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    openingCash: numeric("opening_cash", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    closingCash: numeric("closing_cash", { precision: 14, scale: 2 }),
    notes: text("notes"),
    approvedById: integer("approved_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalRemarks: text("approval_remarks"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgNumber: uniqueIndex("pos_sessions_org_number_idx").on(t.organizationId, t.sessionNumber),
    orgWhStatus: index("pos_sessions_org_wh_status_idx").on(
      t.organizationId,
      t.warehouseId,
      t.status,
    ),
    orgCashier: index("pos_sessions_org_cashier_idx").on(t.organizationId, t.cashierId),
  }),
);

export const posSessionExpensesTable = pgTable(
  "pos_session_expenses",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => posSessionsTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    category: text("category"),
    createdById: integer("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("pos_session_expenses_session_idx").on(t.sessionId),
    orgIdx: index("pos_session_expenses_org_idx").on(t.organizationId),
  }),
);

export const posSessionAuditLogsTable = pgTable(
  "pos_session_audit_logs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => posSessionsTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    performedByUserId: integer("performed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    performedByName: text("performed_by_name"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("pos_session_audit_logs_session_idx").on(t.sessionId),
    orgIdx: index("pos_session_audit_logs_org_idx").on(t.organizationId),
  }),
);

export type PosCounter = typeof posCountersTable.$inferSelect;
export type PosSession = typeof posSessionsTable.$inferSelect;
export type PosSessionExpense = typeof posSessionExpensesTable.$inferSelect;
export type PosSessionAuditLog = typeof posSessionAuditLogsTable.$inferSelect;
