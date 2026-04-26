import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listCommentsForRecording } from "@/db/queries/comments";
import { presignGet } from "@/lib/r2/presigned-get";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { PasswordGate } from "@/components/viewer/password-gate";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
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
          recordingId={rec.id}
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

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;
  const playerAccent = accent ?? "#8b5cf6";

  return (
    <div className="min-h-screen">
      <BrandHeader
        brandName={rec.brand?.name}
        brandLogoUrl={rec.brand?.logoUrl}
        accent={accent}
        isOwner={isOwner}
        recordingId={rec.id}
      />

      <main className="mx-auto max-w-4xl px-6 py-14">
        <h1 className="truncate text-[28px] font-semibold tracking-tight text-text">
          {displayTitle}
        </h1>
        <p className="mt-1.5 text-sm text-text-muted">
          {rec.brand?.name && (
            <span className="text-text">{rec.brand.name}</span>
          )}
          {rec.brand?.name && <span className="mx-2 text-text-subtle">·</span>}
          <span className="text-text-muted">{formatRelativeTime(rec.createdAt)}</span>
          {!isReady && (
            <>
              <span className="mx-2 text-text-subtle">·</span>
              <span className="text-text-muted">{rec.status}</span>
            </>
          )}
        </p>

        {isReady && signedVideoUrl ? (
          <div className="mt-8">
            <ViewerShell
              slug={slug}
              signedVideoUrl={signedVideoUrl}
              accentColor={playerAccent}
              summary={rec.aiSummary}
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

      </main>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 4) return `${diffWk} week${diffWk === 1 ? "" : "s"} ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo} month${diffMo === 1 ? "" : "s"} ago`;
  const diffYr = Math.floor(diffDay / 365);
  return `${diffYr} year${diffYr === 1 ? "" : "s"} ago`;
}

function BrandHeader({
  brandName,
  brandLogoUrl,
  accent,
  isOwner,
  recordingId,
}: {
  brandName?: string | null;
  brandLogoUrl?: string | null;
  accent: string | null;
  isOwner: boolean;
  recordingId?: string;
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
        {isOwner && recordingId && (
          <div className="flex items-center gap-3">
            <Link
              href={`/recordings/${recordingId}/edit`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-xs text-text-muted hover:border-accent hover:text-text"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
          </div>
        )}
      </header>
      {accent && (
        <div className="h-[2px] w-full" style={{ backgroundColor: accent }} />
      )}
    </>
  );
}
