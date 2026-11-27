import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import {
  adjustInventory,
  InsufficientStockError,
} from "../services/inventory.service";

export const inventoryRouter = Router();

inventoryRouter.get(
  "/warehouses",
  authenticate,
  async (_req: Request, res: Response) => {
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
    });
    res.status(200).json({ warehouses });
  }
);

inventoryRouter.get(
  "/skus",
  authenticate,
  requireRole("WAREHOUSE_OPERATOR", "SELLER", "ADMIN"),
  async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const skus = await prisma.sku.findMany({
      where: {
        isActive: true,
        ...(q
          ? {
              OR: [
                { skuCode: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
                { product: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      take: 50,
      orderBy: { skuCode: "asc" },
      select: {
        id: true,
        skuCode: true,
        title: true,
        product: { select: { name: true } },
      },
    });
    res.status(200).json({ skus });
  }
);

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

    const [sku, warehouse] = await Promise.all([
      prisma.sku.findUnique({ where: { id: parsed.data.skuId }, select: { id: true } }),
      prisma.warehouse.findUnique({
        where: { id: parsed.data.warehouseId },
        select: { id: true },
      }),
    ]);
    if (!sku) {
      res.status(404).json({ error: "SKU not found" });
      return;
    }
    if (!warehouse) {
      res.status(404).json({ error: "Warehouse not found" });
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
    if (req.user!.role === "SELLER") {
      const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        include: { product: { select: { sellerId: true } } },
      });
      if (!sku) {
        res.status(404).json({ error: "SKU not found" });
        return;
      }
      if (sku.product.sellerId !== req.user!.sellerId) {
        res.status(403).json({ error: "Forbidden: SKU ownership required" });
        return;
      }
    }
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
