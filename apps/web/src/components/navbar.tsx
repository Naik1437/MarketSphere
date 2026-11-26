"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Primary Navigation"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3"
      >
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-indigo-600">
            MarketSphere
          </Link>
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-slate-700">
            <Link href="/" className="hover:text-indigo-600">
              Storefront
            </Link>
            {user?.role === "CUSTOMER" && (
              <>
                <Link href="/cart" className="hover:text-indigo-600">
                  Cart
                </Link>
                <Link href="/orders" className="hover:text-indigo-600">
                  My Orders
                </Link>
              </>
            )}
            {(user?.role === "SELLER" || user?.role === "ADMIN") && (
              <Link href="/seller" className="hover:text-indigo-600">
                Seller Portal
              </Link>
            )}
            {(user?.role === "WAREHOUSE_OPERATOR" || user?.role === "ADMIN") && (
              <Link href="/warehouse" className="hover:text-indigo-600">
                Warehouse
              </Link>
            )}
            {(user?.role === "SUPPORT_AGENT" || user?.role === "ADMIN") && (
              <Link href="/support" className="hover:text-indigo-600">
                Support
              </Link>
            )}
            {user?.role === "ADMIN" && (
              <Link href="/admin" className="hover:text-indigo-600">
                Admin
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {user.fullName} ({user.role})
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Sign In
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
