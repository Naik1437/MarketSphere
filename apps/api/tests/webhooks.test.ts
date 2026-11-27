import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { signWebhookPayload } from "../src/routes/webhooks.routes";

describe("A08 Webhook Signature & Deduplication", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("rejects invalid webhook signatures with 401", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/payment")
      .set("x-webhook-signature", "deadbeef")
      .send({
        eventId: "evt_invalid_1",
        providerPaymentId: "stub_pay_123",
        eventType: "payment.captured",
      });
    expect(res.status).toBe(401);
  });

  it("deduplicates repeated signed payment webhook events", async () => {
    const payment = await prisma.payment.findFirst();
    if (!payment || !payment.providerPaymentId) return;

    const payload = {
      eventId: `evt_dedup_${Date.now()}`,
      providerPaymentId: payment.providerPaymentId,
      eventType: "payment.captured",
    };
    const sig = signWebhookPayload(JSON.stringify(payload));

    const first = await request(app)
      .post("/api/v1/webhooks/payment")
      .set("x-webhook-signature", sig)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.deduplicated).toBe(false);

    const second = await request(app)
      .post("/api/v1/webhooks/payment")
      .set("x-webhook-signature", sig)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.deduplicated).toBe(true);
  });

  it("records FAILED webhook state and allows safe retry recovery", async () => {
    const eventId = `evt_retry_${Date.now()}`;
    const badPayload = {
      eventId,
      providerPaymentId: "non_existent_pay_id",
      eventType: "payment.captured",
    };
    const badSig = signWebhookPayload(JSON.stringify(badPayload));

    const failRes = await request(app)
      .post("/api/v1/webhooks/payment")
      .set("x-webhook-signature", badSig)
      .send(badPayload);
    expect(failRes.status).toBe(404);

    const payment = await prisma.payment.findFirst();
    if (!payment || !payment.providerPaymentId) return;

    const goodPayload = {
      eventId,
      providerPaymentId: payment.providerPaymentId,
      eventType: "payment.captured",
    };
    const goodSig = signWebhookPayload(JSON.stringify(goodPayload));

    const retryRes = await request(app)
      .post("/api/v1/webhooks/payment")
      .set("x-webhook-signature", goodSig)
      .send(goodPayload);
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.retried).toBe(true);
  });

  it("reconciles PENDING orders with CAPTURED payments", async () => {
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "admin@marketsphere.local",
        password: process.env.DEMO_SEED_PASSWORD || "DemoPass!2026",
      });
    expect(adminLogin.status).toBe(200);

    const customer = await prisma.user.findUniqueOrThrow({
      where: { email: "customer1@marketsphere.local" },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: `MS-REC-${Date.now()}`,
        customerId: customer.id,
        status: "PENDING",
        subtotalAmount: "100.00",
        discountAmount: "0.00",
        totalAmount: "100.00",
        currency: "INR",
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "local-stub",
        providerPaymentId: `rec_pay_${Date.now()}`,
        amount: "100.00",
        currency: "INR",
        status: "CAPTURED",
        idempotencyKey: `rec_key_${Date.now()}`,
      },
    });

    const recRes = await request(app)
      .post("/api/v1/webhooks/reconcile")
      .set("Authorization", `Bearer ${adminLogin.body.accessToken}`);
    expect(recRes.status).toBe(200);
    expect(recRes.body.reconciled).toBeGreaterThanOrEqual(1);

    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updated.status).toBe("CONFIRMED");
  });
});
