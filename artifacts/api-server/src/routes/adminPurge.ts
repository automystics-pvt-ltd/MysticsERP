/**
 * ONE-TIME data purge endpoint.
 *
 * POST /api/internal/purge-business-data
 * Header: x-purge-secret: <value of ADMIN_PURGE_SECRET env var>
 *
 * Permanently deletes ALL business data (items, orders, customers,
 * suppliers, warehouses, stock, POS, job work, payments, …) while
 * keeping the auth tables: users, organizations, organization_members,
 * org_role_permissions, email_settings, team_invitations.
 *
 * REMOVE THIS FILE once the purge has been executed on production.
 */
import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.post("/internal/purge-business-data", async (req, res, next) => {
  try {
    const secret = process.env.ADMIN_PURGE_SECRET;
    if (!secret || secret.trim().length < 16) {
      res.status(503).json({ error: "ADMIN_PURGE_SECRET env var not configured or too short (min 16 chars)" });
      return;
    }

    const provided = req.headers["x-purge-secret"];
    if (provided !== secret) {
      res.status(401).json({ error: "Invalid purge secret" });
      return;
    }

    // Tables to wipe — every business table.
    // RESTART IDENTITY resets their sequences back to 1.
    // CASCADE handles any FK references among these tables automatically.
    // Tables intentionally kept: users, organizations, organization_members,
    // org_role_permissions, email_settings, team_invitations.
    // org-scope-allow: intentional cross-tenant purge, protected by ADMIN_PURGE_SECRET
    await db.execute(sql`
      TRUNCATE TABLE
        approval_actions,
        approval_notifications,
        approval_requests,
        approval_rules,
        approval_workflows,
        audit_logs,
        customer_payment_allocations,
        customer_payments,
        customers,
        einvoice_bulk_batches,
        email_log,
        goods_receipt_lines,
        goods_receipts,
        item_batch_warehouse_stock,
        item_batches,
        item_bundle_components,
        item_warehouse_stock,
        items,
        job_work_issue_lines,
        job_work_issues,
        job_work_order_components,
        job_work_orders,
        job_work_receipt_components,
        job_work_receipts,
        payment_links,
        permission_change_log,
        pos_counters,
        pos_session_audit_logs,
        pos_session_expenses,
        pos_sessions,
        print_log,
        purchase_order_lines,
        purchase_orders,
        sales_channel_warehouse_defaults,
        sales_order_lines,
        sales_orders,
        shipment_lines,
        shipments,
        shopify_import_jobs,
        shopify_oauth_states,
        shopify_webhook_events,
        staged_write_offs,
        stock_batch_movements,
        stock_movements,
        stock_transfer_lines,
        stock_transfers,
        supplier_payment_allocations,
        supplier_payments,
        suppliers,
        warehouses
      RESTART IDENTITY CASCADE
    `);

    // Reset per-org counters that reference the now-deleted rows.
    await db.execute(sql`
      UPDATE organizations
      SET
        sku_next_number       = 1,
        pos_bill_next_number  = 1
    `);

    res.json({
      ok: true,
      message: "All business data purged. Users, organizations, members, permissions, email settings, and invitations are intact.",
      note: "You must create at least one Warehouse before the app is usable again.",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
