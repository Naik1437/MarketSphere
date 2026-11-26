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
