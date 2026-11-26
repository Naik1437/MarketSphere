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
});
