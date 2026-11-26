import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  authenticate,
  requireOwnership,
  requireRole,
} from "../middleware/auth";

export const postOrderRouter = Router();

postOrderRouter.post(
  "/orders/:orderId/returns",
  authenticate,
  requireRole("CUSTOMER"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({ reason: z.string().min(5).max(500) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid return payload" });
      return;
    }

    const orderId = String(req.params.orderId);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.customerId !== req.user!.sub) {
      res.status(403).json({ error: "Forbidden: order ownership required" });
      return;
    }

    const ret = await prisma.returnRequest.create({
      data: { orderId, reason: parsed.data.reason, status: "REQUESTED" },
    });
    res.status(201).json({ returnRequest: ret });
  }
);

postOrderRouter.post(
  "/payments/:paymentId/refunds",
  authenticate,
  requireRole("SUPPORT_AGENT", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        amount: z.coerce.number().positive(),
        returnId: z.string().optional(),
        idempotencyKey: z.string().min(8).max(128),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid refund payload" });
      return;
    }

    const existing = await prisma.refund.findUnique({
      where: { idempotencyKey: parsed.data.idempotencyKey },
    });
    if (existing) {
      res.status(200).json({ refund: existing, deduplicated: true });
      return;
    }

    const paymentId = String(req.params.paymentId);
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { refunds: true },
    });
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    const alreadyRefunded = payment.refunds.reduce(
      (sum, r) => sum + Number(r.amount),
      0
    );
    if (alreadyRefunded + parsed.data.amount > Number(payment.amount)) {
      res.status(409).json({ error: "Refund exceeds captured payment amount" });
      return;
    }

    const refund = await prisma.refund.create({
      data: {
        paymentId,
        returnId: parsed.data.returnId,
        amount: parsed.data.amount.toFixed(2),
        status: "PROCESSED",
        idempotencyKey: parsed.data.idempotencyKey,
      },
    });
    res.status(201).json({ refund });
  }
);

postOrderRouter.post(
  "/products/:productId/reviews",
  authenticate,
  requireRole("CUSTOMER"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid review payload" });
      return;
    }

    const productId = String(req.params.productId);
    const review = await prisma.review.upsert({
      where: { productId_userId: { productId, userId: req.user!.sub } },
      update: { rating: parsed.data.rating, comment: parsed.data.comment },
      create: {
        productId,
        userId: req.user!.sub,
        rating: parsed.data.rating,
        comment: parsed.data.comment,
      },
    });
    res.status(201).json({ review });
  }
);

postOrderRouter.post(
  "/orders/:orderId/disputes",
  authenticate,
  requireRole("CUSTOMER"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({ reason: z.string().min(5).max(500) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid dispute payload" });
      return;
    }

    const orderId = String(req.params.orderId);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.customerId !== req.user!.sub) {
      res.status(403).json({ error: "Forbidden: order ownership required" });
      return;
    }

    const dispute = await prisma.dispute.create({
      data: {
        orderId,
        raisedById: req.user!.sub,
        reason: parsed.data.reason,
        status: "OPEN",
      },
    });
    res.status(201).json({ dispute });
  }
);

postOrderRouter.get(
  "/sellers/:sellerId/settlements",
  authenticate,
  requireRole("SELLER", "ADMIN"),
  requireOwnership((req) => String(req.params.sellerId)),
  async (req: Request, res: Response) => {
    const settlements = await prisma.settlement.findMany({
      where: { sellerId: String(req.params.sellerId) },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ settlements });
  }
);

postOrderRouter.get(
  "/returns",
  authenticate,
  requireRole("SUPPORT_AGENT", "ADMIN"),
  async (_req: Request, res: Response) => {
    const returns = await prisma.returnRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            payments: { select: { id: true, amount: true, status: true } },
          },
        },
      },
    });
    res.status(200).json({ returns });
  }
);

postOrderRouter.patch(
  "/returns/:returnId/status",
  authenticate,
  requireRole("SUPPORT_AGENT", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({ status: z.enum(["APPROVED", "REJECTED", "RECEIVED", "COMPLETED"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid return status" });
      return;
    }
    const updated = await prisma.returnRequest.update({
      where: { id: String(req.params.returnId) },
      data: { status: parsed.data.status },
    });
    res.status(200).json({ returnRequest: updated });
  }
);

postOrderRouter.get(
  "/disputes",
  authenticate,
  requireRole("SUPPORT_AGENT", "ADMIN"),
  async (_req: Request, res: Response) => {
    const disputes = await prisma.dispute.findMany({
      orderBy: { createdAt: "desc" },
      include: { order: { select: { id: true, orderNumber: true } } },
    });
    res.status(200).json({ disputes });
  }
);

postOrderRouter.patch(
  "/disputes/:disputeId/status",
  authenticate,
  requireRole("SUPPORT_AGENT", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        status: z.enum(["UNDER_REVIEW", "RESOLVED", "CLOSED"]),
        resolution: z.string().max(1000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid dispute status" });
      return;
    }
    const updated = await prisma.dispute.update({
      where: { id: String(req.params.disputeId) },
      data: parsed.data,
    });
    res.status(200).json({ dispute: updated });
  }
);

postOrderRouter.get(
  "/promotions",
  authenticate,
  requireRole("ADMIN"),
  async (_req: Request, res: Response) => {
    const promotions = await prisma.promotion.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ promotions });
  }
);

postOrderRouter.post(
  "/promotions",
  authenticate,
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        code: z.string().trim().min(2).max(40).toUpperCase(),
        discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
        discountValue: z.coerce.number().positive(),
        minOrderTotal: z.coerce.number().min(0).default(0),
        maxUses: z.coerce.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid promotion payload" });
      return;
    }
    const now = new Date();
    const endsAt = new Date(now.getTime() + 30 * 86400_000);
    const promotion = await prisma.promotion.create({
      data: {
        code: parsed.data.code,
        discountType: parsed.data.discountType,
        discountValue: parsed.data.discountValue.toFixed(2),
        minOrderTotal: parsed.data.minOrderTotal.toFixed(2),
        maxUses: parsed.data.maxUses,
        startsAt: now,
        endsAt,
        isActive: true,
      },
    });
    res.status(201).json({ promotion });
  }
);

postOrderRouter.get(
  "/admin/overview",
  authenticate,
  requireRole("ADMIN"),
  async (_req: Request, res: Response) => {
    const [users, sellers, products, orders] = await Promise.all([
      prisma.user.count(),
      prisma.seller.count(),
      prisma.product.count(),
      prisma.order.count(),
    ]);
    res.status(200).json({ overview: { users, sellers, products, orders } });
  }
);
