import { db, auditLogsTable } from "@workspace/db";
import type { Module, Action } from "./permissions";
import type { Request } from "express";

// Audit events can record internal team operations that aren't RBAC actions.
type AuditAction = Action | "activate" | "suspend" | "reset_password";

export interface AuditEvent {
  organizationId: number;
  userId: number;
  module: Module;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string | number;
  description?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
}

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      organizationId: event.organizationId,
      userId: event.userId,
      module: event.module,
      action: event.action,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId != null ? String(event.resourceId) : null,
      description: event.description ?? null,
      changes: event.changes ?? null,
      ipAddress: event.ipAddress ?? null,
    });
  } catch {
    // Audit failures must never break the main flow
  }
}

export function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown"
  );
}
