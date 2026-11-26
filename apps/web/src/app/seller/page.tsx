"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Product {
  id: string;
  name: string;
  slug: string;
  category: string;
  status: string;
  skus: Array<{ id: string; skuCode: string; title: string; price: string }>;
}

export default function SellerDashboardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("Electronics");
  const [skuCode, setSkuCode] = useState("");
  const [skuTitle, setSkuTitle] = useState("");
  const [skuPrice, setSkuPrice] = useState("999");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: productsData } = useQuery({
    queryKey: ["seller-products"],
    queryFn: () => apiFetch<{ items: Product[] }>("/api/v1/products/mine"),
    enabled: !!user,
  });

  const { data: settlementsData } = useQuery({
    queryKey: ["seller-settlements", user?.sellerId],
    queryFn: () =>
      apiFetch<{ settlements: Array<{ id: string; totalAmount: string; status: string }> }>(
        `/api/v1/sellers/${user!.sellerId}/settlements`
      ),
    enabled: !!user?.sellerId,
  });

  const createProduct = useMutation({
    mutationFn: (payload: {
      name: string;
      slug: string;
      category: string;
      status: "ACTIVE";
    }) =>
      apiFetch("/api/v1/products", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMsg("Product created.");
      setName("");
      setSlug("");
      qc.invalidateQueries({ queryKey: ["seller-products"] });
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : "Failed"),
  });

  const createSku = useMutation({
    mutationFn: (payload: {
      productId: string;
      skuCode: string;
      title: string;
      price: number;
    }) =>
      apiFetch(`/api/v1/products/${payload.productId}/skus`, {
        method: "POST",
        body: JSON.stringify({
          skuCode: payload.skuCode,
          title: payload.title,
          price: payload.price,
        }),
      }),
    onSuccess: () => {
      setMsg("SKU added.");
      setSkuCode("");
      setSkuTitle("");
      qc.invalidateQueries({ queryKey: ["seller-products"] });
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : "Failed"),
  });

  function handleCreateProduct(e: FormEvent) {
    e.preventDefault();
    createProduct.mutate({ name, slug, category, status: "ACTIVE" });
  }

  const products = productsData?.items || [];
  const effectiveProductId = selectedProductId || products[0]?.id || "";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Seller Portal</h1>
      {msg && <div className="rounded bg-slate-100 p-3 text-sm">{msg}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <form
          onSubmit={handleCreateProduct}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Create Product</h2>
          <input
            required
            placeholder="Product Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="slug-like-this"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="Electronics">Electronics</option>
            <option value="Home">Home</option>
          </select>
          <button
            type="submit"
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Create Product
          </button>
        </form>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!effectiveProductId) return;
            createSku.mutate({
              productId: effectiveProductId,
              skuCode,
              title: skuTitle,
              price: Number(skuPrice),
            });
          }}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Add SKU</h2>
          <select
            value={effectiveProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="SKU Code (e.g. MY-SKU-001)"
            value={skuCode}
            onChange={(e) => setSkuCode(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Variant Title (e.g. Black)"
            value={skuTitle}
            onChange={(e) => setSkuTitle(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            min="1"
            step="0.01"
            placeholder="Price"
            value={skuPrice}
            onChange={(e) => setSkuPrice(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!effectiveProductId}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Add SKU
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">My Catalog &amp; SKUs</h2>
        <div className="mt-3 space-y-2 text-sm">
          {products.map((p) => (
            <div key={p.id} className="border-b border-slate-100 pb-2">
              <div className="font-medium">
                {p.name} ({p.status})
              </div>
              <div className="text-xs text-slate-500">
                SKUs:{" "}
                {p.skus.map((s) => `${s.skuCode} (₹${s.price})`).join(", ") ||
                  "None"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Settlements</h2>
        <p className="mt-1 text-xs text-slate-500">
          {settlementsData?.settlements.length
            ? `${settlementsData.settlements.length} settlements recorded.`
            : "No settlements generated yet."}
        </p>
      </div>
    </div>
  );
}
