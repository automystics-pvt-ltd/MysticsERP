import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, salesChannelWarehouseDefaultsTable, warehousesTable } from "@workspace/db";
import { tenantMiddleware } from "../lib/tenant";
import { validateBody } from "../lib/validate";
import { POS_SALE_CHANNELS } from "../lib/posCheckout";

const router: IRouter = Router();

router.use(tenantMiddleware);

router.get("/sales-channel-defaults", async (req, res, next) => {
  try {
    const t = req.tenant!;
    const rows = await db
      .select({
        salesChannel: salesChannelWarehouseDefaultsTable.salesChannel,
        warehouseId: salesChannelWarehouseDefaultsTable.warehouseId,
        warehouseName: warehousesTable.name,
      })
      .from(salesChannelWarehouseDefaultsTable)
      .innerJoin(
        warehousesTable,
        eq(salesChannelWarehouseDefaultsTable.warehouseId, warehousesTable.id),
      )
      .where(eq(salesChannelWarehouseDefaultsTable.organizationId, t.organizationId));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const putSchema = z.object({
  warehouseId: z.number().int().positive().nullable(),
});

// PUT /:channel — ADD a warehouse to the channel.
// warehouseId: null removes ALL warehouses from the channel (clear).
router.put(
  "/sales-channel-defaults/:channel",
  validateBody(putSchema),
  async (req, res, next) => {
    try {
      const t = req.tenant!;
      const channel = req.params.channel as string;
      if (!(POS_SALE_CHANNELS as readonly string[]).includes(channel)) {
        res.status(400).json({ error: "Unknown sales channel" });
        return;
      }
      const { warehouseId } = req.body as z.infer<typeof putSchema>;

      if (warehouseId === null) {
        await db
          .delete(salesChannelWarehouseDefaultsTable)
          .where(
            and(
              eq(salesChannelWarehouseDefaultsTable.organizationId, t.organizationId),
              eq(salesChannelWarehouseDefaultsTable.salesChannel, channel),
            ),
          );
        res.json({ salesChannel: channel, warehouseId: null, warehouseName: null });
        return;
      }

      const [wh] = await db
        .select({ id: warehousesTable.id, name: warehousesTable.name })
        .from(warehousesTable)
        .where(
          and(
            eq(warehousesTable.id, warehouseId),
            eq(warehousesTable.organizationId, t.organizationId),
          ),
        )
        .limit(1);

      if (!wh) {
        res.status(400).json({ error: "Warehouse not found" });
        return;
      }

      // Add this warehouse to the channel; silently ignore if already present.
      await db
        .insert(salesChannelWarehouseDefaultsTable)
        .values({
          organizationId: t.organizationId,
          salesChannel: channel,
          warehouseId,
        })
        .onConflictDoNothing();

      res.json({ salesChannel: channel, warehouseId, warehouseName: wh.name });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /:channel/:warehouseId — remove a specific warehouse from a channel.
router.delete(
  "/sales-channel-defaults/:channel/:warehouseId",
  async (req, res, next) => {
    try {
      const t = req.tenant!;
      const channel = req.params.channel as string;
      const warehouseId = Number(req.params.warehouseId);
      if (!(POS_SALE_CHANNELS as readonly string[]).includes(channel) || !warehouseId) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      await db
        .delete(salesChannelWarehouseDefaultsTable)
        .where(
          and(
            eq(salesChannelWarehouseDefaultsTable.organizationId, t.organizationId),
            eq(salesChannelWarehouseDefaultsTable.salesChannel, channel),
            eq(salesChannelWarehouseDefaultsTable.warehouseId, warehouseId),
          ),
        );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
