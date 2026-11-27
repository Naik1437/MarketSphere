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

  it("supports multiple partial shipments with distinct idempotencyKeys and deduplicates repeats", async () => {
    const whToken = await login("warehouse@marketsphere.local");
    const checkout = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({
        warehouseId,
        idempotencyKey: `partial-${Date.now()}`,
        items: [{ skuId, quantity: 2 }],
      });
    expect(checkout.status).toBe(201);
    const orderId = checkout.body.order.id as string;

    const s1 = await request(app)
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        warehouseId,
        carrier: "Delhivery",
        idempotencyKey: `part-a-${Date.now()}`,
        items: [{ skuId, quantity: 1 }],
      });
    expect(s1.status).toBe(201);

    const s2 = await request(app)
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        warehouseId,
        carrier: "Delhivery",
        idempotencyKey: `part-b-${Date.now()}`,
        items: [{ skuId, quantity: 1 }],
      });
    expect(s2.status).toBe(201);

    const dupKey = `dup-ship-${Date.now()}`;
    const s3 = await request(app)
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({ warehouseId, carrier: "Delhivery", idempotencyKey: dupKey });
    expect(s3.status).toBe(201);

    const s3Dup = await request(app)
      .post(`/api/v1/orders/${orderId}/shipments`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({ warehouseId, carrier: "Delhivery", idempotencyKey: dupKey });
    expect(s3Dup.status).toBe(200);
    expect(s3Dup.body.deduplicated).toBe(true);
  });

  it("clears only purchased cart items after confirmed checkout and deduplicates repeat", async () => {
    const otherSku = await prisma.sku.findUniqueOrThrow({
      where: { skuCode: "MEERA-MUG-001" },
    });

    await request(app)
      .post("/api/v1/cart/items")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ skuId, quantity: 1 });
    await request(app)
      .post("/api/v1/cart/items")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ skuId: otherSku.id, quantity: 1 });

    const key = `cart-clear-${Date.now()}`;
    const checkout = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({
        warehouseId,
        idempotencyKey: key,
        items: [{ skuId, quantity: 1 }],
      });
    expect(checkout.status).toBe(201);

    const cartRes = await request(app)
      .get("/api/v1/cart")
      .set("Authorization", `Bearer ${customer1Token}`);
    expect(cartRes.status).toBe(200);
    const remainingSkuIds = (cartRes.body.cart.items as Array<{ skuId: string }>).map(
      (i) => i.skuId
    );
    expect(remainingSkuIds).not.toContain(skuId);
    expect(remainingSkuIds).toContain(otherSku.id);

    const repeat = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({
        warehouseId,
        idempotencyKey: key,
        items: [{ skuId, quantity: 1 }],
      });
    expect(repeat.status).toBe(200);
    expect(repeat.body.deduplicated).toBe(true);
  });

  it("validates SKU existence on inventory adjust and increases stock by 10 with ledger entry", async () => {
    const whToken = await login("warehouse@marketsphere.local");

    const badRes = await request(app)
      .post("/api/v1/inventory/adjust")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        skuId: "KIRAN-CABLE-001",
        warehouseId,
        quantityDelta: 10,
        movementType: "RESTOCK",
        idempotencyKey: `bad-sku-${Date.now()}`,
      });
    expect(badRes.status).toBe(404);

    const before = await prisma.inventory.findUniqueOrThrow({
      where: { skuId_warehouseId: { skuId, warehouseId } },
    });

    const adjKey = `good-sku-${Date.now()}`;
    const goodRes = await request(app)
      .post("/api/v1/inventory/adjust")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        skuId,
        warehouseId,
        quantityDelta: 10,
        movementType: "RESTOCK",
        idempotencyKey: adjKey,
      });
    expect(goodRes.status).toBe(200);
    expect(goodRes.body.inventory.available).toBe(before.available + 10);

    const ledger = await prisma.stockLedger.findUnique({
      where: { idempotencyKey: adjKey },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.quantityDelta).toBe(10);
  });
});
