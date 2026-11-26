"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const DEMO_ACCOUNTS = [
  { label: "Customer 1", email: "customer1@marketsphere.local" },
  { label: "Customer 2", email: "customer2@marketsphere.local" },
  { label: "Seller 1", email: "seller1@marketsphere.local" },
  { label: "Seller 2", email: "seller2@marketsphere.local" },
  { label: "Warehouse", email: "warehouse@marketsphere.local" },
  { label: "Support", email: "support@marketsphere.local" },
  { label: "Admin", email: "admin@marketsphere.local" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role === "SELLER") router.push("/seller");
      else if (user.role === "WAREHOUSE_OPERATOR") router.push("/warehouse");
      else if (user.role === "SUPPORT_AGENT") router.push("/support");
      else if (user.role === "ADMIN") router.push("/admin");
      else router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-slate-900">Sign in to MarketSphere</h1>
      <p className="mt-1 text-xs text-slate-500">
        Enter your credentials or select a local demo account.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="customer1@marketsphere.local"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <p className="text-xs font-medium text-slate-600">Local Demo Accounts:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              type="button"
              onClick={() => {
                setEmail(acc.email);
                setPassword("DemoPass!2026");
              }}
              className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              {acc.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
