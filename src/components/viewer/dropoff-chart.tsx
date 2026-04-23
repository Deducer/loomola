export function DropoffChart({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <div className="mt-8">
        <h2 className="text-sm font-medium">Viewer drop-off</h2>
        <p className="mt-2 text-xs opacity-60">No views yet.</p>
      </div>
    );
  }
  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium">
        Viewer drop-off <span className="opacity-60">({total} views)</span>
      </h2>
      <div className="mt-3 flex h-20 items-end gap-1 rounded border border-white/10 p-2">
        {buckets.map((count, i) => {
          const pct = Math.round((count / max) * 100);
          return (
            <div
              key={i}
              className="flex-1 rounded bg-emerald-400/60"
              style={{ height: `${Math.max(pct, 2)}%` }}
              title={`Bucket ${i + 1}/${buckets.length}: ${count} viewers`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs opacity-60">
        Each bar covers {100 / buckets.length}% of the recording's duration.
      </p>
    </div>
  );
}
