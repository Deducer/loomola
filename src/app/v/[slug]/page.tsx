import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listCommentsForRecording } from "@/db/queries/comments";
import { presignGet } from "@/lib/r2/presigned-get";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { PasswordGate } from "@/components/viewer/password-gate";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import type { Word } from "@/lib/viewer/paragraphs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type BrandLike = {
  name?: string | null;
  logoUrl?: string | null;
  logoUrlDark?: string | null;
  accentColor?: string | null;
  tagline?: string | null;
  fontFamily?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  footerText?: string | null;
} | null;

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

  const brand = rec.brand ?? null;
  const accent = brand?.accentColor ?? null;

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
      <BrandFrame brand={brand}>
        <BrandHeader
          brand={brand}
          isOwner={false}
          recordingId={rec.id}
          showCta={true}
        />
        <PasswordGate slug={slug} />
        <BrandFooter brand={brand} />
      </BrandFrame>
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
  const playbackKey = rec.playbackMp4Key ?? rec.r2CompositeKey;
  const signedVideoUrl = isReady && playbackKey ? await presignGet(playbackKey) : null;
  const playerAccent = accent ?? "#8b5cf6";

  return (
    <BrandFrame brand={brand}>
      <BrandHeader
        brand={brand}
        isOwner={isOwner}
        recordingId={rec.id}
        showCta={!isOwner}
      />

      {/* Title band — left-anchored title + brand/time meta on a
          slightly tinted full-width strip. The title block sits at the
          LEFT of the page-centered max-w-5xl column (capped at
          max-w-3xl), creating a "tag" feel rather than a centered
          headline. The player below takes the full max-w-5xl width
          and reads as the focal point. The radial brand glow shines
          through the bg-subtle/40 tint. */}
      <section className="border-b border-border/40 bg-bg-subtle/40 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-text sm:text-[32px] sm:leading-[1.15]">
            {displayTitle}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            {brand?.name && (
              <>
                <span className="font-medium text-text">{brand.name}</span>
                <span aria-hidden="true" className="text-text-subtle">
                  ·
                </span>
              </>
            )}
            <span>{formatRelativeTime(rec.createdAt)}</span>
            {!isReady && (
              <>
                <span aria-hidden="true" className="text-text-subtle">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                  />
                  {rec.status}
                </span>
              </>
            )}
          </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        {isReady && signedVideoUrl ? (
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
            durationSec={
              rec.durationSeconds != null
                ? parseFloat(String(rec.durationSeconds))
                : null
            }
            previewThumbnailsVttUrl={
              rec.previewSpriteKey
                ? `/api/v/${slug}/preview-thumbnails.vtt`
                : null
            }
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
            <div className="inline-flex items-center gap-2 text-base font-medium text-text">
              <span
                aria-hidden="true"
                className="h-2 w-2 animate-pulse rounded-full bg-accent"
              />
              {rec.status === "transcribing"
                ? "Transcription in progress"
                : rec.status === "processing"
                  ? "AI outputs generating"
                  : rec.status === "uploading"
                    ? "Uploading"
                    : "Not ready"}
            </div>
            <p className="mt-3 text-sm text-text-subtle">
              Refresh in ~15–30 seconds — this page will catch up automatically.
            </p>
          </div>
        )}
      </main>

      <BrandFooter brand={brand} />
    </BrandFrame>
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

function googleFontHref(fontFamily: string): string {
  // e.g. "IBM Plex Sans" → "IBM+Plex+Sans"
  const encoded = encodeURIComponent(fontFamily.trim()).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700&display=swap`;
}

function BrandFrame({
  brand,
  children,
}: {
  brand: BrandLike;
  children: React.ReactNode;
}) {
  const fontFamily = brand?.fontFamily?.trim();
  const accent = brand?.accentColor ?? null;
  // Apply the brand font as the page's primary font when set; otherwise the
  // `text-text`/etc tokens cascade naturally from globals.css.
  const style = fontFamily
    ? { fontFamily: `"${fontFamily}", var(--font-sans, ui-sans-serif, system-ui, sans-serif)` }
    : undefined;
  return (
    <div className="relative min-h-screen overflow-hidden" style={style}>
      {fontFamily && (
        <>
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link
            rel="preconnect"
            href="https://fonts.googleapis.com"
          />
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin=""
          />
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link
            rel="stylesheet"
            href={googleFontHref(fontFamily)}
          />
        </>
      )}
      {/* Subtle accent-tinted radial glow at the top of branded share
          pages — gives the page a hint of the brand's color without
          overwhelming. Unbranded recordings get the flat dark theme. */}
      {accent && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[520px]"
          style={{
            background: `radial-gradient(ellipse 75% 65% at 50% 0%, color-mix(in srgb, ${accent} 18%, transparent), transparent 65%)`,
          }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function BrandHeader({
  brand,
  isOwner,
  recordingId,
  showCta,
}: {
  brand: BrandLike;
  isOwner: boolean;
  recordingId?: string;
  showCta: boolean;
}) {
  const accent = brand?.accentColor ?? null;
  const ctaActive =
    showCta && !!brand?.ctaLabel?.trim() && !!brand?.ctaUrl?.trim();

  return (
    <>
      <header className="relative flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <BrandLogo
              light={brand?.logoUrl ?? null}
              dark={brand?.logoUrlDark ?? null}
              alt={brand?.name ?? ""}
              className="h-8 w-auto object-contain"
            />
            {/* Brand-name text only renders when the brand has NO logo.
                When a logo exists it almost always already contains the
                brand name in its asset, so showing both reads as
                duplicated wordmark. */}
            {brand?.name && !brand.logoUrl && !brand.logoUrlDark && (
              <span className="text-base font-semibold tracking-tight text-text">
                {brand.name}
              </span>
            )}
          </div>
          {brand?.tagline && (
            <p className="ml-0 max-w-[60ch] text-xs text-text-muted">
              {brand.tagline}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {ctaActive && (
            <a
              href={brand!.ctaUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-accent-fg shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:opacity-95 hover:shadow-md active:scale-[0.98]"
              style={{
                backgroundColor: accent ?? "var(--accent)",
              }}
            >
              {brand!.ctaLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {isOwner && recordingId && (
            <>
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
            </>
          )}
        </div>
      </header>
      {accent && (
        // Soft accent fade replaces the old hard 2px line. Reads as a
        // brand presence rather than a flat divider — pairs with the
        // radial glow at the top of the page.
        <div
          aria-hidden
          className="h-[5px] w-full"
          style={{
            background: `linear-gradient(to bottom, ${accent}, transparent)`,
            opacity: 0.45,
          }}
        />
      )}
    </>
  );
}

function BrandFooter({ brand }: { brand: BrandLike }) {
  const text = brand?.footerText?.trim();
  if (!text) return null;
  return (
    <footer className="mt-12 border-t border-border px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl text-xs leading-relaxed text-text-muted">
        {text}
      </div>
    </footer>
  );
}
