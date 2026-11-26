"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

interface Sku {
  id: string;
  skuCode: string;
  title: string;
  price: string;
  currency: string;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string;
  seller: { id: string; businessName: string };
  skus: Sku[];
}

interface CatalogResponse {
  items: Product[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function StorefrontPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["products", q, category, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      params.set("page", String(page));
      params.set("limit", "12");
      return apiFetch<CatalogResponse>(`/api/v1/products?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Marketplace Catalog</h1>
          <p className="text-sm text-slate-600">
            Browse verified seller products, compare SKUs, and order securely.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            aria-label="Search products"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search products..."
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All Categories</option>
            <option value="Electronics">Electronics</option>
            <option value="Home">Home</option>
          </select>
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading products...</p>}
      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Failed to load products.
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No active products found.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((product) => {
          const minPrice = product.skus[0]?.price;
          return (
            <Link
              key={product.id}
              href={`/products/${product.id}`}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300"
            >
              <div>
                <span className="inline-block rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  {product.category}
                </span>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">
                  {product.name}
                </h2>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                  {product.description || "No description provided."}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="text-xs text-slate-500">
                  By {product.seller.businessName}
                </span>
                <span className="font-semibold text-slate-900">
                  {minPrice ? `₹${minPrice}` : "No SKUs"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-slate-600">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
