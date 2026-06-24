import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { getOptionalAuthUser } from "@/lib/require-auth";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { listCommentsForRecording } from "@/db/queries/comments";
import { presignGet } from "@/lib/r2/presigned-get";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { PasswordGate } from "@/components/viewer/password-gate";
import { ViewerThemeToggle } from "@/components/viewer/viewer-theme-toggle";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import type { Word } from "@/lib/viewer/paragraphs";
import type { Metadata } from "next";

type SharePageParams = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: SharePageParams): Promise<Metadata> {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);

  const origin = appOrigin();
  const url = `${origin}/v/${slug}`;
  const imageUrl = `${origin}/api/v/${slug}/thumbnail.jpg`;
  const title = metadataTitle(rec);
  const description = metadataDescription(rec);

  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "Loomola",
      type: "video.other",
      images: [
        {
          url: imageUrl,
          width: 1280,
          height: 720,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

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
  defaultTheme?: "light" | "dark" | null;
} | null;

export default async function SharePage({
  params,
}: SharePageParams) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) notFound();

  const user = await getOptionalAuthUser();
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

      {/* Title band — title + meta sit flush-left to the page edge
          (just inside the standard px-4/sm:px-6 gutter), not within
          the centered video column. Reads as a "page header" tag
          rather than a centered headline, while the player below
          stays centered as the visual focal point. The radial brand
          glow shines through the bg-subtle/40 tint. */}
      <section className="border-b border-border/40 bg-bg-subtle/40 px-4 py-4 sm:px-6 sm:py-5">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-text sm:text-[28px] sm:leading-[1.2]">
            {displayTitle}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
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
      </section>

      <main className="mx-auto max-w-5xl px-4 pb-10 pt-6 sm:px-6 sm:pb-14 sm:pt-8">
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
              {rec.status === "failed" ? (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-destructive"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 animate-pulse rounded-full bg-accent"
                />
              )}
              {rec.status === "failed"
                ? "Processing failed"
                : rec.status === "transcribing"
                  ? "Transcription in progress"
                  : rec.status === "processing"
                    ? "AI outputs generating"
                    : rec.status === "uploading"
                      ? "Uploading"
                      : "Not ready"}
            </div>
            {rec.status === "failed" ? (
              <p className="mt-3 text-sm text-text-subtle">
                {/* failure_reason can mention provider/billing details —
                    owner-only. Visitors get a neutral line. */}
                {isOwner && rec.failureReason
                  ? rec.failureReason
                  : "The owner has been notified and can retry from their dashboard."}
              </p>
            ) : (
              <p className="mt-3 text-sm text-text-subtle">
                Refresh in ~15–30 seconds — this page will catch up
                automatically.
              </p>
            )}
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

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

function metadataTitle(rec: Awaited<ReturnType<typeof getRecordingBySlug>>): string {
  if (!rec) return "Loomola recording";
  if (rec.passwordHash) return "Protected Loomola recording";
  return rec.title || rec.aiTitle || "Untitled recording";
}

function metadataDescription(
  rec: Awaited<ReturnType<typeof getRecordingBySlug>>
): string {
  if (!rec) return "This Loomola link could not be found.";
  if (rec.passwordHash) return "Open this Loomola link to enter the password.";

  const fallback = "Watch this Loomola recording.";
  const text = (rec.aiSummary ?? fallback).replace(/\s+/g, " ").trim();
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trimEnd()}...`;
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
  const brandDefaultTheme = brand?.defaultTheme ?? null;
  // Apply the brand font as the page's primary font when set; otherwise the
  // `text-text`/etc tokens cascade naturally from globals.css.
  const style = fontFamily
    ? { fontFamily: `"${fontFamily}", var(--font-sans, ui-sans-serif, system-ui, sans-serif)` }
    : undefined;
  // Bootstrap script: when the brand has a defaultTheme set AND the
  // visitor has no stored next-themes preference yet, force-apply the
  // brand's theme before paint. Once the visitor toggles via
  // <ViewerThemeToggle>, their explicit choice goes into localStorage
  // and wins on subsequent visits. Wrapped in try/catch so a hostile
  // localStorage (private mode in some browsers) doesn't break render.
  const themeBootstrap = brandDefaultTheme
    ? `try{var s=localStorage.getItem('theme');if(!s){var t='${brandDefaultTheme}';document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(t);}}catch(e){}`
    : null;
  return (
    <div className="relative min-h-screen overflow-hidden" style={style}>
      {themeBootstrap && (
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      )}
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
          <ViewerThemeToggle />
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
