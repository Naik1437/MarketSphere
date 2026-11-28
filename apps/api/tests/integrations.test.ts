import { describe, expect, it, vi } from "vitest";
import { LocalStubPaymentProvider, StripeTestPaymentProvider } from "../src/integrations/payment.interface";
import { HttpShippingProvider, LocalStubShippingProvider } from "../src/integrations/shipping.interface";
import { LocalStubEmailProvider, ResendEmailProvider } from "../src/integrations/email.interface";
import { SupabaseStorageProvider } from "../src/integrations/storage.interface";

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

  it("rejects live Stripe keys and does not authorize unconfirmed intents", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_allowed");
    await expect(new StripeTestPaymentProvider().authorize({ orderId: "o1", amount: 10, currency: "INR", idempotencyKey: "idem-live" })).rejects.toThrow("sk_test_");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "pi_test_2", status: "requires_confirmation" }), { status: 200 }));
    await expect(new StripeTestPaymentProvider().authorize({ orderId: "o1", amount: 10, currency: "INR", idempotencyKey: "idem-unconfirmed" })).resolves.toMatchObject({ status: "FAILED" });
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });

  it("retries transient shipping failures and rejects malformed success", async () => {
    vi.stubEnv("SHIPPING_PROVIDER_URL", "https://shipping.test/labels"); vi.stubEnv("SHIPPING_PROVIDER_TOKEN", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(new HttpShippingProvider().createLabel({ orderId: "o1", warehouseCode: "w1", carrier: "test" })).rejects.toThrow("tracking number");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });

  it("rejects non-HTTPS shipping configuration and unsupported statuses", async () => {
    vi.stubEnv("SHIPPING_PROVIDER_URL", "http://shipping.test/labels"); vi.stubEnv("SHIPPING_PROVIDER_TOKEN", "token");
    await expect(new HttpShippingProvider().createLabel({ orderId: "o1", warehouseCode: "w1", carrier: "test" })).rejects.toThrow("HTTPS");
    vi.stubEnv("SHIPPING_PROVIDER_URL", "https://shipping.test/labels");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ trackingNumber: "T1", status: "failed" }), { status: 200 }));
    await expect(new HttpShippingProvider().createLabel({ orderId: "o1", warehouseCode: "w1", carrier: "test" })).rejects.toThrow("unsupported status");
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });

  it("uses unique event-based email idempotency keys", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_unit"); vi.stubEnv("EMAIL_FROM", "noreply@example.test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "email-1" }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: "email-2" }), { status: 200 }));
    await new ResendEmailProvider().send({ to: "a@example.test", subject: "s", body: "b", eventId: "evt-1" });
    await new ResendEmailProvider().send({ to: "a@example.test", subject: "s", body: "b", eventId: "evt-2" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "Idempotency-Key": "email-evt-1" });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ "Idempotency-Key": "email-evt-2" });
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });

  it("uploads bytes and returns a private reference for a private bucket", async () => {
    vi.stubEnv("SUPABASE_URL", "https://storage.test"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service"); vi.stubEnv("SUPABASE_STORAGE_BUCKET", "private");
    const bytes = new TextEncoder().encode("hello");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ public: false }), { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const result = await new SupabaseStorageProvider().putObject("a.txt", "text/plain", bytes);
    expect(result.url).toBe("storage://private/a.txt");
    expect(result.publicUrl).toBeUndefined();
    expect(new Uint8Array((fetchMock.mock.calls[1][1] as RequestInit).body as ArrayBuffer)).toEqual(bytes);
    fetchMock.mockRestore(); vi.unstubAllEnvs();
  });
});
