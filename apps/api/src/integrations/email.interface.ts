// Local simulation adapter for email delivery (Assessment 08).
// External SMTP/SES/SendGrid credentials are not configured (₹0 strict mode).

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<{ messageId: string; mode: "local-simulation" }>;
}

export class LocalStubEmailProvider implements EmailProvider {
  async send(msg: EmailMessage) {
    return {
      messageId: `stub_email_${Date.now()}`,
      mode: "local-simulation" as const,
    };
  }
}

export const emailProvider: EmailProvider = new LocalStubEmailProvider();
