import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const printLogTable = pgTable("print_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  documentId: integer("document_id"),
  printedAt: timestamp("printed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PrintLog = typeof printLogTable.$inferSelect;
