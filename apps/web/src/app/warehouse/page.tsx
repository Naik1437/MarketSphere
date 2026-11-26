"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
}

export default function WarehousePage() {
  const qc = useQueryClient();
  const [skuId, setSkuId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantityDelta, setQuantityDelta] = useState(10);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: whData } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiFetch<{ warehouses: Warehouse[] }>("/api/v1/inventory/warehouses"),
  });

  const { data: ordersData } = useQuery({
    queryKey: ["warehouse-orders"],
    queryFn: () => apiFetch<{ orders: Order[] }>("/api/v1/orders"),
  });

  const adjust = useMutation({
    mutationFn: (payload: {
      skuId: string;
      warehouseId: string;
      quantityDelta: number;
      movementType: "RESTOCK";
      idempotencyKey: string;
    }) =>
      apiFetch("/api/v1/inventory/adjust", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => setMsg("Inventory adjusted."),
    onError: (err) => setMsg(err instanceof Error ? err.message : "Failed"),
  });

  const createShipment = useMutation({
    mutationFn: ({ orderId, warehouseId }: { orderId: string; warehouseId: string }) =>
      apiFetch(`/api/v1/orders/${orderId}/shipments`, {
        method: "POST",
        body: JSON.stringify({ warehouseId, carrier: "Delhivery" }),
      }),
    onSuccess: () => {
      setMsg("Shipment created (local stub label).");
      qc.invalidateQueries({ queryKey: ["warehouse-orders"] });
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : "Failed"),
  });

  const warehouses = whData?.warehouses || [];
  const effectiveWhId = warehouseId || warehouses[0]?.id || "";

  function handleAdjust(e: FormEvent) {
    e.preventDefault();
    if (!effectiveWhId) return;
    adjust.mutate({
      skuId,
      warehouseId: effectiveWhId,
      quantityDelta: Number(quantityDelta),
      movementType: "RESTOCK",
      idempotencyKey: `wh-ui-${Date.now()}`,
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Warehouse Operations</h1>
      {msg && <div className="rounded bg-slate-100 p-3 text-sm">{msg}</div>}

      <form
        onSubmit={handleAdjust}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold">Restock / Adjust Inventory</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            required
            placeholder="SKU ID"
            value={skuId}
            onChange={(e) => setSkuId(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={effectiveWhId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>
          <input
            required
            type="number"
            value={quantityDelta}
            onChange={(e) => setQuantityDelta(Number(e.target.value))}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Apply Stock Adjustment
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Orders Queue</h2>
        <div className="mt-3 space-y-2 text-sm">
          {ordersData?.orders.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between border-b border-slate-100 pb-2"
            >
              <div>
                <span className="font-medium">{o.orderNumber}</span>{" "}
                <span className="text-xs text-slate-500">[{o.status}]</span>
              </div>
              {["CONFIRMED", "PROCESSING"].includes(o.status) && effectiveWhId && (
                <button
                  type="button"
                  onClick={() =>
                    createShipment.mutate({ orderId: o.id, warehouseId: effectiveWhId })
                  }
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50"
                >
                  Create Shipment
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
