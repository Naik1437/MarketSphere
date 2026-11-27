import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { signWebhookPayload } from "../src/routes/webhooks.routes";

describe("A12 performance and shipping recovery evidence", () => {
  afterAll(async () => { await prisma.$disconnect(); await redis.quit(); });

  it("records a catalog slow-search benchmark", async () => {
    const started = performance.now();
    const res = await request(app).get("/api/v1/products?search=mouse&limit=50");
    const elapsed = Math.round(performance.now() - started);
    console.log(`[benchmark] catalog-search-ms=${elapsed}`);
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

  it("retries a failed shipping callback after the shipment is available", async () => {
    const shipment = await prisma.shipment.findFirst({ where: { trackingNumber: { not: null } } });
    if (!shipment?.trackingNumber) return;
    const eventId = `shipping-recovery-${Date.now()}`;
    await prisma.webhookEvent.create({ data: { provider: "shipping", eventId, status: "FAILED", payload: {} } });
    const payload = { eventId, trackingNumber: shipment.trackingNumber, status: "DELIVERED" };
    const res = await request(app).post("/api/v1/webhooks/shipping").set("x-webhook-signature", signWebhookPayload(JSON.stringify(payload))).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.retried).toBe(true);
  });
});
