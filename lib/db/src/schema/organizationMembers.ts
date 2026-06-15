import { pgTable, serial, integer, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    canEditBills: boolean("can_edit_bills").notNull().default(false),
    canEditStocks: boolean("can_edit_stocks").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("org_members_user_org_idx").on(t.userId, t.organizationId),
  }),
);

export type OrganizationMember = typeof organizationMembersTable.$inferSelect;
