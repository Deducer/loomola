import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingForEdit } from "@/db/queries/recordings";
import { listMaxWatched, countViews } from "@/db/queries/views";
import { presignGet } from "@/lib/r2/presigned-get";
import { bucketize } from "@/lib/viewer/dropoff";
import { OwnerToolbar } from "@/components/viewer/owner-toolbar";
import { DropoffChart } from "@/components/viewer/dropoff-chart";
import { PreviewPlayer } from "@/components/edit/preview-player";
import { CopyLinkButton } from "@/components/share/copy-link-button";
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
          filename: `${rec.slug}-${d.fileKind}.webm`,
        }),
      }))
  );

  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;
  let dropoffBuckets: number[] | null = null;
  let viewCount = 0;
  if (isReady) {
    const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
    const maxList = await listMaxWatched(rec.id);
    dropoffBuckets = bucketize(maxList, durationSec, 10);
    viewCount = await countViews(rec.id);
  }

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
        <Link
          href={`/v/${rec.slug}`}
          target="_blank"
          className="text-sm text-text-muted hover:text-text"
        >
          View public page →
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {displayTitle}
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Status: {rec.status}
          {viewCount > 0 && (
            <>
              {" · "}
              {viewCount} view{viewCount === 1 ? "" : "s"}
            </>
          )}
        </p>

        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-3">
          <code className="flex-1 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted">
            {shareUrl}
          </code>
          <CopyLinkButton url={shareUrl} />
        </div>

        {signedVideoUrl && (
          <div className="mt-6">
            <PreviewPlayer signedUrl={signedVideoUrl} />
          </div>
        )}

        <OwnerToolbar
          recordingId={rec.id}
          hasPassword={!!rec.passwordHash}
          durationSec={
            rec.durationSeconds != null
              ? parseFloat(String(rec.durationSeconds))
              : null
          }
          trimStartSec={trimStartSec}
          trimEndSec={trimEndSec}
          downloads={downloads}
        />

        {dropoffBuckets && <DropoffChart buckets={dropoffBuckets} />}
      </main>
    </div>
  );
}
