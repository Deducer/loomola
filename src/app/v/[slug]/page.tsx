import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";
import { CopyLinkButton } from "@/components/share/copy-link-button";
import Link from "next/link";

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

  let signedVideoUrl: string | null = null;
  if (isOwner && rec.status === "ready" && rec.r2CompositeKey) {
    signedVideoUrl = await presignGet(rec.r2CompositeKey);
  }

  return (
    <div className="min-h-screen">
      <header
        className="flex items-center justify-between border-b border-white/10 px-6 py-3"
        style={{ borderBottomColor: accent }}
      >
        <div className="flex items-center gap-3">
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
        <h1 className="text-2xl font-semibold">
          {rec.title || "Untitled recording"}
        </h1>
        <p className="mt-1 text-sm opacity-60">
          {rec.status === "ready" ? "Ready" : `Status: ${rec.status}`}
        </p>

        {isOwner && signedVideoUrl && (
          <video
            src={signedVideoUrl}
            controls
            className="mt-6 w-full rounded border border-white/10 bg-black"
          />
        )}

        {!isOwner && (
          <div className="mt-6 rounded-lg border border-white/10 p-8 text-center">
            <p className="text-lg">Viewer coming in M7.</p>
            <p className="mt-2 text-sm opacity-60">
              Playback, transcripts, chapters, and comments ship in a later
              milestone. For now, the recording exists and will be playable
              here once the viewer lands.
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
