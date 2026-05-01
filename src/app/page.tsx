import Link from "next/link";
import { FileText, Plus, Search, Video } from "lucide-react";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { listFoldersForOwner } from "@/db/queries/folders";
import { createQuickAudioNote } from "@/db/queries/notes";
import { searchRecordings, type SearchSort } from "@/db/queries/search";
import { presignGet } from "@/lib/r2/presigned-get";
import { enableGranola } from "@/lib/feature-flags";
import { getDashboardTab } from "@/lib/dashboard/tabs";
import { TopNav } from "@/components/nav/top-nav";
import { FolderSidebar } from "@/components/dashboard/folder-sidebar";
import { MobileFolderPicker } from "@/components/dashboard/mobile-folder-picker";
import { SearchFilterBar } from "@/components/dashboard/search-filter-bar";
import { Breadcrumbs } from "@/components/dashboard/breadcrumbs";
import { RecordingsGrid } from "@/components/dashboard/recordings-grid";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { NotesList } from "@/components/dashboard/notes-list";
import { Button } from "@/components/ui/button";

const VALID_SORTS: SearchSort[] = [
  "date_desc",
  "date_asc",
  "duration_desc",
  "duration_asc",
  "views_desc",
  "title_asc",
];

async function createQuickNote() {
  "use server";

  if (!enableGranola()) return;
  const user = await requireAuth();
  const note = await createQuickAudioNote(user.id);
  redirect(`/notes/${note.slug}`);
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAuth();
  const sp = await searchParams;
  const granolaEnabled = enableGranola();
  const activeTab = getDashboardTab(sp.tab, granolaEnabled);
  const mediaType = activeTab === "notes" ? "audio" : "video";

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
  const status = activeTab === "recordings" && sp.status ? [sp.status] : undefined;
  const brandId = activeTab === "recordings" ? sp.brand || undefined : undefined;

  const [folders, brands, mediaItems] = await Promise.all([
    listFoldersForOwner(user.id),
    activeTab === "recordings" ? listBrandProfiles(user.id) : Promise.resolve([]),
    searchRecordings({
      ownerId: user.id,
      type: mediaType,
      query,
      folderId,
      status,
      brandId,
      sort: activeTab === "recordings" ? sort : "date_desc",
      limit: 100,
    }),
  ]);

  const thumbnailUrls: Record<string, string> = {};
  const previewUrls: Record<string, string> = {};
  if (activeTab === "recordings") {
    await Promise.all(
      mediaItems.map(async (r) => {
        if (r.compositeThumbnailKey) {
          thumbnailUrls[r.id] = await presignGet(r.compositeThumbnailKey);
        }
        if (r.status === "ready" && r.r2CompositeKey) {
          previewUrls[r.id] = await presignGet(r.r2CompositeKey);
        }
      })
    );
  }

  const currentFolder =
    typeof folderId === "string" ? folders.find((f) => f.id === folderId) : undefined;
  const allLabel = activeTab === "notes" ? "All notes" : "All recordings";
  const title =
    folderId === null
      ? activeTab === "notes"
        ? "Unfiled notes"
        : "Unfiled"
      : currentFolder
        ? currentFolder.name
        : allLabel;
  const itemLabel = activeTab === "notes" ? "note" : "recording";
  const emptyLabel = activeTab === "notes" ? "No notes yet." : "No recordings yet.";
  const dashboardParams = toURLSearchParams(sp);

  return (
    <>
      <TopNav
        userEmail={user.email ?? "unknown"}
        activePath="recordings"
        granolaEnabled={granolaEnabled}
      />
      <div className="mx-auto flex max-w-6xl">
        <FolderSidebar
          folders={folders}
          currentFolderId={folderId}
          allLabel={allLabel}
        />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {granolaEnabled && (
            <div className="mb-5">
              <DashboardTabs activeTab={activeTab} params={dashboardParams} />
            </div>
          )}

          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              {currentFolder && (
                <Breadcrumbs
                  folders={folders}
                  currentId={currentFolder.id}
                  rootLabel={allLabel}
                  tab={activeTab}
                />
              )}
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">
                {title}
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                {mediaItems.length === 0
                  ? query
                    ? `No matches for “${query}”.`
                    : emptyLabel
                  : `${mediaItems.length} ${itemLabel}${mediaItems.length === 1 ? "" : "s"}${
                      query ? ` matching “${query}”` : ""
                    }`}
              </p>
            </div>
            {activeTab === "notes" ? (
              <form action={createQuickNote}>
                <Button>
                  <Plus className="h-4 w-4" />
                  Quick note
                </Button>
              </form>
            ) : (
              <Link href="/record">
                <Button>
                  <Plus className="h-4 w-4" />
                  New recording
                </Button>
              </Link>
            )}
          </div>

          <div className="mt-6">
            <MobileFolderPicker
              folders={folders}
              currentFolderId={folderId}
              allLabel={allLabel}
            />
          </div>

          <div className="mt-4 md:mt-6">
            <SearchFilterBar
              brands={brands}
              showFilters={activeTab === "recordings"}
              placeholder={
                activeTab === "notes"
                  ? "Search note titles + transcripts…"
                  : "Search titles + transcripts…"
              }
            />
          </div>

          <div className="mt-8">
            {mediaItems.length === 0 ? (
              query ? (
                <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
                  <Search className="mx-auto h-6 w-6 text-text-subtle" />
                  <p className="mt-3 text-sm font-medium text-text">
                    {`No ${itemLabel}s match “${query}”.`}
                  </p>
                  <p className="mt-1 text-xs text-text-subtle">
                    Try a different keyword or clear the search to see everything.
                  </p>
                </div>
              ) : activeTab === "notes" ? (
                <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
                  <FileText className="mx-auto h-7 w-7 text-text-subtle" />
                  <p className="mt-3 text-base font-medium text-text">No notes yet</p>
                  <p className="mx-auto mt-1.5 max-w-[42ch] text-sm text-text-muted">
                    Record a meeting from the desktop app or start a quick note.
                  </p>
                  <form action={createQuickNote} className="mt-5 inline-block">
                    <Button>
                      <Plus className="h-4 w-4" />
                      Quick note
                    </Button>
                  </form>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
                  <Video className="mx-auto h-7 w-7 text-text-subtle" />
                  <p className="mt-3 text-base font-medium text-text">
                    No recordings yet
                  </p>
                  <p className="mx-auto mt-1.5 max-w-[42ch] text-sm text-text-muted">
                    Capture your screen, camera, and audio in a single click —
                    your first recording lives here.
                  </p>
                  <Link href="/record" className="mt-5 inline-block">
                    <Button>
                      <Plus className="h-4 w-4" />
                      New recording
                    </Button>
                  </Link>
                </div>
              )
            ) : (
              activeTab === "notes" ? (
                <NotesList notes={mediaItems} folders={folders} />
              ) : (
                <RecordingsGrid
                  recordings={mediaItems}
                  thumbnailUrls={thumbnailUrls}
                  previewUrls={previewUrls}
                  folders={folders}
                />
              )
            )}
          </div>
        </main>
      </div>
    </>
  );
}

function toURLSearchParams(params: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) next.set(key, value);
  }
  return next;
}
