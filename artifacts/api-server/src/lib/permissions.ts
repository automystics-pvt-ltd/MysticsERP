/**
 * Role-based access control — comprehensive module × action permission matrix.
 *
 * Architecture:
 *  1. DEFAULT_PERMISSIONS defines what each built-in role can do by default.
 *  2. Per-org overrides are stored in `org_role_permissions` (DB) and merged
 *     at runtime by resolvePermissions(), which caches the result for 5 min.
 *  3. tenantMiddleware attaches the resolved Set<"module.action"> to req.tenant
 *     so route handlers can call req.tenant.can(module, action) synchronously.
 *
 * Legacy two-flag overrides (canEditBills, canEditStocks) still exist on
 * organization_members for backwards compat but the new system supersedes them.
 */

import { db, orgRolePermissionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ─── Role ──────────────────────────────────────────────────────────────────

export const ROLE_VALUES = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "salesman",
  "viewer",
] as const;

export type Role = (typeof ROLE_VALUES)[number];

export const ALL_ROLES: readonly Role[] = ROLE_VALUES;
export const ADMIN_ROLES: readonly Role[] = ["owner", "admin"];
export const MANAGER_AND_UP: readonly Role[] = ["owner", "admin", "manager"];
export const ACCOUNTING_AND_UP: readonly Role[] = [
  "owner",
  "admin",
  "manager",
  "accountant",
];
export const SALES_AND_UP: readonly Role[] = [
  "owner",
  "admin",
  "manager",
  "salesman",
];

export function normalizeRole(raw: string | null | undefined): Role {
  if (!raw) return "viewer";
  const r = raw.trim().toLowerCase();
  if (r === "member") return "manager";
  if ((ROLE_VALUES as readonly string[]).includes(r)) return r as Role;
  return "viewer";
}

// ─── Modules & Actions ─────────────────────────────────────────────────────

export const MODULES = [
  "dashboard",
  "items",
  "warehouses",
  "barcodes",
  "write_offs",
  "sales_orders",
  "customers",
  "pos",
  "payments",
  "purchase_orders",
  "suppliers",
  "supplier_payments",
  "stock_transfers",
  "job_work",
  "approvals",
  "reports",
  "team",
  "integrations",
  "settings",
  "roles",
] as const;

export type Module = (typeof MODULES)[number];

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "transfer",
  "import",
  "export",
  "print",
  "settings",
] as const;

export type Action = (typeof ACTIONS)[number];

export type PermissionKey = `${Module}.${Action}`;

// ─── Module metadata (for UI) ──────────────────────────────────────────────

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  items: "Items",
  warehouses: "Warehouses",
  barcodes: "Barcodes",
  write_offs: "Write-offs",
  sales_orders: "Sales Orders",
  customers: "Customers",
  pos: "Point of Sale",
  payments: "Customer Payments",
  purchase_orders: "Purchase Orders",
  suppliers: "Suppliers",
  supplier_payments: "Supplier Payments",
  stock_transfers: "Stock Transfers",
  job_work: "Job Work",
  approvals: "Approvals",
  reports: "Reports",
  team: "Team",
  integrations: "Integrations",
  settings: "Settings",
  roles: "Roles & Permissions",
};

export const ACTION_LABELS: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  transfer: "Transfer",
  import: "Import",
  export: "Export",
  print: "Print",
  settings: "Settings",
};

// ─── Module groups (drives Roles & Permissions UI layout) ──────────────────
// Any module added to MODULES that isn't listed here will auto-appear in
// an "Other" group in the UI — no frontend code change required.

export const MODULE_GROUPS: ReadonlyArray<{
  label: string;
  modules: readonly Module[];
}> = [
  { label: "Overview",   modules: ["dashboard"] },
  { label: "Inventory",  modules: ["items", "warehouses", "barcodes", "write_offs"] },
  { label: "Sales",      modules: ["sales_orders", "customers", "pos", "payments"] },
  { label: "Purchasing", modules: ["purchase_orders", "suppliers", "supplier_payments"] },
  { label: "Operations", modules: ["stock_transfers", "job_work"] },
  { label: "Approvals",  modules: ["approvals"] },
  { label: "Insights",   modules: ["reports"] },
  { label: "Workspace",  modules: ["team", "integrations", "settings", "roles"] },
];

// ─── Applicable actions per module (drives which toggles show in UI) ───────
// Only actions that make semantic sense for the module are listed here.
// Non-applicable actions are still enforced by the backend if somehow set;
// the UI simply doesn't show toggles for them, keeping the matrix clean.

export const MODULE_APPLICABLE_ACTIONS: Record<Module, readonly Action[]> = {
  dashboard:         ["view"],
  items:             ["view", "create", "edit", "delete", "import", "export", "print"],
  warehouses:        ["view", "create", "edit", "delete", "settings"],
  barcodes:          ["view", "create", "export", "print"],
  write_offs:        ["view", "create"],
  sales_orders:      ["view", "create", "edit", "delete", "approve", "export", "print"],
  customers:         ["view", "create", "edit", "delete", "import", "export"],
  pos:               ["view", "create", "edit", "approve", "settings"],
  payments:          ["view", "create", "edit", "delete", "export", "print"],
  purchase_orders:   ["view", "create", "edit", "delete", "approve", "export", "print"],
  suppliers:         ["view", "create", "edit", "delete", "import", "export"],
  supplier_payments: ["view", "create", "edit", "delete", "export", "print"],
  stock_transfers:   ["view", "create", "edit", "delete", "transfer", "print"],
  job_work:          ["view", "create", "edit", "delete", "approve", "transfer"],
  approvals:         ["view", "create", "edit", "approve", "settings"],
  reports:           ["view", "export", "print"],
  team:              ["view", "create", "edit", "delete", "settings"],
  integrations:      ["view", "settings"],
  settings:          ["view", "settings"],
  roles:             ["view", "settings"],
};

// ─── Default permission matrix ─────────────────────────────────────────────

const ALL_ACTIONS: Action[] = [...ACTIONS];

function all(modules: Module[]): PermissionKey[] {
  return modules.flatMap((m) => ALL_ACTIONS.map((a) => `${m}.${a}` as PermissionKey));
}

function perms(module: Module, actions: Action[]): PermissionKey[] {
  return actions.map((a) => `${module}.${a}` as PermissionKey);
}

export const DEFAULT_PERMISSIONS: Record<Role, Set<PermissionKey>> = {
  owner: new Set(all(MODULES as unknown as Module[])),
  admin: new Set(all(MODULES as unknown as Module[])),
  manager: new Set<PermissionKey>([
    // Dashboard
    ...perms("dashboard", ["view"]),
    // Items
    ...perms("items", ["view", "create", "edit", "delete", "import", "export", "print"]),
    // Warehouses
    ...perms("warehouses", ["view", "create", "edit", "delete", "settings"]),
    // Barcodes
    ...perms("barcodes", ["view", "create", "export", "print"]),
    // Write-offs
    ...perms("write_offs", ["view", "create"]),
    // Sales
    ...perms("sales_orders", ["view", "create", "edit", "delete", "approve", "export", "print"]),
    ...perms("customers", ["view", "create", "edit", "delete", "import", "export"]),
    ...perms("pos", ["view", "create", "edit", "approve", "settings"]),
    ...perms("payments", ["view", "create", "edit", "print"]),
    // Purchasing
    ...perms("purchase_orders", ["view", "create", "edit", "delete", "approve", "export", "print"]),
    ...perms("suppliers", ["view", "create", "edit", "delete", "import", "export"]),
    ...perms("supplier_payments", ["view", "create", "edit", "print"]),
    // Stock
    ...perms("stock_transfers", ["view", "create", "edit", "delete", "transfer", "print"]),
    ...perms("job_work", ["view", "create", "edit", "delete", "approve", "transfer"]),
    // Approvals
    ...perms("approvals", ["view", "create", "edit", "approve"]),
    // Insights
    ...perms("reports", ["view", "export", "print"]),
    // Workspace — limited
    ...perms("team", ["view"]),
    ...perms("settings", ["view"]),
  ]),
  accountant: new Set<PermissionKey>([
    ...perms("dashboard", ["view"]),
    ...perms("items", ["view", "export"]),
    ...perms("warehouses", ["view"]),
    ...perms("barcodes", ["view"]),
    ...perms("write_offs", ["view"]),
    ...perms("sales_orders", ["view", "create", "edit", "approve", "export", "print"]),
    ...perms("customers", ["view", "create", "edit", "export"]),
    ...perms("pos", ["view"]),
    ...perms("payments", ["view", "create", "edit", "delete", "export", "print"]),
    ...perms("purchase_orders", ["view", "create", "edit", "approve", "export", "print"]),
    ...perms("suppliers", ["view", "export"]),
    ...perms("supplier_payments", ["view", "create", "edit", "delete", "export", "print"]),
    ...perms("stock_transfers", ["view"]),
    ...perms("job_work", ["view"]),
    ...perms("approvals", ["view"]),
    ...perms("reports", ["view", "export", "print"]),
  ]),
  salesman: new Set<PermissionKey>([
    ...perms("dashboard", ["view"]),
    ...perms("items", ["view", "export"]),
    ...perms("barcodes", ["view"]),
    ...perms("sales_orders", ["view", "create", "edit", "export", "print"]),
    ...perms("customers", ["view", "create", "edit", "export"]),
    ...perms("pos", ["view", "create", "edit", "approve"]),
    ...perms("approvals", ["view"]),
    ...perms("reports", ["view"]),
  ]),
  viewer: new Set<PermissionKey>([
    ...perms("dashboard", ["view"]),
    ...perms("items", ["view"]),
    ...perms("warehouses", ["view"]),
    ...perms("barcodes", ["view"]),
    ...perms("write_offs", ["view"]),
    ...perms("sales_orders", ["view"]),
    ...perms("customers", ["view"]),
    ...perms("pos", ["view"]),
    ...perms("payments", ["view"]),
    ...perms("purchase_orders", ["view"]),
    ...perms("suppliers", ["view"]),
    ...perms("supplier_payments", ["view"]),
    ...perms("stock_transfers", ["view"]),
    ...perms("job_work", ["view"]),
    ...perms("approvals", ["view"]),
    ...perms("reports", ["view"]),
  ]),
};

// ─── Permission cache ───────────────────────────────────────────────────────

interface CacheEntry {
  permissions: Set<PermissionKey>;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const permissionCache = new Map<string, CacheEntry>();

function cacheKey(orgId: number, role: Role): string {
  return `${orgId}:${role}`;
}

export function invalidatePermissionsCache(orgId?: number): void {
  if (orgId === undefined) {
    permissionCache.clear();
    return;
  }
  for (const key of permissionCache.keys()) {
    if (key.startsWith(`${orgId}:`)) permissionCache.delete(key);
  }
}

// ─── Permission resolution ─────────────────────────────────────────────────

/**
 * Resolve the effective permission set for a role within an org.
 * Merges the default matrix with any org-level overrides stored in DB.
 */
export async function resolvePermissions(
  orgId: number,
  role: Role,
): Promise<Set<PermissionKey>> {
  const key = cacheKey(orgId, role);
  const cached = permissionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions;
  }

  // Load org-level overrides from DB
  const overrides = await db
    .select()
    .from(orgRolePermissionsTable)
    // org-scope-allow: permission resolution is scoped to organizationId
    .where(
      and(
        eq(orgRolePermissionsTable.organizationId, orgId),
        eq(orgRolePermissionsTable.role, role),
      ),
    );

  // Start with defaults for this role
  const base = new Set(DEFAULT_PERMISSIONS[role] ?? []);

  // Apply overrides
  for (const row of overrides) {
    const perm = `${row.module}.${row.action}` as PermissionKey;
    if (row.granted) {
      base.add(perm);
    } else {
      base.delete(perm);
    }
  }

  const entry: CacheEntry = { permissions: base, expiresAt: Date.now() + CACHE_TTL_MS };
  permissionCache.set(key, entry);
  return base;
}

export function can(
  permissions: Set<PermissionKey>,
  module: Module,
  action: Action,
): boolean {
  return permissions.has(`${module}.${action}`);
}

// ─── Backwards-compat: route-level policy (used in tenantMiddleware) ────────

const WRITE_METHODS = /^(POST|PATCH|PUT|DELETE)$/;
const DELETE_METHOD = /^DELETE$/;
const ANY_METHOD = /.*/;

interface RoutePolicy {
  methods: RegExp;
  pattern: RegExp;
  module: Module;
  action: Action;
}

/**
 * Maps HTTP method + path prefix to a module+action for middleware enforcement.
 * First matching policy wins — WRITE_METHODS rules MUST appear before ANY_METHOD
 * rules for the same path, or a POST/PATCH/DELETE would hit the read fallback.
 */
export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  // Team management — writes need create, reads need view
  { methods: WRITE_METHODS, pattern: /^\/team(\/|$)/, module: "team", action: "create" },
  { methods: ANY_METHOD,    pattern: /^\/team(\/|$)/, module: "team", action: "view" },

  // Settings & integrations (all methods need settings access)
  { methods: ANY_METHOD, pattern: /^\/email-settings(\/|$)/, module: "settings", action: "settings" },
  { methods: ANY_METHOD, pattern: /^\/(shopify|shiprocket|ewb|einvoice)(\/|$)/, module: "integrations", action: "settings" },
  { methods: ANY_METHOD, pattern: /^\/onboarding(\/|$)/, module: "settings", action: "settings" },
  { methods: WRITE_METHODS, pattern: /^\/organizations(\/|$)/, module: "settings", action: "settings" },
  { methods: WRITE_METHODS, pattern: /^\/subscription(\/|$)/, module: "settings", action: "settings" },
  { methods: ANY_METHOD,    pattern: /^\/subscription(\/|$)/, module: "settings", action: "view" },
  { methods: ANY_METHOD,    pattern: /^\/sales-channel-defaults(\/|$)/, module: "settings", action: "settings" },
  { methods: WRITE_METHODS, pattern: /^\/pos-sessions(\/|$)/, module: "pos", action: "create" },
  { methods: ANY_METHOD,    pattern: /^\/pos-sessions(\/|$)/, module: "pos", action: "view" },

  // Role permissions — writes need settings, reads need view
  { methods: WRITE_METHODS, pattern: /^\/role-permissions(\/|$)/, module: "roles", action: "settings" },
  { methods: ANY_METHOD,    pattern: /^\/role-permissions(\/|$)/, module: "roles", action: "view" },

  // POS session day-closing actions — approve/reject/reopen need pos.approve (manager+).
  // These must appear BEFORE the general /pos/ catch-all so they match first.
  { methods: WRITE_METHODS, pattern: /^\/pos\/sessions\/[^/]+\/(approve|reject|reopen)(\/|$)/, module: "pos", action: "approve" },

  // POS — other writes need create, reads need view
  { methods: WRITE_METHODS, pattern: /^\/pos(\/|$)/, module: "pos", action: "create" },
  { methods: ANY_METHOD,    pattern: /^\/pos(\/|$)/, module: "pos", action: "view" },

  // Customers — deletes need delete, other writes need edit, reads need view
  { methods: DELETE_METHOD, pattern: /^\/customers(\/|$)/, module: "customers", action: "delete" },
  { methods: WRITE_METHODS, pattern: /^\/customers(\/|$)/, module: "customers", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/customers(\/|$)/, module: "customers", action: "view" },

  // Sales orders — deletes need delete, other writes need edit, reads need view
  { methods: DELETE_METHOD, pattern: /^\/sales-orders(\/|$)/, module: "sales_orders", action: "delete" },
  { methods: WRITE_METHODS, pattern: /^\/sales-orders(\/|$)/, module: "sales_orders", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/sales-orders(\/|$)/, module: "sales_orders", action: "view" },

  // Customer payments — writes need create, reads need view
  { methods: WRITE_METHODS, pattern: /^\/(customer-payments|payment-links)(\/|$)/, module: "payments", action: "create" },
  { methods: ANY_METHOD,    pattern: /^\/(customer-payments|payment-links)(\/|$)/, module: "payments", action: "view" },

  // Supplier payments — writes need create, reads need view
  { methods: WRITE_METHODS, pattern: /^\/supplier-payments(\/|$)/, module: "supplier_payments", action: "create" },
  { methods: ANY_METHOD,    pattern: /^\/supplier-payments(\/|$)/, module: "supplier_payments", action: "view" },

  // Barcode print/export/import — must appear before the general /items/ catch-all
  { methods: ANY_METHOD,    pattern: /^\/items\/barcode-labels\.pdf(\/|$)/, module: "barcodes", action: "print" },
  { methods: ANY_METHOD,    pattern: /^\/items\/[^/]+\/barcode\.png(\/|$)/, module: "barcodes", action: "view" },
  { methods: WRITE_METHODS, pattern: /^\/items\/barcode-import(\/|$)/, module: "barcodes", action: "create" },

  // Items — deletes need delete, other writes need edit, reads need view
  { methods: DELETE_METHOD, pattern: /^\/items(\/|$)/, module: "items", action: "delete" },
  { methods: WRITE_METHODS, pattern: /^\/items(\/|$)/, module: "items", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/items(\/|$)/, module: "items", action: "view" },

  // Import (write-only paths)
  { methods: WRITE_METHODS, pattern: /^\/(unified-import|variant-import)(\/|$)/, module: "items", action: "import" },

  // Suppliers — deletes need delete, other writes need edit, reads need view
  { methods: DELETE_METHOD, pattern: /^\/suppliers(\/|$)/, module: "suppliers", action: "delete" },
  { methods: WRITE_METHODS, pattern: /^\/suppliers(\/|$)/, module: "suppliers", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/suppliers(\/|$)/, module: "suppliers", action: "view" },

  // Warehouses — deletes need delete, other writes need edit, reads need view
  { methods: DELETE_METHOD, pattern: /^\/warehouses(\/|$)/, module: "warehouses", action: "delete" },
  { methods: WRITE_METHODS, pattern: /^\/warehouses(\/|$)/, module: "warehouses", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/warehouses(\/|$)/, module: "warehouses", action: "view" },

  // Stock movements — writes need create (write-offs), reads need view
  { methods: WRITE_METHODS, pattern: /^\/stock-movements(\/|$)/, module: "write_offs", action: "create" },
  { methods: ANY_METHOD,    pattern: /^\/stock-movements(\/|$)/, module: "write_offs", action: "view" },

  // Stock transfers — writes need transfer, reads need view
  { methods: WRITE_METHODS, pattern: /^\/stock-transfers(\/|$)/, module: "stock_transfers", action: "transfer" },
  { methods: ANY_METHOD,    pattern: /^\/stock-transfers(\/|$)/, module: "stock_transfers", action: "view" },

  // Purchase order PDF/print — must appear before the general purchase-orders catch-all
  { methods: ANY_METHOD, pattern: /^\/purchase-orders\/[^/]+\/pdf(\/|$)/, module: "purchase_orders", action: "print" },

  // Purchase orders — deletes need delete, other writes need edit, reads need view
  { methods: DELETE_METHOD, pattern: /^\/purchase-orders(\/|$)/, module: "purchase_orders", action: "delete" },
  { methods: WRITE_METHODS, pattern: /^\/purchase-orders(\/|$)/, module: "purchase_orders", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/purchase-orders(\/|$)/, module: "purchase_orders", action: "view" },

  // Goods receipts — writes need approve, reads need view
  { methods: WRITE_METHODS, pattern: /^\/goods-receipts(\/|$)/, module: "purchase_orders", action: "approve" },
  { methods: ANY_METHOD,    pattern: /^\/goods-receipts(\/|$)/, module: "purchase_orders", action: "view" },

  // Job work — writes need edit, reads need view
  { methods: WRITE_METHODS, pattern: /^\/job-work-orders(\/|$)/, module: "job_work", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/job-work-orders(\/|$)/, module: "job_work", action: "view" },

  // Sales order PDF/print — must appear before the general sales-orders catch-all
  { methods: ANY_METHOD, pattern: /^\/sales-orders\/[^/]+\/(pdf|invoice\.pdf)(\/|$)/, module: "sales_orders", action: "print" },

  // Fulfillments (Pick → Pack → Dispatch) — writes need edit, reads need view
  { methods: WRITE_METHODS, pattern: /^\/fulfillments(\/|$)/, module: "sales_orders", action: "edit" },
  { methods: ANY_METHOD,    pattern: /^\/fulfillments(\/|$)/, module: "sales_orders", action: "view" },

  // Shipments — writes need approve, reads need view
  { methods: WRITE_METHODS, pattern: /^\/shipments(\/|$)/, module: "sales_orders", action: "approve" },
  { methods: ANY_METHOD,    pattern: /^\/shipments(\/|$)/, module: "sales_orders", action: "view" },

  // Approval workflows — config needs settings, reads need view (approvals module)
  { methods: WRITE_METHODS, pattern: /^\/approval-workflows(\/|$)/, module: "approvals", action: "settings" },
  { methods: ANY_METHOD,    pattern: /^\/approval-workflows(\/|$)/, module: "approvals", action: "view" },

  // Approval requests / notifications / status / history — reads need view
  // Submit is a create operation; approve/reject/send-back/bulk-approve need approve
  { methods: WRITE_METHODS, pattern: /^\/approval-requests\/submit(\/|$)/, module: "approvals", action: "create" },
  { methods: WRITE_METHODS, pattern: /^\/approval-notifications\/mark-read(\/|$)/, module: "approvals", action: "view" },
  { methods: WRITE_METHODS, pattern: /^\/(approval-requests|approval-notifications|approval-status|approval-history|approval-rules)(\/|$)/, module: "approvals", action: "approve" },
  { methods: ANY_METHOD,    pattern: /^\/(approval-requests|approval-notifications|approval-status|approval-history|approval-rules)(\/|$)/, module: "approvals", action: "view" },

  // Reports / dashboard (read-only)
  { methods: ANY_METHOD, pattern: /^\/reports(\/|$)/, module: "reports", action: "view" },
  { methods: ANY_METHOD, pattern: /^\/dashboard(\/|$)/, module: "dashboard", action: "view" },

  // Barcode / labels — writes need create, reads need view
  { methods: WRITE_METHODS, pattern: /^\/item-barcodes(\/|$)/, module: "barcodes", action: "create" },
  { methods: ANY_METHOD,    pattern: /^\/item-barcodes(\/|$)/, module: "barcodes", action: "view" },

  // Print log (read-only settings view)
  { methods: ANY_METHOD, pattern: /^\/print-log(\/|$)/, module: "settings", action: "view" },
];

export interface PolicyResult {
  allowed: boolean;
  module?: Module;
  action?: Action;
}

/**
 * Check whether the given resolved permission set allows method+path.
 * Called synchronously in tenantMiddleware (permissions already resolved).
 */
export function checkPermissions(
  method: string,
  path: string,
  permissions: Set<PermissionKey>,
  isSuperAdmin: boolean,
): PolicyResult {
  if (isSuperAdmin) return { allowed: true };

  const upperMethod = method.toUpperCase();
  for (const p of ROUTE_POLICIES) {
    if (!p.methods.test(upperMethod)) continue;
    if (!p.pattern.test(path)) continue;
    const key = `${p.module}.${p.action}` as PermissionKey;
    return { allowed: permissions.has(key), module: p.module, action: p.action };
  }
  // Paths that are intentionally exempt from module-level policy checks.
  // Auth is still required via Clerk+tenantMiddleware; these endpoints are
  // per-user or system-level rather than org-module-scoped.
  const EXEMPT_PATHS = [
    /^\/me(\/|$)/,            // user bootstrap + profile (per-user, not org-module-scoped)
    /^\/permissions(\/|$)/,   // permissions/me endpoint (per-user resolution)
    /^\/organizations(\/|$)/, // org profile reads (writes covered by settings.settings policy)
    /^\/audit-logs(\/|$)/,    // inline authz in route handler (multi-module access)
    /^\/admin(\/|$)/,         // super-admin only, enforced inline
    /^\/storage(\/|$)/,       // file storage — tenant-ownership enforced inline per route
  ];
  for (const ep of EXEMPT_PATHS) {
    if (ep.test(path)) return { allowed: true };
  }
  // No policy and not exempt → deny. Any new route that should be
  // accessible must be added to ROUTE_POLICIES or EXEMPT_PATHS above.
  return { allowed: false };
}

// ─── Backwards-compat shims ────────────────────────────────────────────────

export interface LegacyPolicyResult {
  allowed: boolean;
  matched: boolean;
}

/** @deprecated Use checkPermissions instead */
export function checkRolePolicy(
  method: string,
  path: string,
  role: Role,
): LegacyPolicyResult {
  // Use defaults only (no org override) — kept for any remaining callers.
  const permsSet = DEFAULT_PERMISSIONS[role] ?? new Set<PermissionKey>();
  const result = checkPermissions(method, path, permsSet, false);
  return { allowed: result.allowed, matched: true };
}

