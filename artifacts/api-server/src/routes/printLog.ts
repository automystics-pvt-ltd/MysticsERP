import { Router, type IRouter } from "express";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";
import { db, printLogTable } from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { validateBody } from "../lib/validate";
import { normalizeRole, ADMIN_ROLES } from "../lib/permissions";

const router: IRouter = Router();

const printLogSchema = z.object({
  documentType: z.string().min(1).max(100),
  documentId: z.number().int().positive().optional(),
});

const PRINT_LIMIT = 2;

router.post(
  "/print-log",
  tenantMiddleware,
  validateBody(printLogSchema),
  async (req, res, next) => {
    try {
      const t = req.tenant!;
      const b = req.body as z.infer<typeof printLogSchema>;
      const role = normalizeRole(t.role);
      const isAdmin = ADMIN_ROLES.includes(role) || t.isSuperAdmin;

      const countRows = await db
        .select({ value: count() })
        .from(printLogTable)
        .where(
          and(
            eq(printLogTable.organizationId, t.organizationId),
            eq(printLogTable.userId, t.userId),
            eq(printLogTable.documentType, b.documentType),
            ...(b.documentId !== undefined
              ? [eq(printLogTable.documentId, b.documentId)]
              : []),
          ),
        );
      const currentCount = Number(countRows[0]?.value ?? 0);

      if (!isAdmin && currentCount >= PRINT_LIMIT) {
        res.json({ allowed: false, count: currentCount });
        return;
      }

      await db.insert(printLogTable).values({
        organizationId: t.organizationId,
        userId: t.userId,
        documentType: b.documentType,
        documentId: b.documentId ?? null,
      });

      res.json({ allowed: true, count: currentCount + 1 });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
