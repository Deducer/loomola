import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { RecordingWithBrand } from "@/db/queries/recordings";
import { RecordingCard } from "./recording-card";

export function RecordingList({
  recordings,
  thumbnailUrls,
}: {
  recordings: RecordingWithBrand[];
  thumbnailUrls: Record<string, string>;
}) {
  if (recordings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
        <p className="text-sm text-text-muted">No recordings yet.</p>
        <Link href="/record" className="mt-4 inline-block">
          <Button>Start a recording</Button>
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recordings.map((r) => (
        <li key={r.id}>
          <RecordingCard rec={r} thumbnailUrl={thumbnailUrls[r.id] ?? null} />
        </li>
      ))}
    </ul>
  );
}
