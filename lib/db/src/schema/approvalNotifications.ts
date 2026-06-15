import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { approvalRequestsTable } from "./approvalRequests";

export const approvalNotificationsTable = pgTable(
  "approval_notifications",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    requestId: integer("request_id")
      .references(() => approvalRequestsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgUserIdx: index("approval_notifications_org_user_idx").on(
      t.organizationId,
      t.userId,
    ),
    orgUserReadIdx: index("approval_notifications_org_user_read_idx").on(
      t.organizationId,
      t.userId,
      t.isRead,
    ),
  }),
);

export type ApprovalNotification = typeof approvalNotificationsTable.$inferSelect;
