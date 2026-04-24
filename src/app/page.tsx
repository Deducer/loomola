import { requireAuth } from "@/lib/require-auth";
import { listRecordings } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";
import { TopNav } from "@/components/nav/top-nav";
import { RecordingList } from "@/components/dashboard/recording-list";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function HomePage() {
  const user = await requireAuth();
  const recordings = await listRecordings(user.id);

  const thumbnailUrls: Record<string, string> = {};
  await Promise.all(
    recordings.map(async (r) => {
      if (r.compositeThumbnailKey) {
        thumbnailUrls[r.id] = await presignGet(r.compositeThumbnailKey);
      }
    })
  );

  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              Recordings
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {recordings.length === 0
                ? "Browser-based recording; branded share pages."
                : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Link href="/record">
            <Button>
              <Plus className="h-4 w-4" />
              New recording
            </Button>
          </Link>
        </div>
        <div className="mt-8">
          <RecordingList recordings={recordings} thumbnailUrls={thumbnailUrls} />
        </div>
      </main>
    </>
  );
}
