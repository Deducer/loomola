import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { getR2Client, r2BucketName } from "@/lib/r2/client";
import { and, eq, isNull } from "drizzle-orm";

const FALLBACK_IMAGE_PATH = join(
  process.cwd(),
  "public",
  "branding",
  "loomola-logo-inline.png"
);

let fallbackImage: Promise<Uint8Array> | null = null;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const [rec] = await db
    .select({
      status: mediaObjects.status,
      passwordHash: mediaObjects.passwordHash,
      compositeThumbnailKey: mediaObjects.compositeThumbnailKey,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.slug, slug),
        eq(mediaObjects.type, "video"),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);

  if (
    !rec ||
    rec.passwordHash ||
    rec.status !== "ready" ||
    !rec.compositeThumbnailKey
  ) {
    return fallbackResponse();
  }

  try {
    const object = await getR2Client().send(
      new GetObjectCommand({
        Bucket: r2BucketName(),
        Key: rec.compositeThumbnailKey,
      })
    );
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) return fallbackResponse();

    return new NextResponse(toArrayBuffer(bytes), {
      status: 200,
      headers: {
        "content-type": object.ContentType ?? "image/jpeg",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.warn(`[share-thumbnail] falling back for ${slug}`, err);
    return fallbackResponse();
  }
}

async function fallbackResponse() {
  fallbackImage ??= readFile(FALLBACK_IMAGE_PATH);
  const bytes = await fallbackImage;

  return new NextResponse(toArrayBuffer(bytes), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
