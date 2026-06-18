import { and, gt, isNotNull, sql } from "drizzle-orm";
import { db, itemsTable, itemWarehouseStockTable, stockMovementsTable } from "@workspace/db";
import { logger } from "./logger";
import { toNum, toStr } from "./numeric";

/**
 * One-time startup repair: find every item_warehouse_stock row that has a
 * non-zero quantity but belongs to an archived (soft-deleted) item.  These
 * rows are orphans from deletes that happened before the transaction-safe
 * deletion logic was in place.
 *
 * For each orphan we:
 *  1. Insert a write_off stock_movement so the audit trail is complete.
 *  2. Zero the quantity so warehouse stock-summaries and reorder reports
 *     never see the phantom units again — even if the archivedAt JOIN is
 *     somehow skipped by a future query.
 *
 * The function is idempotent: rows already at 0 are never touched.
 */
export async function cleanupOrphanedArchivedStock(): Promise<void> {
  try {
    // Find all non-zero stock rows whose item has been archived.
    const orphans = await db
      .select({
        id: itemWarehouseStockTable.id,
        organizationId: itemWarehouseStockTable.organizationId,
        itemId: itemWarehouseStockTable.itemId,
        warehouseId: itemWarehouseStockTable.warehouseId,
        quantity: itemWarehouseStockTable.quantity,
      })
      .from(itemWarehouseStockTable) // org-scope-allow: startup repair scans all orgs to zero orphaned stock; no org filter needed — we process every archived item's stock rows
      .innerJoin(
        itemsTable,
        and(
          sql`${itemsTable.id} = ${itemWarehouseStockTable.itemId}`,
          isNotNull(itemsTable.archivedAt),
        ),
      )
      .where(gt(itemWarehouseStockTable.quantity, "0"));

    if (orphans.length === 0) {
      logger.info("stockCleanup: no orphaned stock rows found");
      return;
    }

    logger.info({ count: orphans.length }, "stockCleanup: zeroing orphaned stock rows");

    await db.transaction(async (tx) => {
      for (const row of orphans) {
        const qty = toNum(row.quantity);
        if (qty <= 0) continue;

        // Write a write_off movement so the history is auditable.
        await tx.insert(stockMovementsTable).values({
          organizationId: row.organizationId,
          itemId: row.itemId,
          warehouseId: row.warehouseId,
          movementType: "write_off",
          quantity: toStr(-qty),
          notes: "Archived item — orphaned stock zeroed on startup",
        });
      }

      // Zero all orphaned rows in one UPDATE per org+item pair to keep
      // the statement count small even when there are many orphans.
      await tx
        .update(itemWarehouseStockTable) // org-scope-allow: updating only the specific rows fetched above (by PK); each row belongs to its own org
        .set({ quantity: "0" })
        .where(
          sql`${itemWarehouseStockTable.id} IN (${sql.join(
            orphans.map((r) => sql`${r.id}`),
            sql`, `,
          )})`,
        );
    });

    logger.info({ count: orphans.length }, "stockCleanup: orphaned stock zeroed successfully");
  } catch (err) {
    // Log but do not crash the server — this is a best-effort repair.
    logger.error({ err }, "stockCleanup: failed to zero orphaned stock rows");
  }
}
