import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  authenticate,
  requireOwnership,
  requireRole,
} from "../middleware/auth";

export const sellersRouter = Router();

const onboardSchema = z.object({
  businessName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
});

const statusSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED"]),
  commissionRate: z.coerce.number().min(0).max(50).optional(),
});

sellersRouter.post(
  "/onboard",
  authenticate,
  requireRole("CUSTOMER", "SELLER"),
  async (req: Request, res: Response) => {
    const parsed = onboardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid seller onboarding payload" });
      return;
    }

    const existing = await prisma.seller.findUnique({
      where: { userId: req.user!.sub },
    });
    if (existing) {
      res.status(409).json({ error: "Seller profile already exists" });
      return;
    }

    const slugTaken = await prisma.seller.findUnique({
      where: { slug: parsed.data.slug },
    });
    if (slugTaken) {
      res.status(409).json({ error: "Seller slug already in use" });
      return;
    }

    const seller = await prisma.$transaction(async (tx) => {
      const created = await tx.seller.create({
        data: {
          userId: req.user!.sub,
          businessName: parsed.data.businessName,
          slug: parsed.data.slug,
          status: "PENDING",
        },
      });
      await tx.user.update({
        where: { id: req.user!.sub },
        data: { role: "SELLER" },
      });
      await tx.auditRecord.create({
        data: {
          actorId: req.user!.sub,
          action: "SELLER_ONBOARD",
          entityType: "Seller",
          entityId: created.id,
        },
      });
      return created;
    });

    res.status(201).json({ seller });
  }
);

sellersRouter.patch(
  "/:sellerId/status",
  authenticate,
  requireRole("ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid seller status payload" });
      return;
    }

    const sellerId = String(req.params.sellerId);
    const existing = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!existing) {
      res.status(404).json({ error: "Seller not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.seller.update({
        where: { id: sellerId },
        data: {
          status: parsed.data.status,
          ...(parsed.data.commissionRate !== undefined
            ? { commissionRate: parsed.data.commissionRate.toFixed(2) }
            : {}),
        },
      });
      await tx.auditRecord.create({
        data: {
          actorId: req.user!.sub,
          action: "SELLER_STATUS_UPDATE",
          entityType: "Seller",
          entityId: sellerId,
          metadata: { status: parsed.data.status },
        },
      });
      return s;
    });

    res.status(200).json({ seller: updated });
  }
);

sellersRouter.get(
  "/:sellerId",
  authenticate,
  requireRole("SELLER", "ADMIN"),
  requireOwnership((req) => String(req.params.sellerId)),
  async (req: Request, res: Response) => {
    const seller = await prisma.seller.findUnique({
      where: { id: String(req.params.sellerId) },
    });
    if (!seller) {
      res.status(404).json({ error: "Seller not found" });
      return;
    }
    res.status(200).json({ seller });
  }
);
