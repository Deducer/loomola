import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listMaxWatched, countViews } from "@/db/queries/views";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { PasswordGate } from "@/components/viewer/password-gate";
import { OwnerToolbar } from "@/components/viewer/owner-toolbar";
import { DropoffChart } from "@/components/viewer/dropoff-chart";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { bucketize } from "@/lib/viewer/dropoff";
import type { Word } from "@/lib/viewer/paragraphs";

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
  const accent = rec.brand?.accentColor ?? "#4F46E5";

  // Password gate: if password set and visitor isn't owner and cookie invalid,
  // render just the gate. Owner bypasses the gate.
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
        <header
          className="flex items-center justify-between border-b border-white/10 px-6 py-3"
          style={{ borderBottomColor: accent }}
        />
        <PasswordGate slug={slug} />
      </div>
    );
  }

  const transcript = await getTranscriptByRecording(rec.id);
  const words: Word[] = Array.isArray(transcript?.wordTimestamps)
    ? (transcript.wordTimestamps as Word[])
    : [];

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;

  // Owner-only analytics
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
      <header
        className="flex items-center justify-between border-b border-white/10 px-6 py-3"
        style={{ borderBottomColor: accent }}
      >
        <div className="flex items-center gap-3">
          {rec.brand?.logoUrl && (
            <img
              src={rec.brand.logoUrl}
              alt={rec.brand.name}
              className="h-6 w-auto"
            />
          )}
          {rec.brand?.name && (
            <span className="text-sm font-semibold">{rec.brand.name}</span>
          )}
        </div>
        {isOwner && (
          <Link href="/" className="text-xs opacity-60 hover:opacity-100">
            Back to dashboard
          </Link>
        )}
      </header>

      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">{displayTitle}</h1>
        <p className="mt-1 text-sm opacity-60">
          {isReady ? "Ready" : `Status: ${rec.status}`}
          {isOwner && isReady && viewCount > 0 && (
            <> · {viewCount} view{viewCount === 1 ? "" : "s"}</>
          )}
        </p>

        {rec.aiSummary && (
          <p className="mt-4 text-sm leading-relaxed opacity-80">{rec.aiSummary}</p>
        )}

        {isOwner && (
          <OwnerToolbar
            recordingId={rec.id}
            hasPassword={!!rec.passwordHash}
          />
        )}

        {isReady && signedVideoUrl ? (
          <div className="mt-6">
            <ViewerShell
              slug={slug}
              signedVideoUrl={signedVideoUrl}
              accentColor={accent}
              chapters={rec.aiChapters ?? []}
              actionItems={rec.aiActionItems ?? []}
              words={words}
              fullText={transcript?.fullText ?? ""}
              isOwner={isOwner}
            />
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-white/10 p-8 text-center">
            <p className="text-lg">
              {rec.status === "transcribing"
                ? "Transcription in progress"
                : rec.status === "processing"
                  ? "AI outputs generating"
                  : rec.status === "uploading"
                    ? "Uploading"
                    : "Not ready"}
            </p>
            <p className="mt-2 text-sm opacity-60">
              Refresh in ~15–30 seconds.
            </p>
          </div>
        )}

        {isOwner && dropoffBuckets && <DropoffChart buckets={dropoffBuckets} />}

        <div className="mt-6 flex items-center gap-3 rounded-lg border border-white/10 p-4">
          <code className="flex-1 truncate rounded bg-white/5 px-3 py-2 text-sm">
            {shareUrl}
          </code>
          <CopyLinkButton url={shareUrl} />
        </div>
      </div>
    </div>
  );
}
