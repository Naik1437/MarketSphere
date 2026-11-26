// Pending external sandbox integration (Assessment 08).
// This interface defines the contract; LocalStubPaymentProvider is a local-only stub.

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

export const paymentProvider: PaymentProvider = new LocalStubPaymentProvider();
