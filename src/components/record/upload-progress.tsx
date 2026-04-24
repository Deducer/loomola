"use client";

export function UploadProgress({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-bg-subtle p-10">
      <p className="text-base font-semibold text-text">Finalising upload…</p>
      <div className="w-full max-w-md">
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <p className="mt-2 text-center font-mono text-xs text-text-subtle">
          {Math.round(pct * 100)}%
        </p>
      </div>
    </div>
  );
}
