import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import { ViewerShell } from "@/components/viewer/viewer-shell";
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

  const transcript = await getTranscriptByRecording(rec.id);
  const words: Word[] = Array.isArray(transcript?.wordTimestamps)
    ? (transcript.wordTimestamps as Word[])
    : [];

  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const isReady = rec.status === "ready" && !!rec.r2CompositeKey;
  const signedVideoUrl = isReady ? await presignGet(rec.r2CompositeKey!) : null;

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
        </p>

        {rec.aiSummary && (
          <p className="mt-4 text-sm leading-relaxed opacity-80">{rec.aiSummary}</p>
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
