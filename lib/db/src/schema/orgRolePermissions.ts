import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const orgRolePermissionsTable = pgTable(
  "org_role_permissions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    module: text("module").notNull(),
    action: text("action").notNull(),
    granted: boolean("granted").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("org_role_permissions_uniq").on(
      t.organizationId,
      t.role,
      t.module,
      t.action,
    ),
  }),
);

export type OrgRolePermission =
  typeof orgRolePermissionsTable.$inferSelect;
