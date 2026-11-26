"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

interface ReturnReq {
  id: string;
  reason: string;
  status: string;
  order: {
    id: string;
    orderNumber: string;
    totalAmount: string;
    payments: Array<{ id: string; amount: string; status: string }>;
  };
}

interface Dispute {
  id: string;
  reason: string;
  status: string;
  order: { id: string; orderNumber: string };
}

export default function SupportPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  const { data: returnsData } = useQuery({
    queryKey: ["support-returns"],
    queryFn: () => apiFetch<{ returns: ReturnReq[] }>("/api/v1/returns"),
  });

  const { data: disputesData } = useQuery({
    queryKey: ["support-disputes"],
    queryFn: () => apiFetch<{ disputes: Dispute[] }>("/api/v1/disputes"),
  });

  const updateReturn = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      apiFetch(`/api/v1/returns/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      setMsg("Return status updated.");
      qc.invalidateQueries({ queryKey: ["support-returns"] });
    },
  });

  const issueRefund = useMutation({
    mutationFn: ({ paymentId, amount, returnId }: { paymentId: string; amount: number; returnId: string }) =>
      apiFetch(`/api/v1/payments/${paymentId}/refunds`, {
        method: "POST",
        body: JSON.stringify({
          amount,
          returnId,
          idempotencyKey: `support-ref-${returnId}`,
        }),
      }),
    onSuccess: () => setMsg("Refund processed (idempotent)."),
    onError: (err) => setMsg(err instanceof Error ? err.message : "Refund failed"),
  });

  const resolveDispute = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/disputes/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "RESOLVED", resolution: "Resolved by support" }),
      }),
    onSuccess: () => {
      setMsg("Dispute resolved.");
      qc.invalidateQueries({ queryKey: ["support-disputes"] });
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Support Operations</h1>
      {msg && <div className="rounded bg-slate-100 p-3 text-sm">{msg}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Return Requests</h2>
        <div className="mt-3 space-y-3 text-sm">
          {returnsData?.returns.map((r) => {
            const payment = r.order.payments[0];
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2"
              >
                <div>
                  <span className="font-medium">{r.order.orderNumber}</span> —{" "}
                  {r.reason}{" "}
                  <span className="text-xs text-slate-500">[{r.status}]</span>
                </div>
                <div className="flex gap-2">
                  {r.status === "REQUESTED" && (
                    <button
                      type="button"
                      onClick={() => updateReturn.mutate({ id: r.id, status: "APPROVED" })}
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
                    >
                      Approve
                    </button>
                  )}
                  {payment && (
                    <button
                      type="button"
                      onClick={() =>
                        issueRefund.mutate({
                          paymentId: payment.id,
                          amount: Number(payment.amount),
                          returnId: r.id,
                        })
                      }
                      className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700"
                    >
                      Issue Refund
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Disputes</h2>
        <div className="mt-3 space-y-2 text-sm">
          {disputesData?.disputes.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between border-b border-slate-100 pb-2"
            >
              <div>
                <span className="font-medium">{d.order.orderNumber}</span> —{" "}
                {d.reason}{" "}
                <span className="text-xs text-slate-500">[{d.status}]</span>
              </div>
              {d.status === "OPEN" && (
                <button
                  type="button"
                  onClick={() => resolveDispute.mutate(d.id)}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
