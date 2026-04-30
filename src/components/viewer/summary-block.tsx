export function SummaryBlock({
  summary,
}: {
  summary: string | null | undefined;
}) {
  if (!summary) return null;
  return (
    <section className="mt-8">
      <div className="rounded-xl border border-border bg-bg-subtle/60 p-5 sm:p-6">
        <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Summary
        </div>
        <p className="max-w-[75ch] text-[15px] leading-[1.65] text-text">
          {summary}
        </p>
      </div>
    </section>
  );
}
