"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

interface CartItem {
  id: string;
  skuId: string;
  quantity: number;
  sku: {
    id: string;
    skuCode: string;
    title: string;
    price: string;
  };
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

export default function CartPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState("");
  const [promotionCode, setPromotionCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: cartData, isLoading } = useQuery({
    queryKey: ["cart"],
    queryFn: () => apiFetch<{ cart: { items: CartItem[] } }>("/api/v1/cart"),
  });

  const { data: whData } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiFetch<{ warehouses: Warehouse[] }>("/api/v1/inventory/warehouses"),
  });

  const removeItem = useMutation({
    mutationFn: (skuId: string) =>
      apiFetch(`/api/v1/cart/items/${skuId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });

  const checkout = useMutation({
    mutationFn: (payload: {
      warehouseId: string;
      promotionCode?: string;
      idempotencyKey: string;
      items: Array<{ skuId: string; quantity: number }>;
    }) =>
      apiFetch("/api/v1/orders/checkout", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cart"] });
      router.push("/orders");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Checkout failed");
    },
  });

  const items = cartData?.cart.items || [];
  const warehouses = whData?.warehouses || [];
  const effectiveWhId = warehouseId || warehouses[0]?.id || "";
  const subtotal = items.reduce(
    (sum, i) => sum + Number(i.sku.price) * i.quantity,
    0
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Your Cart</h1>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <strong>Local Simulation Notice:</strong> Payment authorization and
        shipping label creation use local-only stubs (no external payment or
        carrier charges).
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading cart...</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Your cart is empty.
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {items.map((item) => (
            <div
              key={item.skuId}
              className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm"
            >
              <div>
                <div className="font-medium text-slate-900">
                  {item.sku.title} ({item.sku.skuCode})
                </div>
                <div className="text-xs text-slate-500">
                  Qty: {item.quantity} × ₹{item.sku.price}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeItem.mutate(item.skuId)}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <div>
              <label htmlFor="wh" className="block text-xs font-medium text-slate-700">
                Fulfillment Warehouse
              </label>
              <select
                id="wh"
                value={effectiveWhId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="promo" className="block text-xs font-medium text-slate-700">
                Promotion Code (optional)
              </label>
              <input
                id="promo"
                type="text"
                value={promotionCode}
                onChange={(e) => setPromotionCode(e.target.value)}
                placeholder="e.g. SAVE10"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <div className="text-lg font-bold text-slate-900">
              Subtotal: ₹{subtotal.toFixed(2)}
            </div>
            <button
              type="button"
              disabled={!effectiveWhId || checkout.isPending}
              onClick={() => {
                setError(null);
                checkout.mutate({
                  warehouseId: effectiveWhId,
                  ...(promotionCode.trim()
                    ? { promotionCode: promotionCode.trim() }
                    : {}),
                  idempotencyKey: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  items: items.map((i) => ({
                    skuId: i.skuId,
                    quantity: i.quantity,
                  })),
                });
              }}
              className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {checkout.isPending ? "Placing Order..." : "Place Order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
