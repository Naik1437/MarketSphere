import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || "DemoPass!2026";

async function login(email: string) {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: DEMO_PASSWORD });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

describe("Audit Regression Tests (Concurrency & Scoped Idempotency)", () => {
  let customer1Token: string;
  let customer2Token: string;
  let supportToken: string;
  let warehouseId: string;
  let skuId: string;

  beforeAll(async () => {
    [customer1Token, customer2Token, supportToken] = await Promise.all([
      login("customer1@marketsphere.local"),
      login("customer2@marketsphere.local"),
      login("support@marketsphere.local"),
    ]);

    const wh = await prisma.warehouse.findUniqueOrThrow({
      where: { code: "WH-BLR-01" },
    });
    warehouseId = wh.id;

    const sku = await prisma.sku.findUniqueOrThrow({
      where: { skuCode: "KIRAN-MOUSE-001" },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("scopes checkout idempotencyKey per customer", async () => {
    const sharedKey = `shared-key-${Date.now()}`;

    const r1 = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({
        warehouseId,
        idempotencyKey: sharedKey,
        items: [{ skuId, quantity: 1 }],
      });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer2Token}`)
      .send({
        warehouseId,
        idempotencyKey: sharedKey,
        items: [{ skuId, quantity: 1 }],
      });
    expect(r2.status).toBe(201);
    expect(r2.body.order.id).not.toBe(r1.body.order.id);
  });

  it("prevents concurrent different-key over-refunds via FOR UPDATE lock", async () => {
    const checkout = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({
        warehouseId,
        idempotencyKey: `ref-conc-${Date.now()}`,
        items: [{ skuId, quantity: 1 }],
      });
    expect(checkout.status).toBe(201);
    const payment = checkout.body.order.payments[0];
    const fullAmount = Number(payment.amount);

    const [ref1, ref2] = await Promise.all([
      request(app)
        .post(`/api/v1/payments/${payment.id}/refunds`)
        .set("Authorization", `Bearer ${supportToken}`)
        .send({ amount: fullAmount, idempotencyKey: `k1-${Date.now()}` }),
      request(app)
        .post(`/api/v1/payments/${payment.id}/refunds`)
        .set("Authorization", `Bearer ${supportToken}`)
        .send({ amount: fullAmount, idempotencyKey: `k2-${Date.now()}` }),
    ]);

    const statuses = [ref1.status, ref2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
