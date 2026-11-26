import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import {
  adjustInventory,
  InsufficientStockError,
} from "../services/inventory.service";

export const inventoryRouter = Router();

const adjustSchema = z.object({
  skuId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantityDelta: z.number().int().refine((n) => n !== 0, "Delta must be non-zero"),
  movementType: z.enum(["RESTOCK", "ADJUSTMENT"]),
  idempotencyKey: z.string().min(8).max(128),
});

inventoryRouter.post(
  "/adjust",
  authenticate,
  requireRole("WAREHOUSE_OPERATOR", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid inventory adjustment payload" });
      return;
    }

    try {
      const inventory = await adjustInventory({
        skuId: parsed.data.skuId,
        warehouseId: parsed.data.warehouseId,
        quantityDelta: parsed.data.quantityDelta,
        movementType: parsed.data.movementType,
        referenceType: "ManualAdjustment",
        referenceId: req.user!.sub,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      res.status(200).json({ inventory });
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

inventoryRouter.get(
  "/:skuId",
  authenticate,
  requireRole("WAREHOUSE_OPERATOR", "SELLER", "ADMIN"),
  async (req: Request, res: Response) => {
    const skuId = String(req.params.skuId);
    const inventories = await prisma.inventory.findMany({
      where: { skuId },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        ledger: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    res.status(200).json({ inventories });
  }
);
