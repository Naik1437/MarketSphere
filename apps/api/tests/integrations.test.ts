import { describe, expect, it, vi } from "vitest";
import { LocalStubPaymentProvider, StripeTestPaymentProvider } from "../src/integrations/payment.interface";
import { HttpShippingProvider, LocalStubShippingProvider } from "../src/integrations/shipping.interface";
import { LocalStubEmailProvider, ResendEmailProvider } from "../src/integrations/email.interface";

describe("A08 provider adapters", () => {
  it("retains deterministic local simulation mode", async () => {
    await expect(new LocalStubPaymentProvider().authorize({ orderId: "o1", amount: 10, currency: "INR", idempotencyKey: "k1" })).resolves.toMatchObject({ provider: "local-stub", status: "CAPTURED" });
    await expect(new LocalStubShippingProvider().createLabel({ orderId: "o1", warehouseCode: "w1", carrier: "stub" })).resolves.toMatchObject({ status: "LABEL_CREATED" });
    await expect(new LocalStubEmailProvider().send({ to: "a@example.test", subject: "s", body: "b" })).resolves.toMatchObject({ mode: "local-simulation" });
  });

  it("uses Stripe idempotency and maps a successful test response", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "pi_test_1", status: "succeeded" }), { status: 200 }));
    await expect(new StripeTestPaymentProvider().authorize({ orderId: "o1", amount: 10, currency: "INR", idempotencyKey: "idem-1" })).resolves.toMatchObject({ providerPaymentId: "pi_test_1", status: "CAPTURED" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "Idempotency-Key": "idem-1" });
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });

  it("retries transient shipping failures and rejects malformed success", async () => {
    vi.stubEnv("SHIPPING_PROVIDER_URL", "https://shipping.test/labels"); vi.stubEnv("SHIPPING_PROVIDER_TOKEN", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(new HttpShippingProvider().createLabel({ orderId: "o1", warehouseCode: "w1", carrier: "test" })).rejects.toThrow("tracking number");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });

  it("retries transient email failures and surfaces provider errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_unit"); vi.stubEnv("EMAIL_FROM", "noreply@example.test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response("bad", { status: 400 }));
    await expect(new ResendEmailProvider().send({ to: "a@example.test", subject: "s", body: "b" })).rejects.toThrow("External provider failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });
});
