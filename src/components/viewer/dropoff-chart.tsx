export function DropoffChart({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <div className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Viewer drop-off
        </h2>
        <p className="mt-2 text-xs text-text-subtle">No views yet.</p>
      </div>
    );
  }
  return (
    <div className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Viewer drop-off{" "}
        <span className="text-text-subtle normal-case tracking-normal">
          ({total} views)
        </span>
      </h2>
      <div className="mt-3 flex h-20 items-end gap-1 rounded-lg border border-border bg-bg-subtle p-2">
        {buckets.map((count, i) => {
          const pct = Math.round((count / max) * 100);
          return (
            <div
              key={i}
              className="flex-1 rounded bg-accent/70"
              style={{ height: `${Math.max(pct, 2)}%` }}
              title={`Bucket ${i + 1}/${buckets.length}: ${count} viewers`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-text-subtle">
        Each bar covers {100 / buckets.length}% of the recording&apos;s duration.
      </p>
    </div>
  );
}
