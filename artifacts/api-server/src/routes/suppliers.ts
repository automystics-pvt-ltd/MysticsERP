import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, ilike, isNotNull, lt, notInArray, or, sql, sum } from "drizzle-orm";
import { db, purchaseOrdersTable, suppliersTable } from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { serializeSupplier } from "../lib/serializers";

const router: IRouter = Router();
router.use(tenantMiddleware);

router.get("/suppliers", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const hasBalance = req.query.hasBalance === "true";
    const overdueOnly = req.query.overdueOnly === "true";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    const conds = [eq(suppliersTable.organizationId, t.organizationId)];
    if (search) {
      conds.push(
        or(
          ilike(suppliersTable.name, `%${search}%`),
          ilike(suppliersTable.email, `%${search}%`),
          ilike(suppliersTable.company, `%${search}%`),
        )!,
      );
    }
    if (hasBalance) {
      conds.push(gt(suppliersTable.outstandingPayable, "0"));
    }
    if (overdueOnly) {
      // Limit to suppliers that have at least one overdue PO for this org.
      conds.push(
        sql`${suppliersTable.id} IN (
          SELECT supplier_id FROM purchase_orders
          WHERE organization_id = ${t.organizationId}
            AND balance_due > 0
            AND expected_delivery_date IS NOT NULL
            AND expected_delivery_date < CURRENT_DATE
            AND status NOT IN ('draft', 'cancelled')
        )`,
      );
    }

    // Sort — sortBy: "name" (default) | "payable"; sortDir: "asc" (default) | "desc"
    const sortDirParam = req.query.sortDir === "desc" ? "desc" : "asc";
    const sortByParam = String(req.query.sortBy ?? "name");
    const sortCol =
      sortByParam === "payable"
        ? suppliersTable.outstandingPayable
        : suppliersTable.name;
    const orderExpr = sortDirParam === "asc" ? asc(sortCol) : desc(sortCol);

    const [countRows, sumRows, overdueRows, rows] = await Promise.all([
      db.select({ count: sql<string>`COUNT(*)` }).from(suppliersTable).where(and(...conds)),
      db.select({ totalPayable: sum(suppliersTable.outstandingPayable) }).from(suppliersTable).where(and(...conds)),
      db
        .select({
          count: sql<string>`COUNT(*)`,
          totalAmount: sql<string>`COALESCE(SUM(${purchaseOrdersTable.balanceDue}), 0)`,
        })
        .from(purchaseOrdersTable)
        .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
        .where(
          and(
            eq(purchaseOrdersTable.organizationId, t.organizationId),
            gt(purchaseOrdersTable.balanceDue, "0"),
            isNotNull(purchaseOrdersTable.expectedDeliveryDate),
            lt(purchaseOrdersTable.expectedDeliveryDate, sql`CURRENT_DATE`),
            notInArray(purchaseOrdersTable.status, ["draft", "cancelled"]),
            ...conds,
          ),
        ),
      db
        .select()
        .from(suppliersTable)
        .where(and(...conds))
        .orderBy(orderExpr)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
    const total = Number(countRows[0]?.count ?? 0);
    const overduePayablesCount = Number(overdueRows[0]?.count ?? 0);
    const overduePayablesAmount = String(overdueRows[0]?.totalAmount ?? "0");
    res.json({ suppliers: rows.map(serializeSupplier), total, totalPayable: sumRows[0]?.totalPayable ?? "0", overduePayablesCount, overduePayablesAmount, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.post("/suppliers", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const b = req.body ?? {};
    if (!b.name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const inserted = await db
      .insert(suppliersTable)
      .values({
        organizationId: t.organizationId,
        name: b.name,
        email: b.email ?? null,
        phone: b.phone ?? null,
        company: b.company ?? null,
        gstNumber: b.gstNumber ?? null,
        address: b.address ?? null,
        notes: b.notes ?? null,
        isJobWorker: b.isJobWorker === true,
      })
      .returning();
    res.status(201).json(serializeSupplier(inserted[0]!));
  } catch (err) {
    next(err);
  }
});

router.get("/suppliers/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const rows = await db
      .select()
      .from(suppliersTable)
      .where(
        and(eq(suppliersTable.id, id), eq(suppliersTable.organizationId, t.organizationId)),
      )
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serializeSupplier(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.patch("/suppliers/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const updates: Record<string, unknown> = {};
    for (const k of ["name", "email", "phone", "company", "gstNumber", "address", "notes"]) {
      if (k in b) updates[k] = b[k];
    }
    if ("isJobWorker" in b) updates.isJobWorker = b.isJobWorker === true;
    const updated = await db
      .update(suppliersTable)
      .set(updates)
      .where(
        and(eq(suppliersTable.id, id), eq(suppliersTable.organizationId, t.organizationId)),
      )
      .returning();
    if (!updated[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serializeSupplier(updated[0]));
  } catch (err) {
    next(err);
  }
});

router.delete("/suppliers/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    await db
      .delete(suppliersTable)
      .where(
        and(eq(suppliersTable.id, id), eq(suppliersTable.organizationId, t.organizationId)),
      );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
