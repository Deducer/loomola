import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { listFoldersForOwner } from "@/db/queries/folders";
import { searchRecordings, type SearchSort } from "@/db/queries/search";
import { presignGet } from "@/lib/r2/presigned-get";
import { TopNav } from "@/components/nav/top-nav";
import { FolderSidebar } from "@/components/dashboard/folder-sidebar";
import { SearchFilterBar } from "@/components/dashboard/search-filter-bar";
import { Breadcrumbs } from "@/components/dashboard/breadcrumbs";
import { RecordingsGrid } from "@/components/dashboard/recordings-grid";
import { Button } from "@/components/ui/button";

const VALID_SORTS: SearchSort[] = [
  "date_desc",
  "date_asc",
  "duration_desc",
  "duration_asc",
  "views_desc",
  "title_asc",
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAuth();
  const sp = await searchParams;

  const folderParam = sp.folder ?? "";
  const folderId: string | null | undefined =
    folderParam === ""
      ? undefined
      : folderParam === "__unfiled"
        ? null
        : folderParam;

  const query = sp.q?.trim() || undefined;
  const sortParam = sp.sort as SearchSort | undefined;
  const sort: SearchSort =
    sortParam && VALID_SORTS.includes(sortParam) ? sortParam : "date_desc";
  const status = sp.status ? [sp.status] : undefined;
  const brandId = sp.brand || undefined;

  const [folders, brands, recordings] = await Promise.all([
    listFoldersForOwner(user.id),
    listBrandProfiles(user.id),
    searchRecordings({
      ownerId: user.id,
      query,
      folderId,
      status,
      brandId,
      sort,
      limit: 100,
    }),
  ]);

  const thumbnailUrls: Record<string, string> = {};
  const previewUrls: Record<string, string> = {};
  await Promise.all(
    recordings.map(async (r) => {
      if (r.compositeThumbnailKey) {
        thumbnailUrls[r.id] = await presignGet(r.compositeThumbnailKey);
      }
      if (r.status === "ready" && r.r2CompositeKey) {
        previewUrls[r.id] = await presignGet(r.r2CompositeKey);
      }
    })
  );

  const currentFolder =
    typeof folderId === "string" ? folders.find((f) => f.id === folderId) : undefined;
  const title =
    folderId === null
      ? "Unfiled"
      : currentFolder
        ? currentFolder.name
        : "All recordings";

  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <div className="mx-auto flex max-w-6xl">
        <FolderSidebar folders={folders} currentFolderId={folderId} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              {currentFolder && (
                <Breadcrumbs folders={folders} currentId={currentFolder.id} />
              )}
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">
                {title}
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                {recordings.length === 0
                  ? query
                    ? `No matches for “${query}”.`
                    : "No recordings yet."
                  : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}${
                      query ? ` matching “${query}”` : ""
                    }`}
              </p>
            </div>
            <Link href="/record">
              <Button>
                <Plus className="h-4 w-4" />
                New recording
              </Button>
            </Link>
          </div>

          <div className="mt-6">
            <SearchFilterBar brands={brands} />
          </div>

          <div className="mt-8">
            {recordings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
                <p className="text-sm text-text-muted">
                  {query
                    ? `No recordings match “${query}”.`
                    : "Drop recordings here or hit New recording to get started."}
                </p>
              </div>
            ) : (
              <RecordingsGrid
                recordings={recordings}
                thumbnailUrls={thumbnailUrls}
                previewUrls={previewUrls}
                folders={folders}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
}
