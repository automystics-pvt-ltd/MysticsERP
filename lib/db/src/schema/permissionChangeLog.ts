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

export const permissionChangeLogTable = pgTable(
  "permission_change_log",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    module: text("module").notNull(),
    action: text("action").notNull(),
    oldGranted: boolean("old_granted"),
    newGranted: boolean("new_granted"),
    isReset: boolean("is_reset").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("permission_change_log_org_idx").on(t.organizationId),
    orgCreatedIdx: index("permission_change_log_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  }),
);

export type PermissionChangeLog =
  typeof permissionChangeLogTable.$inferSelect;
