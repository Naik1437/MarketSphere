"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  shipments: Array<{
    id: string;
    carrier: string;
    trackingNumber: string | null;
    status: string;
  }>;
}

export default function OrdersPage() {
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<{ orders: Order[] }>("/api/v1/orders"),
  });

  const requestReturn = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      apiFetch(`/api/v1/orders/${orderId}/returns`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      setFeedback("Return requested.");
      setReason("");
    },
    onError: (err) =>
      setFeedback(err instanceof Error ? err.message : "Return failed"),
  });

  const raiseDispute = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      apiFetch(`/api/v1/orders/${orderId}/disputes`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      setFeedback("Dispute opened.");
      setReason("");
    },
    onError: (err) =>
      setFeedback(err instanceof Error ? err.message : "Dispute failed"),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">My Orders</h1>
      {feedback && (
        <div className="rounded bg-slate-100 p-3 text-sm text-slate-800">
          {feedback}
        </div>
      )}
      {isLoading ? (
        <p className="text-sm text-slate-500">Loading orders...</p>
      ) : (
        <div className="space-y-4">
          {data?.orders.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-slate-900">
                    {order.orderNumber}
                  </span>
                  <span className="ml-3 rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {order.status}
                  </span>
                </div>
                <span className="font-bold text-slate-900">
                  ₹{order.totalAmount}
                </span>
              </div>

              {order.shipments.length > 0 && (
                <div className="mt-3 text-xs text-slate-600">
                  Shipments:{" "}
                  {order.shipments
                    .map(
                      (s) =>
                        `${s.carrier} (${s.trackingNumber || "pending"}) [${s.status}]`
                    )
                    .join(", ")}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Reason (min 5 chars)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    requestReturn.mutate({
                      orderId: order.id,
                      reason: reason || "Item not as expected",
                    })
                  }
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Request Return
                </button>
                <button
                  type="button"
                  onClick={() =>
                    raiseDispute.mutate({
                      orderId: order.id,
                      reason: reason || "Order issue",
                    })
                  }
                  className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Raise Dispute
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
