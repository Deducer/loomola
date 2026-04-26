export function SummaryBlock({ summary }: { summary: string | null | undefined }) {
  if (!summary) return null;
  return (
    <p className="mt-8 max-w-[75ch] text-[15.5px] leading-[1.7] text-text-muted">
      {summary}
    </p>
  );
}
