import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gt, ilike, inArray, lt, or, sql, sum } from "drizzle-orm";
import { db, customersTable, salesOrdersTable } from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { serializeCustomer } from "../lib/serializers";
import { toNum } from "../lib/numeric";

const router: IRouter = Router();
router.use(tenantMiddleware);

const OVERDUE_STATUSES = ["confirmed", "partially_shipped", "shipped", "delivered", "invoiced"];

function thirtyDaysAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

async function getOverdueBalanceMap(
  orgId: number,
  customerIds: number[],
): Promise<Map<number, string>> {
  if (customerIds.length === 0) return new Map();
  const rows = await db
    .select({
      customerId: salesOrdersTable.customerId,
      overdueBalance: sql<string>`COALESCE(SUM(${salesOrdersTable.balanceDue}), 0)`,
    })
    .from(salesOrdersTable)
    .where(
      and(
        eq(salesOrdersTable.organizationId, orgId),
        inArray(salesOrdersTable.customerId, customerIds),
        sql`${salesOrdersTable.status} = ANY(ARRAY[${sql.join(OVERDUE_STATUSES.map((s) => sql`${s}`), sql`, `)}]::text[])`,
        gt(salesOrdersTable.balanceDue, "0"),
        lt(salesOrdersTable.orderDate, thirtyDaysAgoISO()),
      ),
    )
    .groupBy(salesOrdersTable.customerId);
  return new Map(rows.map((r) => [r.customerId, r.overdueBalance]));
}

router.get("/customers", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const conds = [eq(customersTable.organizationId, t.organizationId)];
    if (search) {
      conds.push(
        or(
          ilike(customersTable.name, `%${search}%`),
          ilike(customersTable.email, `%${search}%`),
          ilike(customersTable.company, `%${search}%`),
        )!,
      );
    }

    // Filter to customers with an outstanding balance > 0.
    if (req.query.hasBalance === "true") {
      conds.push(gt(customersTable.outstandingBalance, "0"));
    }

    // Pagination — activated when `page` is explicitly supplied.
    // Omitting falls back to the legacy array shape.
    const rawPage = req.query.page !== undefined ? Number(req.query.page) : null;
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 15)));
    const sortByParam = String(req.query.sortBy ?? "name");
    const sortDirParam = req.query.sortDir === "desc" ? "desc" : "asc";
    const sortColCust =
      sortByParam === "balance"
        ? customersTable.outstandingBalance
        : sortByParam === "createdAt"
          ? customersTable.createdAt
          : customersTable.name;
    const orderExprCust = sortDirParam === "asc" ? asc(sortColCust) : desc(sortColCust);

    if (rawPage !== null && !Number.isNaN(rawPage)) {
      const page = Math.max(1, rawPage);
      const [countRows, sumRows, rows] = await Promise.all([
        db.select({ total: count() }).from(customersTable).where(and(...conds)),
        db.select({ totalOutstanding: sum(customersTable.outstandingBalance) }).from(customersTable).where(and(...conds)),
        db
          .select()
          .from(customersTable)
          .where(and(...conds))
          .orderBy(orderExprCust)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);

      const overdueMap = await getOverdueBalanceMap(
        t.organizationId,
        rows.map((r) => r.id),
      );

      res.json({
        customers: rows.map((r) => ({
          ...serializeCustomer(r),
          overdueBalance: toNum(overdueMap.get(r.id) ?? "0"),
        })),
        total: Number(countRows[0]?.total ?? 0),
        totalOutstanding: sumRows[0]?.totalOutstanding ?? "0",
        page,
        pageSize,
      });
      return;
    }

    const rows = await db
      .select()
      .from(customersTable)
      .where(and(...conds))
      .orderBy(orderExprCust);

    const overdueMap = await getOverdueBalanceMap(
      t.organizationId,
      rows.map((r) => r.id),
    );

    res.json(
      rows.map((r) => ({
        ...serializeCustomer(r),
        overdueBalance: toNum(overdueMap.get(r.id) ?? "0"),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/customers", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const b = req.body ?? {};
    if (!b.name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const inserted = await db
      .insert(customersTable)
      .values({
        organizationId: t.organizationId,
        name: b.name,
        email: b.email ?? null,
        phone: b.phone ?? null,
        company: b.company ?? null,
        gstNumber: b.gstNumber ?? null,
        billingAddress: b.billingAddress ?? null,
        shippingAddress: b.shippingAddress ?? null,
        placeOfSupply: b.placeOfSupply ?? null,
        notes: b.notes ?? null,
      })
      .returning();
    res.status(201).json({ ...serializeCustomer(inserted[0]!), overdueBalance: 0 });
  } catch (err) {
    next(err);
  }
});

router.get("/customers/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const rows = await db
      .select()
      .from(customersTable)
      .where(
        and(eq(customersTable.id, id), eq(customersTable.organizationId, t.organizationId)),
      )
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const overdueMap = await getOverdueBalanceMap(t.organizationId, [id]);
    res.json({ ...serializeCustomer(rows[0]), overdueBalance: toNum(overdueMap.get(id) ?? "0") });
  } catch (err) {
    next(err);
  }
});

router.patch("/customers/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const updates: Record<string, unknown> = {};
    for (const k of [
      "name",
      "email",
      "phone",
      "company",
      "gstNumber",
      "billingAddress",
      "shippingAddress",
      "placeOfSupply",
      "notes",
    ]) {
      if (k in b) updates[k] = b[k];
    }
    const updated = await db
      .update(customersTable)
      .set(updates)
      .where(
        and(eq(customersTable.id, id), eq(customersTable.organizationId, t.organizationId)),
      )
      .returning();
    if (!updated[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const overdueMap = await getOverdueBalanceMap(t.organizationId, [id]);
    res.json({ ...serializeCustomer(updated[0]), overdueBalance: toNum(overdueMap.get(id) ?? "0") });
  } catch (err) {
    next(err);
  }
});

router.delete("/customers/:id", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const id = Number(req.params.id);
    await db
      .delete(customersTable)
      .where(
        and(eq(customersTable.id, id), eq(customersTable.organizationId, t.organizationId)),
      );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
