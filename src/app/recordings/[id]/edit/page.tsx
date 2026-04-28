import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingForEdit } from "@/db/queries/recordings";
import { listMaxWatched } from "@/db/queries/views";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { presignGet } from "@/lib/r2/presigned-get";
import { bucketize } from "@/lib/viewer/dropoff";
import { EditShell } from "@/components/edit/edit-shell";
import { EditHeader } from "@/components/edit/edit-header";
import { PreviewPlayer } from "@/components/edit/preview-player";
import { SettingsSection } from "@/components/edit/settings-section";
import { TrimEditor } from "@/components/viewer/trim-editor";
import { DownloadsList } from "@/components/viewer/downloads-list";
import { DropoffChart } from "@/components/edit/dropoff-chart";
import { DangerZone } from "@/components/edit/danger-zone";
import type { Metadata } from "next";

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

  const downloadKinds: Array<{ kind: string; key: string | null; fileKind: string }> = [
    { kind: "Playback MP4", key: rec.playbackMp4Key, fileKind: "playback" },
    { kind: "Composite", key: rec.r2CompositeKey, fileKind: "composite" },
    { kind: "Screen", key: rec.r2ScreenKey, fileKind: "screen" },
    { kind: "Camera", key: rec.r2CameraKey, fileKind: "camera" },
    { kind: "Mic", key: rec.r2MicKey, fileKind: "mic" },
    { kind: "System audio", key: rec.r2SystemaudioKey, fileKind: "systemaudio" },
  ];
  const downloads = await Promise.all(
    downloadKinds
      .filter((d) => !!d.key)
      .map(async (d) => ({
        kind: d.kind,
        href: await presignGet(d.key!, {
          filename: `${rec.slug}-${d.fileKind}.${d.fileKind === "playback" ? "mp4" : "webm"}`,
        }),
      }))
  );

  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const playbackKey = rec.playbackMp4Key ?? rec.r2CompositeKey;
  const signedVideoUrl = isReady && playbackKey ? await presignGet(playbackKey) : null;

  let dropoffBuckets: number[] = [];
  if (isReady) {
    const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
    const maxList = await listMaxWatched(rec.id);
    dropoffBuckets = bucketize(maxList, durationSec, 10);
  }
  const viewCount = rec.viewCount;

  const brandOptions = await listBrandProfiles(user.id);
  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center border-b border-border px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">
        <EditShell
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
              <>
                <PreviewPlayer signedUrl={signedVideoUrl} />
                <div className="mt-4 rounded-lg border border-border bg-bg-subtle p-3 text-xs text-text-muted">
                  <div>Views: <span className="text-text">{viewCount}</span></div>
                  <div className="mt-1">
                    Duration: <span className="text-text">
                      {rec.durationSeconds
                        ? `${Math.round(parseFloat(String(rec.durationSeconds)))}s`
                        : "—"}
                    </span>
                  </div>
                </div>
              </>
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
              brandOptions={brandOptions.map((b) => ({ id: b.id, name: b.name }))}
            />
          }
          trim={
            <section>
              <h2 className="mb-3 text-sm font-semibold text-text">Trim</h2>
              <TrimEditor
                recordingId={rec.id}
                durationSec={
                  rec.durationSeconds != null
                    ? parseFloat(String(rec.durationSeconds))
                    : null
                }
                initialStart={trimStartSec}
                initialEnd={trimEndSec}
              />
            </section>
          }
          downloads={
            downloads.length > 0 ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-text">Downloads</h2>
                <DownloadsList links={downloads} />
              </section>
            ) : null
          }
          analytics={
            isReady ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-text">Analytics</h2>
                <DropoffChart buckets={dropoffBuckets} />
              </section>
            ) : null
          }
          danger={<DangerZone recordingId={rec.id} title={displayTitle} />}
        />
      </main>
    </div>
  );
}
