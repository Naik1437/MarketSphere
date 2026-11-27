import { providerError, requestWithRetry } from "./http-client";

export interface ShipmentCreateRequest {
  orderId: string;
  warehouseCode: string;
  carrier: string;
}

export interface ShipmentCreateResult {
  trackingNumber: string;
  status: "LABEL_CREATED";
}

export interface ShippingProvider {
  createLabel(req: ShipmentCreateRequest): Promise<ShipmentCreateResult>;
}

export class LocalStubShippingProvider implements ShippingProvider {
  async createLabel(req: ShipmentCreateRequest): Promise<ShipmentCreateResult> {
    return {
      trackingNumber: `STUB-${req.warehouseCode}-${req.orderId.slice(-6).toUpperCase()}-${Date.now().toString().slice(-4)}`,
      status: "LABEL_CREATED",
    };
  }
}

export class HttpShippingProvider implements ShippingProvider {
  async createLabel(req: ShipmentCreateRequest): Promise<ShipmentCreateResult> {
    const endpoint = process.env.SHIPPING_PROVIDER_URL;
    const token = process.env.SHIPPING_PROVIDER_TOKEN;
    if (!endpoint || !token) throw new Error("SHIPPING_PROVIDER_URL and SHIPPING_PROVIDER_TOKEN are required");
    const response = await requestWithRetry(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `label-${req.orderId}` },
      body: JSON.stringify(req),
    });
    if (!response.ok) await providerError(response);
    const result = (await response.json()) as { trackingNumber?: string; tracking_number?: string; status?: string };
    const trackingNumber = result.trackingNumber ?? result.tracking_number;
    if (!trackingNumber) throw new Error("Shipping provider response omitted tracking number");
    return { trackingNumber, status: "LABEL_CREATED" };
  }
}

export const shippingProvider: ShippingProvider = process.env.SHIPPING_PROVIDER_URL && process.env.SHIPPING_PROVIDER_TOKEN
  ? new HttpShippingProvider()
  : new LocalStubShippingProvider();
