"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";

interface Seller {
  id: string;
  businessName: string;
  slug: string;
  status: string;
  commissionRate: string;
}

export default function AdminPage() {
  const qc = useQueryClient();
  const [promoCode, setPromoCode] = useState("");
  const [discountValue, setDiscountValue] = useState("10");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: overviewData } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () =>
      apiFetch<{
        overview: { users: number; sellers: number; products: number; orders: number };
      }>("/api/v1/admin/overview"),
  });

  const { data: sellersData } = useQuery({
    queryKey: ["admin-sellers"],
    queryFn: () => apiFetch<{ sellers: Seller[] }>("/api/v1/sellers"),
  });

  const updateSellerStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "SUSPENDED" }) =>
      apiFetch(`/api/v1/sellers/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      setMsg("Seller status updated.");
      qc.invalidateQueries({ queryKey: ["admin-sellers"] });
    },
  });

  const createPromo = useMutation({
    mutationFn: (payload: {
      code: string;
      discountType: "PERCENTAGE";
      discountValue: number;
    }) =>
      apiFetch("/api/v1/promotions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMsg("Promotion created.");
      setPromoCode("");
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : "Failed"),
  });

  const generateSettlement = useMutation({
    mutationFn: (sellerId: string) =>
      apiFetch("/api/v1/settlements/generate", {
        method: "POST",
        body: JSON.stringify({ sellerId }),
      }),
    onSuccess: () => setMsg("Settlement generated."),
    onError: (err) => setMsg(err instanceof Error ? err.message : "Failed"),
  });

  function handlePromo(e: FormEvent) {
    e.preventDefault();
    createPromo.mutate({
      code: promoCode,
      discountType: "PERCENTAGE",
      discountValue: Number(discountValue),
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Admin Oversight</h1>
      {msg && <div className="rounded bg-slate-100 p-3 text-sm">{msg}</div>}

      {overviewData && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(overviewData.overview).map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="text-xs uppercase text-slate-500">{k}</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Sellers</h2>
        <div className="mt-3 space-y-2 text-sm">
          {sellersData?.sellers.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between border-b border-slate-100 pb-2"
            >
              <div>
                <span className="font-medium">{s.businessName}</span>{" "}
                <span className="text-xs text-slate-500">
                  [{s.status}] ({s.commissionRate}%)
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => generateSettlement.mutate(s.id)}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
                >
                  Generate Settlement
                </button>
                {s.status !== "ACTIVE" && (
                  <button
                    type="button"
                    onClick={() =>
                      updateSellerStatus.mutate({ id: s.id, status: "ACTIVE" })
                    }
                    className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white"
                  >
                    Approve
                  </button>
                )}
                {s.status === "ACTIVE" && (
                  <button
                    type="button"
                    onClick={() =>
                      updateSellerStatus.mutate({ id: s.id, status: "SUSPENDED" })
                    }
                    className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-700"
                  >
                    Suspend
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={handlePromo}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold">Create Promotion</h2>
        <div className="flex flex-wrap gap-3">
          <input
            required
            placeholder="Code (e.g. SAVE10)"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            min="1"
            max="90"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className="w-28 rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          >
            Create % Promo
          </button>
        </div>
      </form>
    </div>
  );
}
