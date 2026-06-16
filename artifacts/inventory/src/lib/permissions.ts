/**
 * Client-side mirror of `artifacts/api-server/src/lib/permissions.ts`.
 *
 * The server is the authoritative source of truth — it will 403 anything we
 * get wrong here. These helpers exist only to:
 *  1. Pre-filter nav items so users don't get a flash of forbidden content.
 *  2. Map URL paths to RBAC module keys for the RoleGate page guard.
 *
 * Module groups, applicable actions, and module/action labels are now served
 * dynamically from the backend (/api/permissions/me and /api/role-permissions)
 * so new modules appear everywhere automatically without frontend changes.
 */

export const ROLE_VALUES = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "salesman",
  "viewer",
] as const;

export type Role = (typeof ROLE_VALUES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  accountant: "Accountant",
  salesman: "Salesman",
  viewer: "Viewer",
};

export function normalizeRole(raw: string | null | undefined): Role {
  if (!raw) return "viewer";
  const r = raw.trim().toLowerCase();
  if (r === "member") return "manager"; // legacy alias
  if ((ROLE_VALUES as readonly string[]).includes(r)) return r as Role;
  return "viewer";
}

/**
 * Maps a URL path to its RBAC module key.
 *
 * This table is the single client-side registry that ties frontend routes to
 * permission modules. When a new module + page is added:
 *   1. Add the module to MODULES in api-server/src/lib/permissions.ts (backend).
 *   2. Add the route pattern here so RoleGate can enforce it.
 *
 * Returns null for paths that don't correspond to a restricted module
 * (e.g. /accept-invitation, /admin — those are gated by other means).
 * Callers should allow null paths through.
 */
const PATH_MODULE_MAP: Array<{ pattern: RegExp; module: string }> = [
  { pattern: /^\/dashboard(\/|$)/, module: "dashboard" },
  { pattern: /^\/items(\/|$)/, module: "items" },
  { pattern: /^\/barcodes(\/|$)/, module: "barcodes" },
  { pattern: /^\/warehouses(\/|$)/, module: "warehouses" },
  { pattern: /^\/write-offs(\/|$)/, module: "write_offs" },
  { pattern: /^\/fulfillments(\/|$)/, module: "sales_orders" },
  { pattern: /^\/sales-orders(\/|$)/, module: "sales_orders" },
  { pattern: /^\/customers(\/|$)/, module: "customers" },
  { pattern: /^\/pos(\/|$)/, module: "pos" },
  { pattern: /^\/payments(\/|$)/, module: "payments" },
  { pattern: /^\/purchase-orders(\/|$)/, module: "purchase_orders" },
  { pattern: /^\/suppliers(\/|$)/, module: "suppliers" },
  { pattern: /^\/supplier-payments(\/|$)/, module: "supplier_payments" },
  { pattern: /^\/transfers(\/|$)/, module: "stock_transfers" },
  { pattern: /^\/job-work(\/|$)/, module: "job_work" },
  { pattern: /^\/approvals(\/|$)/, module: "approvals" },
  { pattern: /^\/reports(\/|$)/, module: "reports" },
  { pattern: /^\/team(\/|$)/, module: "team" },
  { pattern: /^\/integrations(\/|$)/, module: "integrations" },
  { pattern: /^\/settings\/roles(\/|$)/, module: "roles" },
  { pattern: /^\/settings\/audit-log(\/|$)/, module: "settings" },
  { pattern: /^\/settings(\/|$)/, module: "settings" },
];

export function pathToModule(path: string): string | null {
  for (const entry of PATH_MODULE_MAP) {
    if (entry.pattern.test(path)) return entry.module;
  }
  return null;
}
