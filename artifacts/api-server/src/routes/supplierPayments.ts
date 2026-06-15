import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  supplierPaymentsTable,
  supplierPaymentAllocationsTable,
  suppliersTable,
  purchaseOrdersTable,
  approvalWorkflowsTable,
} from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { submitForApproval } from "../lib/approvalEngine";
import {
  serializeSupplierPayment,
  serializeSupplierPaymentAllocation,
} from "../lib/serializers";
import { toNum, toStr } from "../lib/numeric";

const router: IRouter = Router();
router.use(tenantMiddleware);

const PAYMENT_MODES = [
  "cash",
  "bank",
  "upi",
  "cheque",
  "razorpay",
  "other",
] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];
function isPaymentMode(m: string): m is PaymentMode {
  return (PAYMENT_MODES as readonly string[]).includes(m);
}

const EPSILON = 0.005;

const PAYABLE_PURCHASE_STATUSES = [
  "ordered",
  "partially_received",
  "received",
  "billed",
] as const;

router.get("/supplier-payments", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    const conds = [eq(supplierPaymentsTable.organizationId, t.organizationId)];
    if (req.query.supplierId) {
      const sid = Number(req.query.supplierId);
      if (Number.isFinite(sid)) conds.push(eq(supplierPaymentsTable.supplierId, sid));
    }
    if (req.query.mode && typeof req.query.mode === "string") {
      conds.push(eq(supplierPaymentsTable.mode, req.query.mode));
    }
    if (req.query.from && typeof req.query.from === "string") {
      conds.push(gte(supplierPaymentsTable.paymentDate, req.query.from));
    }
    if (req.query.to && typeof req.query.to === "string") {
      conds.push(lte(supplierPaymentsTable.paymentDate, req.query.to));
    }

    const basePaymentsQuery = db
      .select({
        payment: supplierPaymentsTable,
        supplierName: suppliersTable.name,
      })
      .from(supplierPaymentsTable)
      .innerJoin(
        suppliersTable,
        eq(suppliersTable.id, supplierPaymentsTable.supplierId),
      )
      .where(and(...conds))
      .orderBy(
        desc(supplierPaymentsTable.paymentDate),
        desc(supplierPaymentsTable.id),
      );

    const [countRows, rows] = await Promise.all([
      db
        .select({ count: sql<string>`COUNT(*)` })
        .from(supplierPaymentsTable)
        .where(and(...conds)),
      basePaymentsQuery.limit(pageSize).offset((page - 1) * pageSize),
    ]);
    const total = Number(countRows[0]?.count ?? 0);

    // Fetch total allocated per payment for the current page so we can
    // surface an "unapplied advance" balance on the list view.
    const paymentIds = rows.map((r) => r.payment.id);
    const allocSums =
      paymentIds.length > 0
        ? await db
            .select({
              paymentId: supplierPaymentAllocationsTable.paymentId,
              totalAllocated: sql<string>`SUM(${supplierPaymentAllocationsTable.amount})`,
            })
            .from(supplierPaymentAllocationsTable)
            .where(
              and(
                eq(supplierPaymentAllocationsTable.organizationId, t.organizationId),
                inArray(supplierPaymentAllocationsTable.paymentId, paymentIds),
              ),
            )
            .groupBy(supplierPaymentAllocationsTable.paymentId)
        : [];
    const allocByPaymentId = new Map(allocSums.map((a) => [a.paymentId, toNum(a.totalAllocated)]));

    res.json({
      payments: rows.map((r) => {
        const serialized = serializeSupplierPayment(r.payment, r.supplierName);
        const totalAllocated = allocByPaymentId.get(r.payment.id) ?? 0;
        const unapplied = Math.max(0, serialized.amount - totalAllocated);
        return { ...serialized, unapplied };
      }),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});

async function loadPaymentDetail(
  orgId: number,
  paymentId: number,
): Promise<
  | {
      payment: ReturnType<typeof serializeSupplierPayment>;
      allocations: ReturnType<typeof serializeSupplierPaymentAllocation>[];
    }
  | null
> {
  const rows = await db
    .select({
      payment: supplierPaymentsTable,
      supplierName: suppliersTable.name,
    })
    .from(supplierPaymentsTable)
    .innerJoin(
      suppliersTable,
      eq(suppliersTable.id, supplierPaymentsTable.supplierId),
    )
    .where(
      and(
        eq(supplierPaymentsTable.id, paymentId),
        eq(supplierPaymentsTable.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  const allocRows = await db
    .select({
      alloc: supplierPaymentAllocationsTable,
      orderNumber: purchaseOrdersTable.orderNumber,
      orderTotal: purchaseOrdersTable.total,
      orderBalanceDue: purchaseOrdersTable.balanceDue,
    })
    .from(supplierPaymentAllocationsTable)
    .innerJoin(
      purchaseOrdersTable,
      eq(
        purchaseOrdersTable.id,
        supplierPaymentAllocationsTable.purchaseOrderId,
      ),
    )
    .where(
      and(
        eq(supplierPaymentAllocationsTable.paymentId, paymentId),
        eq(supplierPaymentAllocationsTable.organizationId, orgId),
      ),
    )
    .orderBy(asc(supplierPaymentAllocationsTable.id));
  return {
    payment: serializeSupplierPayment(rows[0].payment, rows[0].supplierName),
    allocations: allocRows.map((r) =>
      serializeSupplierPaymentAllocation(
        r.alloc,
        r.orderNumber,
        r.orderTotal,
        r.orderBalanceDue,
      ),
    ),
  };
}

router.get("/supplier-payments/:id/voucher.pdf", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid payment id" });
      return;
    }
    const { loadSupplierPaymentPdf } = await import(
      "../lib/supplierPaymentPdfData"
    );
    const result = await loadSupplierPaymentPdf(t.organizationId, id);
    if ("notFound" in result) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="voucher-${result.voucherNumber}.pdf"`,
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.setHeader("Content-Length", String(result.pdf.length));
    res.send(result.pdf);
  } catch (err) {
    next(err);
  }
});

router.get("/supplier-payments/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const detail = await loadPaymentDetail(t.organizationId, id);
    if (!detail) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

class PaymentValidationError extends Error {
  constructor(public httpMessage: string) {
    super(httpMessage);
  }
}

router.post("/supplier-payments", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgId = t.organizationId;
    const b = req.body ?? {};
    const supplierId = Number(b.supplierId);
    const amount = toNum(b.amount);
    const mode = String(b.mode ?? "");
    const paymentDate =
      typeof b.paymentDate === "string" && b.paymentDate
        ? b.paymentDate
        : new Date().toISOString().slice(0, 10);

    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      res.status(400).json({ error: "supplierId is required" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "amount must be greater than zero" });
      return;
    }
    if (!isPaymentMode(mode)) {
      res.status(400).json({
        error: `Invalid mode. Allowed: ${PAYMENT_MODES.join(", ")}`,
      });
      return;
    }

    // Aggregate allocations by purchaseOrderId so duplicate rows in
    // the payload cannot bypass per-row balance validation.
    const aggregated = new Map<number, number>();
    if (Array.isArray(b.allocations)) {
      for (const a of b.allocations) {
        const pid = Number((a as { purchaseOrderId: unknown }).purchaseOrderId);
        const amt = toNum((a as { amount: unknown }).amount as never);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        if (!Number.isFinite(amt) || amt <= 0) continue;
        aggregated.set(pid, (aggregated.get(pid) ?? 0) + amt);
      }
    }
    const allocationsInput = Array.from(
      aggregated,
      ([purchaseOrderId, amt]) => ({
        purchaseOrderId,
        amount: amt,
      }),
    );

    const totalAllocated = allocationsInput.reduce((s, a) => s + a.amount, 0);
    if (totalAllocated - amount > EPSILON) {
      res.status(400).json({
        error: "Allocated amount exceeds payment amount",
      });
      return;
    }

    try {
      const txResult = await db.transaction(async (tx) => {
        const supplierRows = await tx
          .select({ id: suppliersTable.id })
          .from(suppliersTable)
          .where(
            and(
              eq(suppliersTable.id, supplierId),
              eq(suppliersTable.organizationId, orgId),
            ),
          )
          .limit(1);
        if (!supplierRows[0]) {
          throw new PaymentValidationError("Invalid supplier");
        }

        // Approval workflow gate: if a workflow is configured, stage the
        // payment for approval without applying any financial changes yet.
        const [wfRow] = await tx
          .select({ id: approvalWorkflowsTable.id })
          .from(approvalWorkflowsTable)
          .where(
            and(
              eq(approvalWorkflowsTable.organizationId, orgId),
              eq(approvalWorkflowsTable.module, "supplier_payments"),
              eq(approvalWorkflowsTable.isEnabled, true),
            ),
          )
          .limit(1);
        if (wfRow) {
          const staged = await tx
            .insert(supplierPaymentsTable)
            .values({
              organizationId: orgId,
              supplierId,
              paymentDate,
              amount: toStr(amount),
              mode,
              referenceNumber: b.referenceNumber ?? null,
              notes: b.notes ?? null,
              bankAccountLabel: b.bankAccountLabel ?? null,
              status: "pending_approval",
              pendingAllocationsJson: allocationsInput.map((a) => ({
                purchaseOrderId: a.purchaseOrderId,
                amount: toStr(a.amount),
              })),
            })
            .returning({ id: supplierPaymentsTable.id });
          const paymentId = staged[0]!.id;
          const approvalReq = await submitForApproval(
            tx,
            orgId,
            "supplier_payments",
            paymentId,
            `payment-${paymentId}`,
            t.userId,
          );
          if (approvalReq) {
            return { pendingApproval: true as const, paymentId };
          }
          // Workflow exists but has no rules configured yet — revert staging
          // and fall through to the immediate apply path below.
          await tx
            .delete(supplierPaymentsTable)
            .where(
              and(
                eq(supplierPaymentsTable.id, paymentId),
                eq(supplierPaymentsTable.organizationId, orgId),
              ),
            );
        }

        // Apply each aggregated allocation atomically: only update if
        // the current balance_due is sufficient AND the order is in a
        // payable status. RETURNING tells us whether the row matched
        // both org/id and all preconditions; an empty result aborts
        // the whole txn.
        for (const a of allocationsInput) {
          const updated = await tx
            .update(purchaseOrdersTable)
            .set({
              amountPaid: sql`${purchaseOrdersTable.amountPaid} + ${toStr(a.amount)}`,
              balanceDue: sql`${purchaseOrdersTable.balanceDue} - ${toStr(a.amount)}`,
            })
            .where(
              and(
                eq(purchaseOrdersTable.id, a.purchaseOrderId),
                eq(purchaseOrdersTable.organizationId, orgId),
                eq(purchaseOrdersTable.supplierId, supplierId),
                sql`${purchaseOrdersTable.balanceDue} >= ${toStr(a.amount)}`,
                inArray(
                  purchaseOrdersTable.status,
                  PAYABLE_PURCHASE_STATUSES as unknown as string[],
                ),
              ),
            )
            .returning({ id: purchaseOrdersTable.id });
          if (updated.length === 0) {
            throw new PaymentValidationError(
              `Allocation for order ${a.purchaseOrderId} is invalid: order must be ordered/partially received/received/billed and have sufficient balance due`,
            );
          }
        }

        const paymentRows = await tx
          .insert(supplierPaymentsTable)
          .values({
            organizationId: orgId,
            supplierId,
            paymentDate,
            amount: toStr(amount),
            mode,
            referenceNumber: b.referenceNumber ?? null,
            notes: b.notes ?? null,
            bankAccountLabel: b.bankAccountLabel ?? null,
          })
          .returning({ id: supplierPaymentsTable.id });
        const paymentId = paymentRows[0]!.id;

        if (allocationsInput.length > 0) {
          await tx.insert(supplierPaymentAllocationsTable).values(
            allocationsInput.map((a) => ({
              organizationId: orgId,
              paymentId,
              purchaseOrderId: a.purchaseOrderId,
              amount: toStr(a.amount),
            })),
          );
        }

        // The full paid amount reduces the supplier's outstanding
        // payable, even when part of it is unallocated (advance).
        await tx
          .update(suppliersTable)
          .set({
            outstandingPayable: sql`${suppliersTable.outstandingPayable} - ${toStr(amount)}`,
          })
          .where(
            and(
              eq(suppliersTable.id, supplierId),
              eq(suppliersTable.organizationId, orgId),
            ),
          );

        return { pendingApproval: false as const, paymentId };
      });

      const detail = await loadPaymentDetail(orgId, txResult.paymentId);
      if (txResult.pendingApproval) {
        res.status(202).json({ ...(detail ?? {}), approvalRequired: true });
      } else {
        res.status(201).json(detail);
      }
    } catch (err) {
      if (err instanceof PaymentValidationError) {
        res.status(400).json({ error: err.httpMessage });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.post("/supplier-payments/:id/allocations", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgId = t.organizationId;
    const paymentId = Number(req.params.id);
    if (!Number.isFinite(paymentId) || paymentId <= 0) {
      res.status(400).json({ error: "Invalid payment id" });
      return;
    }

    const b = req.body ?? {};
    const purchaseOrderId = Number(b.purchaseOrderId);
    const amount = toNum(b.amount);

    if (!Number.isFinite(purchaseOrderId) || purchaseOrderId <= 0) {
      res.status(400).json({ error: "purchaseOrderId is required" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= EPSILON) {
      res.status(400).json({ error: "amount must be greater than zero" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        // Lock the payment row and load its current data
        const locked = await tx
          .execute(
            sql`SELECT id, supplier_id, amount FROM ${supplierPaymentsTable}
                WHERE id = ${paymentId} AND organization_id = ${orgId}
                FOR UPDATE`,
          )
          .then((r) =>
            (r.rows ?? r) as Array<{
              id: number;
              supplier_id: number;
              amount: string;
            }>,
          );
        const payment = locked[0];
        if (!payment) {
          throw new PaymentValidationError("__404__");
        }

        // Calculate already-allocated amount
        const allocRows = await tx
          .select({
            total: sql<string>`COALESCE(SUM(${supplierPaymentAllocationsTable.amount}), 0)`,
          })
          .from(supplierPaymentAllocationsTable)
          .where(
            and(
              eq(supplierPaymentAllocationsTable.paymentId, paymentId),
              eq(supplierPaymentAllocationsTable.organizationId, orgId),
            ),
          );
        const alreadyAllocated = toNum(allocRows[0]!.total);
        const unallocated = toNum(payment.amount) - alreadyAllocated;

        if (amount - unallocated > EPSILON) {
          throw new PaymentValidationError(
            `Amount exceeds unapplied balance (${unallocated.toFixed(2)} available)`,
          );
        }

        // Update PO — atomic conditional update ensures org scope, same supplier,
        // sufficient balance, and payable status all in one statement.
        const updated = await tx
          .update(purchaseOrdersTable)
          .set({
            amountPaid: sql`${purchaseOrdersTable.amountPaid} + ${toStr(amount)}`,
            balanceDue: sql`${purchaseOrdersTable.balanceDue} - ${toStr(amount)}`,
          })
          .where(
            and(
              eq(purchaseOrdersTable.id, purchaseOrderId),
              eq(purchaseOrdersTable.organizationId, orgId),
              eq(purchaseOrdersTable.supplierId, payment.supplier_id),
              sql`${purchaseOrdersTable.balanceDue} >= ${toStr(amount)}`,
              inArray(
                purchaseOrdersTable.status,
                PAYABLE_PURCHASE_STATUSES as unknown as string[],
              ),
            ),
          )
          .returning({ id: purchaseOrdersTable.id });
        if (updated.length === 0) {
          throw new PaymentValidationError(
            "Order must belong to the same supplier, have sufficient balance due, and be in a payable status",
          );
        }

        // Insert allocation row
        await tx.insert(supplierPaymentAllocationsTable).values({
          organizationId: orgId,
          paymentId,
          purchaseOrderId,
          amount: toStr(amount),
        });
      });
    } catch (err) {
      if (err instanceof PaymentValidationError) {
        if (err.httpMessage === "__404__") {
          res.status(404).json({ error: "Payment not found" });
        } else {
          res.status(400).json({ error: err.httpMessage });
        }
        return;
      }
      throw err;
    }

    const detail = await loadPaymentDetail(orgId, paymentId);
    if (!detail) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    res.status(201).json(detail);
  } catch (err) {
    next(err);
  }
});

router.delete("/supplier-payments/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const orgId = t.organizationId;
    const id = Number(req.params.id);

    const result = await db.transaction(async (tx) => {
      // Lock the payment row first. Concurrent deletes block here;
      // the second one sees no rows after the first commits and exits
      // cleanly.
      const lockedPayment = await tx
        .execute(
          sql`SELECT id, supplier_id, amount FROM ${supplierPaymentsTable}
              WHERE id = ${id} AND organization_id = ${orgId}
              FOR UPDATE`,
        )
        .then((r) =>
          (r.rows ?? r) as Array<{
            id: number;
            supplier_id: number;
            amount: string;
          }>,
        );
      const payment = lockedPayment[0];
      if (!payment) return { ok: false as const };

      // Capture allocations (org-scoped) BEFORE deleting them so we
      // can reverse the running totals.
      const allocs = await tx
        .select({
          purchaseOrderId: supplierPaymentAllocationsTable.purchaseOrderId,
          amount: supplierPaymentAllocationsTable.amount,
          poStatus: purchaseOrdersTable.status,
        })
        .from(supplierPaymentAllocationsTable)
        .innerJoin(
          purchaseOrdersTable,
          and(
            eq(purchaseOrdersTable.id, supplierPaymentAllocationsTable.purchaseOrderId),
            eq(purchaseOrdersTable.organizationId, orgId),
          ),
        )
        .where(
          and(
            eq(supplierPaymentAllocationsTable.paymentId, id),
            eq(supplierPaymentAllocationsTable.organizationId, orgId),
          ),
        );

      // Only reverse amountPaid/balanceDue on POs that are still active.
      // Returned or cancelled POs are closed — restoring balanceDue there
      // would leave phantom payables on a closed order.
      let netRestoredToPayable = 0;
      for (const a of allocs) {
        const isClosed = a.poStatus === "returned" || a.poStatus === "cancelled";
        if (!isClosed) {
          await tx
            .update(purchaseOrdersTable)
            .set({
              amountPaid: sql`${purchaseOrdersTable.amountPaid} - ${a.amount}`,
              balanceDue: sql`${purchaseOrdersTable.balanceDue} + ${a.amount}`,
            })
            .where(
              and(
                eq(purchaseOrdersTable.id, a.purchaseOrderId),
                eq(purchaseOrdersTable.organizationId, orgId),
              ),
            );
          netRestoredToPayable += toNum(a.amount);
        }
      }

      // Restore the supplier's outstanding payable only for the portion
      // that was applied to still-active (non-closed) orders. Advances
      // (unallocated) and allocations against closed orders are forfeited.
      const restoredStr = toStr(netRestoredToPayable);
      await tx
        .update(suppliersTable)
        .set({
          outstandingPayable: sql`${suppliersTable.outstandingPayable} + ${restoredStr}`,
        })
        .where(
          and(
            eq(suppliersTable.id, payment.supplier_id),
            eq(suppliersTable.organizationId, orgId),
          ),
        );

      // Cascade FK on supplier_payments → supplier_payment_allocations
      // removes the allocation rows for us.
      await tx
        .delete(supplierPaymentsTable)
        .where(
          and(
            eq(supplierPaymentsTable.id, id),
            eq(supplierPaymentsTable.organizationId, orgId),
          ),
        );

      return { ok: true as const };
    });

    if (!result.ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
