import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { spriteLayout } from "@/lib/queue/jobs/generate-preview-sprite";

/**
 * Serves a WebVTT file for Plyr's `previewThumbnails` config. Each cue maps
 * a [start,end] timestamp range to an x/y/w/h crop region of the signed
 * sprite-sheet URL. Mirrors the share page's password gate so locked
 * recordings don't leak preview frames.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) return new NextResponse("Not Found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = !!user && user.id === rec.ownerId;

  if (rec.passwordHash && !isOwner) {
    const jar = await cookies();
    const token = jar.get(cookieName(slug))?.value ?? "";
    const unlocked = verifyUnlockToken({
      slug,
      passwordHash: rec.passwordHash,
      token,
    });
    if (!unlocked) return new NextResponse("Forbidden", { status: 403 });
  }

  if (!rec.previewSpriteKey) {
    return new NextResponse("No preview sprite available", { status: 404 });
  }

  const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
  const layout = spriteLayout(durationSec);
  if (layout.count === 0) {
    return new NextResponse("No preview sprite available", { status: 404 });
  }

  const spriteUrl = await presignGet(rec.previewSpriteKey);
  const vtt = buildVtt(spriteUrl, layout, durationSec);

  return new NextResponse(vtt, {
    status: 200,
    headers: {
      "content-type": "text/vtt; charset=utf-8",
      // Browsers + Plyr should be free to cache for the lifetime of the
      // signed URL. Signed URL TTLs are typically ~1h, so cap to 30m.
      "cache-control": "private, max-age=1800",
    },
  });
}

function buildVtt(
  spriteUrl: string,
  layout: ReturnType<typeof spriteLayout>,
  durationSec: number
): string {
  const lines: string[] = ["WEBVTT", ""];
  for (let i = 0; i < layout.count; i++) {
    const start = i * layout.intervalSec;
    const end = Math.min(start + layout.intervalSec, durationSec);
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    const x = col * layout.tileWidth;
    const y = row * layout.tileHeight;
    lines.push(
      `${formatVttTime(start)} --> ${formatVttTime(end)}`,
      `${spriteUrl}#xywh=${x},${y},${layout.tileWidth},${layout.tileHeight}`,
      ""
    );
  }
  return lines.join("\n");
}

function formatVttTime(sec: number): string {
  const safe = Math.max(0, sec);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const wholeSec = Math.floor(seconds);
  const ms = Math.round((seconds - wholeSec) * 1000);
  const pad = (n: number, w: number) => n.toString().padStart(w, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSec, 2)}.${pad(ms, 3)}`;
}
