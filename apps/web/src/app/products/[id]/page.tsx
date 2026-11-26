"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Sku {
  id: string;
  skuCode: string;
  title: string;
  price: string;
  currency: string;
  isActive: boolean;
}

interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  category: string;
  seller: { id: string; businessName: string };
  skus: Sku[];
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [selectedSkuId, setSelectedSkuId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["product", params.id],
    queryFn: () =>
      apiFetch<{ product: ProductDetail }>(`/api/v1/products/${params.id}`),
  });

  const addToCart = useMutation({
    mutationFn: (payload: { skuId: string; quantity: number }) =>
      apiFetch("/api/v1/cart/items", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMessage("Added to cart.");
      router.push("/cart");
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : "Failed to add to cart");
    },
  });

  const submitReview = useMutation({
    mutationFn: (payload: { rating: number; comment?: string }) =>
      apiFetch(`/api/v1/products/${params.id}/reviews`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMessage("Review submitted.");
      setComment("");
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : "Failed to submit review");
    },
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading...</p>;
  if (!data) return <p className="text-sm text-red-600">Product not found.</p>;

  const product = data.product;
  const activeSkus = product.skus.filter((s) => s.isActive);
  const effectiveSkuId = selectedSkuId || activeSkus[0]?.id || "";

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      router.push("/login");
      return;
    }
    if (!effectiveSkuId) return;
    addToCart.mutate({ skuId: effectiveSkuId, quantity });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {product.category}
        </span>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{product.name}</h1>
        <p className="mt-1 text-xs text-slate-500">
          Sold by {product.seller.businessName}
        </p>
        <p className="mt-4 text-sm text-slate-700">
          {product.description || "No description provided."}
        </p>

        {message && (
          <div className="mt-4 rounded bg-slate-100 p-3 text-sm text-slate-800">
            {message}
          </div>
        )}

        <form onSubmit={handleAdd} className="mt-6 space-y-4">
          <div>
            <label htmlFor="sku" className="block text-sm font-medium text-slate-700">
              Select SKU
            </label>
            <select
              id="sku"
              value={effectiveSkuId}
              onChange={(e) => setSelectedSkuId(e.target.value)}
              className="mt-1 w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {activeSkus.map((sku) => (
                <option key={sku.id} value={sku.id}>
                  {sku.title} ({sku.skuCode}) — ₹{sku.price}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="qty" className="text-sm font-medium text-slate-700">
              Qty
            </label>
            <input
              id="qty"
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!effectiveSkuId || addToCart.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {addToCart.isPending ? "Adding..." : "Add to Cart"}
            </button>
          </div>
        </form>
      </div>

      {user?.role === "CUSTOMER" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Write a Review</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitReview.mutate({ rating, comment: comment || undefined });
            }}
            className="mt-3 space-y-3"
          >
            <div>
              <label htmlFor="rating" className="block text-sm font-medium text-slate-700">
                Rating (1-5)
              </label>
              <input
                id="rating"
                type="number"
                min={1}
                max={5}
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="mt-1 w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="comment" className="block text-sm font-medium text-slate-700">
                Comment
              </label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={2}
              />
            </div>
            <button
              type="submit"
              disabled={submitReview.isPending}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Submit Review
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
