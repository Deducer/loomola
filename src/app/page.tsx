import { requireAuth } from "@/lib/require-auth";
import { listRecordings } from "@/db/queries/recordings";
import { TopNav } from "@/components/nav/top-nav";
import { RecordingList } from "@/components/dashboard/recording-list";
import Link from "next/link";

export default async function HomePage() {
  const user = await requireAuth();
  const recordings = await listRecordings(user.id);
  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <div className="mx-auto max-w-5xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Recordings</h1>
            <p className="mt-1 text-sm opacity-60">
              {recordings.length === 0
                ? "Browser-based recording; branded share pages."
                : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Link
            href="/record"
            className="rounded bg-red-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            New recording
          </Link>
        </div>
        <div className="mt-6">
          <RecordingList recordings={recordings} />
        </div>
      </div>
    </>
  );
}
