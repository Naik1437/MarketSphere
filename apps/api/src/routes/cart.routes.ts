import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";

export const cartRouter = Router();

const addItemSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().positive().max(100),
});

cartRouter.get(
  "/",
  authenticate,
  requireRole("CUSTOMER"),
  async (req: Request, res: Response) => {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user!.sub },
      include: {
        items: {
          include: {
            sku: {
              select: { id: true, skuCode: true, title: true, price: true, currency: true },
            },
          },
        },
      },
    });
    res.status(200).json({ cart: cart ?? { userId: req.user!.sub, items: [] } });
  }
);

cartRouter.post(
  "/items",
  authenticate,
  requireRole("CUSTOMER"),
  async (req: Request, res: Response) => {
    const parsed = addItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid cart item payload" });
      return;
    }

    const sku = await prisma.sku.findUnique({ where: { id: parsed.data.skuId } });
    if (!sku || !sku.isActive) {
      res.status(404).json({ error: "Active SKU not found" });
      return;
    }

    const cart = await prisma.cart.upsert({
      where: { userId: req.user!.sub },
      update: {},
      create: { userId: req.user!.sub },
    });

    const item = await prisma.cartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId: sku.id } },
      update: { quantity: parsed.data.quantity },
      create: {
        cartId: cart.id,
        skuId: sku.id,
        quantity: parsed.data.quantity,
      },
    });

    res.status(200).json({ item });
  }
);

cartRouter.delete(
  "/items/:skuId",
  authenticate,
  requireRole("CUSTOMER"),
  async (req: Request, res: Response) => {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user!.sub },
    });
    if (!cart) {
      res.status(200).json({ ok: true });
      return;
    }

    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id, skuId: String(req.params.skuId) },
    });
    res.status(200).json({ ok: true });
  }
);
