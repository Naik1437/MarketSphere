import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { expireReservationById } from "../src/services/inventory.service";

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || "DemoPass!2026";

async function login(email: string) {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: DEMO_PASSWORD });
  expect(res.status).toBe(200);
  return res.body as {
    accessToken: string;
    user: { id: string; sellerId?: string | null };
  };
}

describe("MarketSphere Core Commerce & Reservation Engine", () => {
  let warehouseId: string;
  let lastItemSkuId: string;
  let seller2ProductId: string;
  let seller1Token: string;
  let seller2Token: string;
  let seller2Id: string;
  let customer1Token: string;
  let customer2Token: string;
  let warehouseToken: string;
  let supportToken: string;

  beforeAll(async () => {
    const [s1, s2, c1, c2, wh, sup] = await Promise.all([
      login("seller1@marketsphere.local"),
      login("seller2@marketsphere.local"),
      login("customer1@marketsphere.local"),
      login("customer2@marketsphere.local"),
      login("warehouse@marketsphere.local"),
      login("support@marketsphere.local"),
    ]);

    seller1Token = s1.accessToken;
    seller2Token = s2.accessToken;
    seller2Id = s2.user.sellerId!;
    customer1Token = c1.accessToken;
    customer2Token = c2.accessToken;
    warehouseToken = wh.accessToken;
    supportToken = sup.accessToken;

    const warehouse = await prisma.warehouse.findUniqueOrThrow({
      where: { code: "WH-BLR-01" },
    });
    warehouseId = warehouse.id;

    // Create a dedicated SKU with exactly 1 unit for concurrent last-item test
    const prod = await prisma.product.findFirstOrThrow({
      where: { slug: "wireless-mouse-pro" },
    });
    const uniqueCode = `LAST-ITEM-${Date.now()}`;
    const sku = await prisma.sku.create({
      data: {
        productId: prod.id,
        skuCode: uniqueCode,
        title: "Limited Edition",
        price: "500.00",
        currency: "INR",
        isActive: true,
      },
    });
    lastItemSkuId = sku.id;

    await prisma.inventory.create({
      data: {
        skuId: lastItemSkuId,
        warehouseId,
        available: 1,
        reserved: 0,
      },
    });

    const s2Prod = await prisma.product.findFirstOrThrow({
      where: { sellerId: seller2Id },
    });
    seller2ProductId = s2Prod.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("prevents overselling on concurrent last-item checkout (capstone)", async () => {
    const key1 = `conc-1-${Date.now()}`;
    const key2 = `conc-2-${Date.now()}`;

    const [r1, r2] = await Promise.all([
      request(app)
        .post("/api/v1/orders/checkout")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({
          warehouseId,
          idempotencyKey: key1,
          items: [{ skuId: lastItemSkuId, quantity: 1 }],
        }),
      request(app)
        .post("/api/v1/orders/checkout")
        .set("Authorization", `Bearer ${customer2Token}`)
        .send({
          warehouseId,
          idempotencyKey: key2,
          items: [{ skuId: lastItemSkuId, quantity: 1 }],
        }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const inv = await prisma.inventory.findUniqueOrThrow({
      where: { skuId_warehouseId: { skuId: lastItemSkuId, warehouseId } },
    });
    expect(inv.available).toBe(0);
    expect(inv.reserved).toBe(1);
  });

  it("expires reservations idempotently and releases stock", async () => {
    const sku = await prisma.sku.findUniqueOrThrow({
      where: { skuCode: "MEERA-MUG-001" },
    });
    const beforeInv = await prisma.inventory.findUniqueOrThrow({
      where: { skuId_warehouseId: { skuId: sku.id, warehouseId } },
    });

    const res = await prisma.reservation.create({
      data: {
        skuId: sku.id,
        warehouseId,
        quantity: 2,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.inventory.update({
      where: { id: beforeInv.id },
      data: { available: beforeInv.available - 2, reserved: beforeInv.reserved + 2 },
    });

    const first = await expireReservationById(res.id);
    expect(first.skipped).toBe(false);

    const second = await expireReservationById(res.id);
    expect(second.skipped).toBe(true);

    const afterInv = await prisma.inventory.findUniqueOrThrow({
      where: { id: beforeInv.id },
    });
    expect(afterInv.available).toBe(beforeInv.available);
    expect(afterInv.reserved).toBe(beforeInv.reserved);
  });

  it("rejects expired or ineligible promotions (discount abuse)", async () => {
    const promoCode = `EXPIRED-${Date.now()}`;
    await prisma.promotion.create({
      data: {
        code: promoCode,
        discountType: "PERCENTAGE",
        discountValue: "50.00",
        minOrderTotal: "100.00",
        startsAt: new Date(Date.now() - 86400_000 * 2),
        endsAt: new Date(Date.now() - 86400_000),
        isActive: true,
      },
    });

    const sku = await prisma.sku.findUniqueOrThrow({
      where: { skuCode: "KIRAN-MOUSE-001" },
    });

    const res = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({
        warehouseId,
        promotionCode: promoCode,
        idempotencyKey: `promo-abuse-${Date.now()}`,
        items: [{ skuId: sku.id, quantity: 1 }],
      });

    expect(res.status).toBe(400);
  });

  it("supports partial fulfillment, rejects invalid transitions, and deduplicates refunds", async () => {
    const sku = await prisma.sku.findUniqueOrThrow({
      where: { skuCode: "KIRAN-MOUSE-001" },
    });
    const checkoutKey = `fulfill-${Date.now()}`;

    const checkout = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({
        warehouseId,
        idempotencyKey: checkoutKey,
        items: [{ skuId: sku.id, quantity: 1 }],
      });
    expect(checkout.status).toBe(201);
    const orderId = checkout.body.order.id as string;
    const paymentId = checkout.body.order.payments[0].id as string;

    // Invalid transition: CONFIRMED -> DELIVERED directly
    const invalidTransition = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ status: "DELIVERED" });
    expect(invalidTransition.status).toBe(409);

    // Create shipment
    const ship = await request(app)
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({ warehouseId, carrier: "Delhivery" });
    expect(ship.status).toBe(201);

    // Idempotent refund
    const refundKey = `refund-${Date.now()}`;
    const ref1 = await request(app)
      .post(`/api/v1/payments/${paymentId}/refunds`)
      .set("Authorization", `Bearer ${supportToken}`)
      .send({ amount: 500, idempotencyKey: refundKey });
    expect(ref1.status).toBe(201);

    const ref2 = await request(app)
      .post(`/api/v1/payments/${paymentId}/refunds`)
      .set("Authorization", `Bearer ${supportToken}`)
      .send({ amount: 500, idempotencyKey: refundKey });
    expect(ref2.status).toBe(200);
    expect(ref2.body.deduplicated).toBe(true);
  });

  it("enforces seller isolation on products and settlements", async () => {
    const prodPatch = await request(app)
      .patch(`/api/v1/products/${seller2ProductId}`)
      .set("Authorization", `Bearer ${seller1Token}`)
      .send({ name: "Hijacked Product" });
    expect(prodPatch.status).toBe(403);

    const settGet = await request(app)
      .get(`/api/v1/sellers/${seller2Id}/settlements`)
      .set("Authorization", `Bearer ${seller1Token}`);
    expect(settGet.status).toBe(403);
  });
});
