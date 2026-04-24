import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listMaxWatched, countViews } from "@/db/queries/views";
import { listCommentsForRecording } from "@/db/queries/comments";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { PasswordGate } from "@/components/viewer/password-gate";
import { OwnerToolbar } from "@/components/viewer/owner-toolbar";
import { DropoffChart } from "@/components/viewer/dropoff-chart";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { bucketize } from "@/lib/viewer/dropoff";
import type { Word } from "@/lib/viewer/paragraphs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isOwner = !!user && user.id === rec.ownerId;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shareUrl = `${appUrl}/v/${slug}`;
  const accent = rec.brand?.accentColor ?? null;

  let unlocked = true;
  if (rec.passwordHash && !isOwner) {
    const jar = await cookies();
    const token = jar.get(cookieName(slug))?.value ?? "";
    unlocked = verifyUnlockToken({
      slug,
      passwordHash: rec.passwordHash,
      token,
    });
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen">
        <BrandHeader
          brandName={rec.brand?.name}
          brandLogoUrl={rec.brand?.logoUrl}
          accent={accent}
          isOwner={false}
        />
        <PasswordGate slug={slug} />
      </div>
    );
  }

  const transcript = await getTranscriptByRecording(rec.id);
  const words: Word[] = Array.isArray(transcript?.wordTimestamps)
    ? (transcript.wordTimestamps as Word[])
    : [];

  const rawComments = await listCommentsForRecording(rec.id);
  const commentRows = rawComments.map((c) => ({
    id: c.id,
    commenterName: c.commenterName,
    body: c.body,
    timestampSec: parseFloat(String(c.timestampSec)),
    createdAt: c.createdAt.toISOString(),
  }));

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
  const downloads = isOwner
    ? await Promise.all(
        downloadKinds
          .filter((d) => !!d.key)
          .map(async (d) => ({
            kind: d.kind,
            href: await presignGet(d.key!, {
              filename: `${slug}-${d.fileKind}.webm`,
            }),
          }))
      )
    : [];

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;
  const playerAccent = accent ?? "#8b5cf6";

  let dropoffBuckets: number[] | null = null;
  let viewCount = 0;
  if (isOwner && isReady) {
    const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
    const maxList = await listMaxWatched(rec.id);
    dropoffBuckets = bucketize(maxList, durationSec, 10);
    viewCount = await countViews(rec.id);
  }

  return (
    <div className="min-h-screen">
      <BrandHeader
        brandName={rec.brand?.name}
        brandLogoUrl={rec.brand?.logoUrl}
        accent={accent}
        isOwner={isOwner}
      />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {displayTitle}
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          {isReady ? "Ready" : `Status: ${rec.status}`}
          {isOwner && isReady && viewCount > 0 && (
            <>
              {" · "}
              {viewCount} view{viewCount === 1 ? "" : "s"}
            </>
          )}
        </p>

        {rec.aiSummary && (
          <p className="mt-6 text-[15px] leading-7 text-text-muted">
            {rec.aiSummary}
          </p>
        )}

        {isOwner && (
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
        )}

        {isReady && signedVideoUrl ? (
          <div className="mt-8">
            <ViewerShell
              slug={slug}
              signedVideoUrl={signedVideoUrl}
              accentColor={playerAccent}
              chapters={rec.aiChapters ?? []}
              actionItems={rec.aiActionItems ?? []}
              words={words}
              fullText={transcript?.fullText ?? ""}
              isOwner={isOwner}
              comments={commentRows}
              trimStartSec={trimStartSec}
              trimEndSec={trimEndSec}
            />
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-border bg-bg-subtle p-10 text-center">
            <p className="text-base font-medium text-text">
              {rec.status === "transcribing"
                ? "Transcription in progress"
                : rec.status === "processing"
                  ? "AI outputs generating"
                  : rec.status === "uploading"
                    ? "Uploading"
                    : "Not ready"}
            </p>
            <p className="mt-2 text-sm text-text-subtle">
              Refresh in ~15–30 seconds.
            </p>
          </div>
        )}

        {isOwner && dropoffBuckets && <DropoffChart buckets={dropoffBuckets} />}

        <div className="mt-10 flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-3">
          <code className="flex-1 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted">
            {shareUrl}
          </code>
          <CopyLinkButton url={shareUrl} />
        </div>
      </main>
    </div>
  );
}

function BrandHeader({
  brandName,
  brandLogoUrl,
  accent,
  isOwner,
}: {
  brandName?: string | null;
  brandLogoUrl?: string | null;
  accent: string | null;
  isOwner: boolean;
}) {
  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          {brandLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brandLogoUrl}
              alt={brandName ?? ""}
              className="h-6 w-auto"
            />
          )}
          {brandName && (
            <span className="text-sm font-semibold text-text">{brandName}</span>
          )}
        </div>
        {isOwner && (
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
        )}
      </header>
      {accent && (
        <div className="h-[2px] w-full" style={{ backgroundColor: accent }} />
      )}
    </>
  );
}
