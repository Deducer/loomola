import Link from "next/link";

export function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div>
        <h1 className="text-2xl font-semibold">Recordings</h1>
        <p className="mt-1 text-sm opacity-60">
          Recording lands in your browser; upload + sharing arrive in Milestones 4–11.
        </p>
      </div>
      <div className="mt-8 rounded-lg border border-white/10 p-6">
        <h2 className="text-sm font-medium">Current milestone</h2>
        <p className="mt-1 text-sm opacity-80">
          M3: Browser recording capture (no upload yet)
        </p>
        <Link
          href="/record"
          className="mt-4 inline-block rounded bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          Start a recording
        </Link>
      </div>
    </div>
  );
}
