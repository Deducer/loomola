import Link from "next/link";
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
      <div className="rounded-lg border border-dashed border-white/15 p-10 text-center">
        <p className="text-sm opacity-70">No recordings yet.</p>
        <Link
          href="/record"
          className="mt-3 inline-block rounded bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          Start a recording
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {recordings.map((r) => (
        <li key={r.id}>
          <RecordingCard
            rec={r}
            thumbnailUrl={thumbnailUrls[r.id] ?? null}
          />
        </li>
      ))}
    </ul>
  );
}
