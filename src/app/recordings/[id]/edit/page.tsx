import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart3, Download, Scissors } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingForEdit } from "@/db/queries/recordings";
import { listMaxWatched } from "@/db/queries/views";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listCommentsForRecording } from "@/db/queries/comments";
import { presignGet } from "@/lib/r2/presigned-get";
import { bucketize } from "@/lib/viewer/dropoff";
import { EditShell } from "@/components/edit/edit-shell";
import { EditHeader } from "@/components/edit/edit-header";
import { SettingsSection } from "@/components/edit/settings-section";
import { AddClipSection } from "@/components/edit/add-clip-section";
import { TrimEditor } from "@/components/viewer/trim-editor";
import { DownloadsList } from "@/components/viewer/downloads-list";
import { DropoffChart } from "@/components/edit/dropoff-chart";
import { DangerZone } from "@/components/edit/danger-zone";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { extensionForKey } from "@/lib/recordings/artifact-keys";
import type { Metadata } from "next";
import type { Word } from "@/lib/viewer/paragraphs";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EditRecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await params;
  const rec = await getRecordingForEdit(id, user.id);
  if (!rec) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shareUrl = `${appUrl}/v/${rec.slug}`;

  const trimStartSec =
    rec.trimStartSec != null ? parseFloat(String(rec.trimStartSec)) : null;
  const trimEndSec =
    rec.trimEndSec != null ? parseFloat(String(rec.trimEndSec)) : null;
  const trimActive = trimStartSec != null && trimEndSec != null;

  // Hide the Playback MP4 download when a trim is set because the R2 object is
  // full-length, while viewers see the JS-clamped range.
  const downloadKinds: Array<{
    kind: string;
    key: string | null;
    fileKind: string;
  }> = [
    ...(trimActive
      ? []
      : [
          {
            kind: "Playback MP4",
            key: rec.playbackMp4Key,
            fileKind: "playback",
          },
        ]),
    { kind: "Composite", key: rec.r2CompositeKey, fileKind: "composite" },
    { kind: "Screen", key: rec.r2ScreenKey, fileKind: "screen" },
    { kind: "Camera", key: rec.r2CameraKey, fileKind: "camera" },
    { kind: "Mic", key: rec.r2MicKey, fileKind: "mic" },
    {
      kind: "System audio",
      key: rec.r2SystemaudioKey,
      fileKind: "systemaudio",
    },
  ];

  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const playbackKey = rec.playbackMp4Key ?? rec.r2CompositeKey;
  const durationSec =
    rec.durationSeconds != null ? parseFloat(String(rec.durationSeconds)) : null;
  const playerAccent = rec.brand?.accentColor ?? "#8b5cf6";
  const addClipDisabledReason = !isReady
    ? "Wait for this recording to finish processing first."
    : trimActive
      ? "Clear the trim before adding a clip."
      : null;

  const [
    downloads,
    brandOptions,
    transcript,
    rawComments,
    maxWatched,
  ] = await Promise.all([
    Promise.all(
      downloadKinds
        .filter((download) => !!download.key)
        .map(async (download) => ({
          kind: download.kind,
          href: await presignGet(download.key!, {
            filename: `${rec.slug}-${download.fileKind}.${extensionForKey(
              download.key!,
              download.fileKind === "playback" ? "mp4" : "webm"
            )}`,
          }),
        }))
    ),
    listBrandProfiles(user.id),
    getTranscriptByRecording(rec.id),
    listCommentsForRecording(rec.id),
    isReady ? listMaxWatched(rec.id) : Promise.resolve([]),
  ]);

  const signedVideoUrl =
    isReady && playbackKey ? await presignGet(playbackKey) : null;
  const dropoffBuckets =
    isReady && durationSec != null ? bucketize(maxWatched, durationSec, 10) : [];
  const viewCount = rec.viewCount;
  const words: Word[] = Array.isArray(transcript?.wordTimestamps)
    ? (transcript.wordTimestamps as Word[])
    : [];
  const commentRows = rawComments.map((comment) => ({
    id: comment.id,
    commenterName: comment.commenterName,
    body: comment.body,
    timestampSec: parseFloat(String(comment.timestampSec)),
    createdAt: comment.createdAt.toISOString(),
  }));
  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";

  return (
    <div className="relative min-h-screen overflow-hidden">
      {rec.brand?.accentColor && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[420px]"
          style={{
            background: `radial-gradient(ellipse 75% 65% at 50% 0%, color-mix(in srgb, ${rec.brand.accentColor} 14%, transparent), transparent 68%)`,
          }}
        />
      )}
      <div className="relative z-10">
        <header className="flex h-14 items-center border-b border-border px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </header>
        {rec.brand?.accentColor && (
          <div
            aria-hidden
            className="h-[5px] w-full"
            style={{
              background: `linear-gradient(to bottom, ${rec.brand.accentColor}, transparent)`,
              opacity: 0.35,
            }}
          />
        )}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
          <EditShell
            stickyPreview={false}
            header={
              <EditHeader
                recordingId={rec.id}
                slug={rec.slug}
                title={displayTitle}
                status={rec.status}
                shareUrl={shareUrl}
              />
            }
            preview={
              signedVideoUrl ? (
                <ViewerShell
                  slug={rec.slug}
                  signedVideoUrl={signedVideoUrl}
                  accentColor={playerAccent}
                  summary={rec.aiSummary}
                  chapters={rec.aiChapters ?? []}
                  actionItems={rec.aiActionItems ?? []}
                  words={words}
                  fullText={transcript?.fullText ?? ""}
                  isOwner={true}
                  comments={commentRows}
                  trimStartSec={trimStartSec}
                  trimEndSec={trimEndSec}
                  durationSec={durationSec}
                  previewThumbnailsVttUrl={
                    rec.previewSpriteKey
                      ? `/api/v/${rec.slug}/preview-thumbnails.vtt`
                      : null
                  }
                  stickyPlayer
                  showCommentForm={false}
                  afterPlayer={
                    <RecordingStatsCard
                      viewCount={viewCount}
                      durationSec={durationSec}
                      brandName={rec.brand?.name ?? null}
                    />
                  }
                />
              ) : (
                <div className="rounded-xl border border-border bg-bg-subtle p-10 text-center text-sm text-text-subtle">
                  Preview available once processing finishes.
                </div>
              )
            }
            settings={
              <SettingsSection
                recordingId={rec.id}
                hasPassword={!!rec.passwordHash}
                brandProfileId={rec.brand?.id ?? null}
                brandOptions={brandOptions.map((brand) => ({
                  id: brand.id,
                  name: brand.name,
                }))}
              />
            }
            trim={
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <Scissors className="h-3.5 w-3.5" />
                  Trim
                </h2>
                <TrimEditor
                  recordingId={rec.id}
                  durationSec={durationSec}
                  initialStart={trimStartSec}
                  initialEnd={trimEndSec}
                />
              </section>
            }
            clips={
              <AddClipSection
                recordingId={rec.id}
                disabledReason={addClipDisabledReason}
              />
            }
            downloads={
              downloads.length > 0 ? (
                <section>
                  <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    <Download className="h-3.5 w-3.5" />
                    Downloads
                  </h2>
                  <DownloadsList links={downloads} />
                  {trimActive && (
                    <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
                      Trim is active — viewers see the trimmed range on the
                      share page. Raw tracks below are full-length source files.
                    </p>
                  )}
                </section>
              ) : null
            }
            analytics={
              isReady ? (
                <section>
                  <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Analytics
                  </h2>
                  <DropoffChart buckets={dropoffBuckets} />
                </section>
              ) : null
            }
            danger={<DangerZone recordingId={rec.id} title={displayTitle} />}
          />
        </main>
      </div>
    </div>
  );
}

function RecordingStatsCard({
  viewCount,
  durationSec,
  brandName,
}: {
  viewCount: number;
  durationSec: number | null;
  brandName: string | null;
}) {
  return (
    <div className="mt-4 grid gap-3 rounded-xl border border-border bg-bg-subtle/60 p-4 text-xs text-text-muted sm:grid-cols-3">
      <div>
        <div className="font-medium uppercase text-text-subtle">Views</div>
        <div className="mt-1 text-sm font-medium text-text">{viewCount}</div>
      </div>
      <div>
        <div className="font-medium uppercase text-text-subtle">Duration</div>
        <div className="mt-1 text-sm font-medium text-text">
          {durationSec != null ? formatDuration(durationSec) : "—"}
        </div>
      </div>
      <div>
        <div className="font-medium uppercase text-text-subtle">Brand</div>
        <div className="mt-1 truncate text-sm font-medium text-text">
          {brandName ?? "No brand"}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const totalSec = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (minutes < 60) return `${minutes}:${secs.toString().padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}
