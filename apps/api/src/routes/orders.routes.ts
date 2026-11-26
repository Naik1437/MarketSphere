import { OrderStatus } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { paymentProvider } from "../integrations/payment.interface";
import { shippingProvider } from "../integrations/shipping.interface";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import { scheduleReservationExpiry } from "../queues/reservation.queue";
import {
  InsufficientStockError,
  reserveStockInTx,
} from "../services/inventory.service";

export const ordersRouter = Router();

const checkoutSchema = z.object({
  warehouseId: z.string().min(1),
  promotionCode: z.string().trim().min(2).max(40).optional(),
  idempotencyKey: z.string().min(8).max(128),
  items: z
    .array(
      z.object({
        skuId: z.string().min(1),
        quantity: z.number().int().positive().max(100),
      })
    )
    .min(1)
    .max(50),
});

const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

ordersRouter.post(
  "/checkout",
  authenticate,
  requireRole("CUSTOMER"),
  async (req: Request, res: Response) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid checkout payload" });
      return;
    }

    const { warehouseId, promotionCode, idempotencyKey, items } = parsed.data;

    const existingOrder = await prisma.order.findUnique({
      where: {
        customerId_idempotencyKey: {
          customerId: req.user!.sub,
          idempotencyKey,
        },
      },
      include: { items: true, payments: true, reservations: true },
    });
    if (existingOrder) {
      res.status(200).json({ order: existingOrder, deduplicated: true });
      return;
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const skuIds = items.map((i) => i.skuId);
        const skus = await tx.sku.findMany({
          where: { id: { in: skuIds }, isActive: true },
          include: {
            product: {
              select: {
                sellerId: true,
                seller: { select: { commissionRate: true } },
              },
            },
          },
        });

        if (skus.length !== skuIds.length) {
          throw new Error("INVALID_SKU");
        }

        const skuMap = new Map(skus.map((s) => [s.id, s]));
        let subtotal = 0;
        let discountAmount = 0;
        let totalAmount = 0;
        let promotionId: string | null = null;
        let promoRule: {
          code: string;
          discount_type: "PERCENTAGE" | "FIXED_AMOUNT";
          discount_value: string;
          min_order_total: string;
        } | null = null;

        if (promotionCode) {
          const promo = await tx.promotion.findUnique({
            where: { code: promotionCode },
          });
          const now = new Date();
          const rawSub = items.reduce(
            (s, i) => s + Number(skuMap.get(i.skuId)!.price) * i.quantity,
            0
          );
          if (
            !promo ||
            !promo.isActive ||
            promo.startsAt > now ||
            promo.endsAt < now ||
            (promo.maxUses !== null && promo.usedCount >= promo.maxUses) ||
            rawSub < Number(promo.minOrderTotal)
          ) {
            throw new Error("INVALID_PROMOTION");
          }
          promotionId = promo.id;
          promoRule = {
            code: promo.code,
            discount_type: promo.discountType,
            discount_value: promo.discountValue.toString(),
            min_order_total: promo.minOrderTotal.toString(),
          };
          await tx.promotion.update({
            where: { id: promo.id },
            data: { usedCount: { increment: 1 } },
          });
        }

        const pyUrl = process.env.PYTHON_ENGINE_URL || "http://python-engine:8000";
        let pyPricing: {
          subtotal: string;
          discount_amount: string;
          total_amount: string;
          lines: Array<{
            sku_code: string;
            line_total: string;
            commission_amount: string;
            net_seller_amount: string;
          }>;
        } | null = null;

        try {
          const pyRes = await fetch(`${pyUrl}/api/v1/pricing/calculate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: items.map((item) => {
                const sku = skuMap.get(item.skuId)!;
                return {
                  sku_code: sku.skuCode,
                  unit_price: sku.price.toString(),
                  quantity: item.quantity,
                  commission_rate: sku.product.seller.commissionRate.toString(),
                };
              }),
              ...(promoRule ? { promotion: promoRule } : {}),
            }),
            signal: AbortSignal.timeout(1500),
          });
          if (pyRes.ok) {
            pyPricing = (await pyRes.json()) as typeof pyPricing;
          }
        } catch {
          // Fallback to deterministic local calculation if Python engine is unreachable
        }

        const orderItemsData = items.map((item, idx) => {
          const sku = skuMap.get(item.skuId)!;
          const unitPrice = Number(sku.price);
          const pyLine = pyPricing?.lines[idx];
          const totalPrice = pyLine ? Number(pyLine.line_total) : unitPrice * item.quantity;
          const commissionRate = Number(sku.product.seller.commissionRate);
          const commissionAmt = pyLine
            ? Number(pyLine.commission_amount)
            : (totalPrice * commissionRate) / 100;
          const netSellerAmt = pyLine
            ? Number(pyLine.net_seller_amount)
            : totalPrice - commissionAmt;
          subtotal += totalPrice;
          return {
            skuId: sku.id,
            sellerId: sku.product.sellerId,
            quantity: item.quantity,
            unitPrice: unitPrice.toFixed(2),
            totalPrice: totalPrice.toFixed(2),
            commissionAmt: commissionAmt.toFixed(2),
            netSellerAmt: netSellerAmt.toFixed(2),
          };
        });

        if (pyPricing) {
          subtotal = Number(pyPricing.subtotal);
          discountAmount = Number(pyPricing.discount_amount);
          totalAmount = Number(pyPricing.total_amount);
        } else {
          if (promoRule) {
            discountAmount =
              promoRule.discount_type === "PERCENTAGE"
                ? (subtotal * Number(promoRule.discount_value)) / 100
                : Number(promoRule.discount_value);
            discountAmount = Math.min(subtotal, Math.max(0, discountAmount));
          }
          totalAmount = Math.max(0, subtotal - discountAmount);
        }

        const orderNumber = `MS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        const order = await tx.order.create({
          data: {
            orderNumber,
            customerId: req.user!.sub,
            promotionId,
            status: "PENDING",
            subtotalAmount: subtotal.toFixed(2),
            discountAmount: discountAmount.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            currency: "INR",
            idempotencyKey,
          },
        });

        for (const oi of orderItemsData) {
          const createdItem = await tx.orderItem.create({
            data: {
              orderId: order.id,
              skuId: oi.skuId,
              sellerId: oi.sellerId,
              quantity: oi.quantity,
              unitPrice: oi.unitPrice,
              totalPrice: oi.totalPrice,
            },
          });

          await tx.commission.create({
            data: {
              sellerId: oi.sellerId,
              orderItemId: createdItem.id,
              commissionAmount: oi.commissionAmt,
              netSellerAmount: oi.netSellerAmt,
            },
          });
        }

        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const reservations = [];
        for (const item of items) {
          const r = await reserveStockInTx(tx, {
            skuId: item.skuId,
            warehouseId,
            orderId: order.id,
            quantity: item.quantity,
            expiresAt,
            idempotencyKey: `reserve:${req.user!.sub}:${idempotencyKey}:${item.skuId}`,
          });
          reservations.push(r);
        }

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            provider: "pending",
            amount: totalAmount.toFixed(2),
            currency: "INR",
            status: "PENDING",
            idempotencyKey: `pay:${req.user!.sub}:${idempotencyKey}`,
          },
        });

        return { order, payment, reservations, totalAmount };
      });

      // External payment authorization outside DB transaction
      const payAuth = await paymentProvider.authorize({
        orderId: result.order.id,
        amount: result.totalAmount,
        currency: "INR",
        idempotencyKey: `${req.user!.sub}:${idempotencyKey}`,
      });

      const finalizedOrder = await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: result.payment.id },
          data: {
            provider: payAuth.provider,
            providerPaymentId: payAuth.providerPaymentId,
            status: payAuth.status,
          },
        });
        return tx.order.update({
          where: { id: result.order.id },
          data: {
            status: payAuth.status === "CAPTURED" ? "CONFIRMED" : "CANCELLED",
          },
          include: { items: true, payments: true, reservations: true },
        });
      });

      for (const r of result.reservations) {
        await scheduleReservationExpiry(r.id, 15 * 60 * 1000).catch(() => {});
      }

      res.status(201).json({ order: finalizedOrder });
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof Error && err.message === "INVALID_SKU") {
        res.status(404).json({ error: "One or more active SKUs not found" });
        return;
      }
      if (err instanceof Error && err.message === "INVALID_PROMOTION") {
        res.status(400).json({ error: "Promotion code is invalid or ineligible" });
        return;
      }
      throw err;
    }
  }
);

ordersRouter.get(
  "/",
  authenticate,
  async (req: Request, res: Response) => {
    const isSeller = req.user!.role === "SELLER";
    const sellerId = req.user!.sellerId ?? "";
    const where =
      req.user!.role === "CUSTOMER"
        ? { customerId: req.user!.sub }
        : isSeller
          ? { items: { some: { sellerId } } }
          : {};

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        items: isSeller ? { where: { sellerId } } : true,
        shipments: true,
      },
    });
    res.status(200).json({ orders });
  }
);

ordersRouter.get(
  "/:orderId",
  authenticate,
  async (req: Request, res: Response) => {
    const isSeller = req.user!.role === "SELLER";
    const sellerId = req.user!.sellerId ?? "";
    const order = await prisma.order.findUnique({
      where: { id: String(req.params.orderId) },
      include: {
        items: isSeller ? { where: { sellerId } } : true,
        payments: !isSeller,
        shipments: true,
        reservations: !isSeller,
      },
    });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (
      req.user!.role === "CUSTOMER" &&
      order.customerId !== req.user!.sub
    ) {
      res.status(403).json({ error: "Forbidden: order ownership required" });
      return;
    }

    if (isSeller && order.items.length === 0) {
      res.status(403).json({ error: "Forbidden: seller order ownership required" });
      return;
    }

    res.status(200).json({ order });
  }
);

ordersRouter.patch(
  "/:orderId/status",
  authenticate,
  requireRole("WAREHOUSE_OPERATOR", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        status: z.enum([
          "PENDING",
          "CONFIRMED",
          "PROCESSING",
          "SHIPPED",
          "DELIVERED",
          "CANCELLED",
          "REFUNDED",
        ]),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid status payload" });
      return;
    }

    const orderId = String(req.params.orderId);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const allowed = ALLOWED_ORDER_TRANSITIONS[order.status];
    if (!allowed.includes(parsed.data.status)) {
      res.status(409).json({
        error: `Invalid order transition from ${order.status} to ${parsed.data.status}`,
      });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: parsed.data.status },
    });
    res.status(200).json({ order: updated });
  }
);

ordersRouter.post(
  "/:orderId/shipments",
  authenticate,
  requireRole("WAREHOUSE_OPERATOR", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        warehouseId: z.string().min(1),
        carrier: z.string().min(2).max(60),
        idempotencyKey: z.string().min(4).max(128).optional(),
        items: z
          .array(
            z.object({
              skuId: z.string().min(1),
              quantity: z.number().int().positive(),
            })
          )
          .optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid shipment payload" });
      return;
    }

    const orderId = String(req.params.orderId);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || !["CONFIRMED", "PROCESSING", "SHIPPED"].includes(order.status)) {
      res.status(409).json({ error: "Order is not ready for shipment" });
      return;
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: parsed.data.warehouseId },
    });
    if (!warehouse) {
      res.status(404).json({ error: "Warehouse not found" });
      return;
    }

    if (parsed.data.idempotencyKey) {
      const existingByKey = await prisma.shipment.findFirst({
        where: {
          orderId,
          trackingNumber: { contains: parsed.data.idempotencyKey.slice(-6).toUpperCase() },
        },
      });
      if (existingByKey) {
        res.status(200).json({ shipment: existingByKey, deduplicated: true });
        return;
      }
    } else {
      const existingShipment = await prisma.shipment.findFirst({
        where: {
          orderId,
          warehouseId: warehouse.id,
          carrier: parsed.data.carrier,
          status: "LABEL_CREATED",
        },
      });
      if (existingShipment) {
        res.status(409).json({ error: "Duplicate active shipment for order/warehouse/carrier" });
        return;
      }
    }

    const label = await shippingProvider.createLabel({
      orderId,
      warehouseCode: warehouse.code,
      carrier: parsed.data.carrier,
    });

    const trackingNumber = parsed.data.idempotencyKey
      ? `${label.trackingNumber}-${parsed.data.idempotencyKey.slice(-6).toUpperCase()}`
      : label.trackingNumber;

    const shipment = await prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          orderId,
          warehouseId: warehouse.id,
          carrier: parsed.data.carrier,
          trackingNumber,
          status: label.status,
        },
      });
      if (order.status === "CONFIRMED") {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "PROCESSING" },
        });
      }
      return created;
    });

    res.status(201).json({ shipment });
  }
);

ordersRouter.patch(
  "/shipments/:shipmentId/status",
  authenticate,
  requireRole("WAREHOUSE_OPERATOR", "ADMIN"),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        status: z.enum(["IN_TRANSIT", "DELIVERED", "FAILED"]),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid shipment status" });
      return;
    }

    const shipmentId = String(req.params.shipmentId);
    const existing = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!existing) {
      res.status(404).json({ error: "Shipment not found" });
      return;
    }

    const allowedShipTransitions: Record<string, string[]> = {
      PENDING: ["LABEL_CREATED", "IN_TRANSIT", "FAILED"],
      LABEL_CREATED: ["IN_TRANSIT", "FAILED"],
      IN_TRANSIT: ["DELIVERED", "FAILED"],
      DELIVERED: [],
      FAILED: [],
    };
    if (!allowedShipTransitions[existing.status]?.includes(parsed.data.status)) {
      res.status(409).json({
        error: `Invalid shipment transition from ${existing.status} to ${parsed.data.status}`,
      });
      return;
    }

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        status: parsed.data.status,
        ...(parsed.data.status === "IN_TRANSIT" ? { shippedAt: new Date() } : {}),
        ...(parsed.data.status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      },
    });
    res.status(200).json({ shipment: updated });
  }
);
