import { providerError, requestWithRetry } from "./http-client";

export interface PaymentAuthRequest {
  orderId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface PaymentAuthResult {
  provider: string;
  providerPaymentId: string;
  status: "AUTHORIZED" | "CAPTURED" | "FAILED";
}

export interface PaymentProvider {
  authorize(req: PaymentAuthRequest): Promise<PaymentAuthResult>;
}

export class LocalStubPaymentProvider implements PaymentProvider {
  async authorize(req: PaymentAuthRequest): Promise<PaymentAuthResult> {
    return {
      provider: "local-stub",
      providerPaymentId: `stub_pay_${req.idempotencyKey}`,
      status: "CAPTURED",
    };
  }
}

export class StripeTestPaymentProvider implements PaymentProvider {
  async authorize(req: PaymentAuthRequest): Promise<PaymentAuthResult> {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || !key.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a Stripe test-mode sk_test_ key");
    const body = new URLSearchParams({
      amount: String(Math.round(req.amount * 100)),
      currency: req.currency.toLowerCase(),
      "metadata[orderId]": req.orderId,
      "payment_method_types[0]": "card",
      confirm: "false",
    });
    const response = await requestWithRetry("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": req.idempotencyKey },
      body,
    });
    if (!response.ok) await providerError(response);
    const result = (await response.json()) as { id: string; status: string };
    const status = result.status === "succeeded" ? "CAPTURED" : result.status === "requires_capture" ? "AUTHORIZED" : "FAILED";
    return { provider: "stripe", providerPaymentId: result.id, status };
  }
}

export const paymentProvider: PaymentProvider = process.env.STRIPE_SECRET_KEY
  ? new StripeTestPaymentProvider()
  : new LocalStubPaymentProvider();
