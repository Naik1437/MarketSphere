// Pending external sandbox integration (Assessment 08).
// This interface defines the contract; LocalStubShippingProvider is a local-only stub.

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

export const shippingProvider: ShippingProvider = new LocalStubShippingProvider();
