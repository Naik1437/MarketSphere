import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";

export const catalogRouter = Router();

const createProductSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(2000).optional(),
  category: z.string().min(2).max(80),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
});

const updateProductSchema = createProductSchema.partial();

const createSkuSchema = z.object({
  skuCode: z.string().min(2).max(64),
  title: z.string().min(1).max(120),
  price: z.coerce.number().positive(),
  currency: z.string().length(3).default("INR"),
  isActive: z.boolean().optional(),
});

const updateSkuSchema = createSkuSchema.partial();

catalogRouter.get("/", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const category =
    typeof req.query.category === "string" ? req.query.category.trim() : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const where = {
    status: "ACTIVE" as const,
    ...(category ? { category } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        seller: { select: { id: true, businessName: true, slug: true } },
        skus: { where: { isActive: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  res.status(200).json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

catalogRouter.get("/:productId", async (req: Request, res: Response) => {
  const product = await prisma.product.findUnique({
    where: { id: String(req.params.productId) },
    include: {
      seller: { select: { id: true, businessName: true, slug: true } },
      skus: true,
    },
  });
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.status(200).json({ product });
});

catalogRouter.post(
  "/",
  authenticate,
  requireRole("SELLER", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid product payload" });
      return;
    }

    const sellerId = req.user!.sellerId;
    if (!sellerId) {
      res.status(403).json({ error: "Seller profile required" });
      return;
    }

    const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller || seller.status !== "ACTIVE") {
      res.status(403).json({ error: "Seller account must be ACTIVE" });
      return;
    }

    const product = await prisma.product.create({
      data: {
        sellerId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description,
        category: parsed.data.category,
        status: parsed.data.status ?? "DRAFT",
      },
    });

    res.status(201).json({ product });
  }
);

catalogRouter.patch(
  "/:productId",
  authenticate,
  requireRole("SELLER", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid product update payload" });
      return;
    }

    const productId = String(req.params.productId);
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    if (req.user!.role !== "ADMIN" && existing.sellerId !== req.user!.sellerId) {
      res.status(403).json({ error: "Forbidden: product ownership required" });
      return;
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: parsed.data,
    });
    res.status(200).json({ product: updated });
  }
);

catalogRouter.post(
  "/:productId/skus",
  authenticate,
  requireRole("SELLER", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = createSkuSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid SKU payload" });
      return;
    }

    const productId = String(req.params.productId);
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    if (req.user!.role !== "ADMIN" && product.sellerId !== req.user!.sellerId) {
      res.status(403).json({ error: "Forbidden: product ownership required" });
      return;
    }

    const sku = await prisma.sku.create({
      data: {
        productId,
        skuCode: parsed.data.skuCode,
        title: parsed.data.title,
        price: parsed.data.price.toFixed(2),
        currency: parsed.data.currency,
        isActive: parsed.data.isActive ?? true,
      },
    });
    res.status(201).json({ sku });
  }
);

catalogRouter.patch(
  "/skus/:skuId",
  authenticate,
  requireRole("SELLER", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = updateSkuSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid SKU update payload" });
      return;
    }

    const skuId = String(req.params.skuId);
    const existing = await prisma.sku.findUnique({
      where: { id: skuId },
      include: { product: { select: { sellerId: true } } },
    });
    if (!existing) {
      res.status(404).json({ error: "SKU not found" });
      return;
    }

    if (
      req.user!.role !== "ADMIN" &&
      existing.product.sellerId !== req.user!.sellerId
    ) {
      res.status(403).json({ error: "Forbidden: SKU ownership required" });
      return;
    }

    const updated = await prisma.sku.update({
      where: { id: skuId },
      data: {
        ...parsed.data,
        ...(parsed.data.price !== undefined
          ? { price: parsed.data.price.toFixed(2) }
          : {}),
      },
    });
    res.status(200).json({ sku: updated });
  }
);
