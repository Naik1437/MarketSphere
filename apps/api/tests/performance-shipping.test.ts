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
    const customer = await prisma.user.findUnique({ where: { email: "customer1@marketsphere.local" } });
    const warehouse = await prisma.warehouse.findFirst({ where: { isActive: true } });
    expect(customer).not.toBeNull();
    expect(warehouse).not.toBeNull();

    const order = await prisma.order.create({
      data: {
        orderNumber: `MS-SHIP-REC-${Date.now()}`,
        customerId: customer!.id,
        status: "PROCESSING",
        subtotalAmount: "10.00",
        totalAmount: "10.00",
        currency: "INR",
      },
    });
    const trackingNumber = `SHIP-REC-${Date.now()}`;
    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id,
        warehouseId: warehouse!.id,
        carrier: "local-stub",
        trackingNumber,
        status: "IN_TRANSIT",
      },
    });
    const eventId = `shipping-recovery-${Date.now()}`;
    await prisma.webhookEvent.create({
      data: {
        provider: "shipping",
        eventId,
        eventType: "shipment.delivered",
        status: "FAILED",
        attempts: 1,
      },
    });
    const payload = { eventId, trackingNumber, eventType: "shipment.delivered" };
    const res = await request(app).post("/api/v1/webhooks/shipping").set("x-webhook-signature", signWebhookPayload(JSON.stringify(payload))).send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deduplicated: false, status: "DELIVERED" });

    const [processedEvent, processedShipment] = await Promise.all([
      prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: "shipping", eventId } } }),
      prisma.shipment.findUnique({ where: { id: shipment.id } }),
    ]);
    expect(processedEvent).toMatchObject({ status: "PROCESSED", eventType: "shipment.delivered", attempts: 2 });
    expect(processedEvent?.processedAt).not.toBeNull();
    expect(processedShipment?.status).toBe("DELIVERED");

    await prisma.webhookEvent.delete({ where: { provider_eventId: { provider: "shipping", eventId } } });
    await prisma.order.delete({ where: { id: order.id } });
  });
});
