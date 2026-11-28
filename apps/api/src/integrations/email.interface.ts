import { randomUUID } from "node:crypto";
import { providerError, requestWithRetry } from "./http-client";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  eventId?: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<{ messageId: string; mode: "local-simulation" | "external" }>;
}

export class LocalStubEmailProvider implements EmailProvider {
  async send(msg: EmailMessage) {
    return {
      messageId: `stub_email_${Date.now()}`,
      mode: "local-simulation" as const,
    };
  }
}

export class ResendEmailProvider implements EmailProvider {
  async send(msg: EmailMessage) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM are required");
    const response = await requestWithRetry("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `email-${msg.eventId ?? randomUUID()}` },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.body }),
    });
    if (!response.ok) await providerError(response);
    const result = (await response.json()) as { id?: string };
    if (!result.id) throw new Error("Email provider response omitted message id");
    return { messageId: result.id, mode: "external" as const };
  }
}

export const emailProvider: EmailProvider = process.env.RESEND_API_KEY && process.env.EMAIL_FROM
  ? new ResendEmailProvider()
  : new LocalStubEmailProvider();
