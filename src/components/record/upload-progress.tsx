"use client";

export function UploadProgress({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4">
      <p className="text-lg font-semibold">Finalising upload…</p>
      <div className="w-full max-w-md">
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-red-500/80 transition-[width] duration-200"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <p className="mt-2 text-center text-xs opacity-60">
          {Math.round(pct * 100)}%
        </p>
      </div>
    </div>
  );
}
