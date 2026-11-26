export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
          Project Foundation
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          MarketSphere
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Multi-Vendor Commerce, Inventory &amp; Order Platform — integrated
          foundation is running.
        </p>
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="font-medium text-slate-800">Frontend</div>
            <div className="text-slate-500">Next.js App Router :3000</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="font-medium text-slate-800">Core API</div>
            <div className="text-slate-500">Express + Prisma :4000</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="font-medium text-slate-800">Python Engine</div>
            <div className="text-slate-500">FastAPI + Pydantic :8000</div>
          </div>
        </div>
      </div>
    </main>
  );
}
