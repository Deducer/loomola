import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { listTrashedRecordings } from "@/db/queries/recordings";
import { trashRetentionDays } from "@/lib/queue/jobs/purge-deleted";
import { TopNav } from "@/components/nav/top-nav";
import { TrashList } from "@/components/trash/trash-list";
import { enableGranola } from "@/lib/feature-flags";

export const metadata = { title: "Trash · loomola" };

export default async function TrashPage() {
  const user = await requireAuth();
  const items = await listTrashedRecordings(user.id);
  const retentionDays = trashRetentionDays();

  return (
    <>
      <TopNav
        userEmail={user.email ?? "unknown"}
        activePath="recordings"
        granolaEnabled={enableGranola()}
      />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to library
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text">
          Trash
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Deleted recordings and notes stay here for {retentionDays} days, then
          their files are permanently removed.
        </p>
        <div className="mt-6">
          <TrashList
            items={items.map((item) => ({
              id: item.id,
              type: item.type,
              title: item.title || item.aiTitle || "Untitled",
              deletedAt: item.deletedAt.toISOString(),
              createdAt: item.createdAt.toISOString(),
            }))}
            retentionDays={retentionDays}
          />
        </div>
      </main>
    </>
  );
}
