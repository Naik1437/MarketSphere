import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const webhooksRouter = Router();

const WEBHOOK_SECRET =
  process.env.WEBHOOK_SIGNING_SECRET || "local_dev_webhook_secret_change_me";

export function signWebhookPayload(payload: string): string {
  return crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
}

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getRawBody(req: Request): Buffer {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return raw ?? Buffer.from(JSON.stringify(req.body));
}

const paymentWebhookSchema = z.object({
  eventId: z.string().min(4).max(128),
  providerPaymentId: z.string().min(4),
  eventType: z.enum(["payment.captured", "payment.failed"]),
});

const shippingWebhookSchema = z.object({
  eventId: z.string().min(4).max(128),
  trackingNumber: z.string().min(4),
  eventType: z.enum([
    "shipment.in_transit",
    "shipment.delivered",
    "shipment.failed",
  ]),
});

async function acquireWebhookEvent(
  provider: string,
  eventId: string,
  eventType: string
): Promise<"NEW" | "RETRY" | "DUPLICATE"> {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        eventId,
        eventType,
        status: "PROCESSING",
      },
    });
    return "NEW";
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.webhookEvent.findUnique({
        where: { provider_eventId: { provider, eventId } },
      });
      if (existing?.status === "FAILED") {
        await prisma.webhookEvent.update({
          where: { id: existing.id },
          data: { status: "PROCESSING", attempts: { increment: 1 } },
        });
        return "RETRY";
      }
      return "DUPLICATE";
    }
    throw err;
  }
}

webhooksRouter.post("/payment", async (req: Request, res: Response) => {
  const sig = req.header("x-webhook-signature");
  if (!verifySignature(getRawBody(req), sig)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const parsed = paymentWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payment webhook payload" });
    return;
  }

  const state = await acquireWebhookEvent(
    "payment",
    parsed.data.eventId,
    parsed.data.eventType
  );
  if (state === "DUPLICATE") {
    res.status(200).json({ ok: true, deduplicated: true });
    return;
  }

  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId: parsed.data.providerPaymentId },
  });
  if (!payment) {
    await prisma.webhookEvent.update({
      where: {
        provider_eventId: { provider: "payment", eventId: parsed.data.eventId },
      },
      data: { status: "FAILED" },
    });
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const nextStatus =
    parsed.data.eventType === "payment.captured" ? "CAPTURED" : "FAILED";

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: nextStatus },
    }),
    prisma.webhookEvent.update({
      where: {
        provider_eventId: { provider: "payment", eventId: parsed.data.eventId },
      },
      data: { status: "PROCESSED", processedAt: new Date() },
    }),
  ]);

  res.status(200).json({
    ok: true,
    deduplicated: false,
    retried: state === "RETRY",
    status: nextStatus,
  });
});

webhooksRouter.post("/shipping", async (req: Request, res: Response) => {
  const sig = req.header("x-webhook-signature");
  if (!verifySignature(getRawBody(req), sig)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const parsed = shippingWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid shipping webhook payload" });
    return;
  }

  const state = await acquireWebhookEvent(
    "shipping",
    parsed.data.eventId,
    parsed.data.eventType
  );
  if (state === "DUPLICATE") {
    res.status(200).json({ ok: true, deduplicated: true });
    return;
  }

  const shipment = await prisma.shipment.findUnique({
    where: { trackingNumber: parsed.data.trackingNumber },
  });
  if (!shipment) {
    await prisma.webhookEvent.update({
      where: {
        provider_eventId: { provider: "shipping", eventId: parsed.data.eventId },
      },
      data: { status: "FAILED" },
    });
    res.status(404).json({ error: "Shipment not found" });
    return;
  }

  const nextStatus =
    parsed.data.eventType === "shipment.delivered"
      ? "DELIVERED"
      : parsed.data.eventType === "shipment.in_transit"
        ? "IN_TRANSIT"
        : "FAILED";

  await prisma.$transaction([
    prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: nextStatus },
    }),
    prisma.webhookEvent.update({
      where: {
        provider_eventId: { provider: "shipping", eventId: parsed.data.eventId },
      },
      data: { status: "PROCESSED", processedAt: new Date() },
    }),
  ]);

  res.status(200).json({ ok: true, deduplicated: false, status: nextStatus });
});
