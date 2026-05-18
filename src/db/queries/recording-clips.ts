import { db } from "@/db";
import { aiOutputs, mediaObjects, transcripts } from "@/db/schema";
import { presignGet } from "@/lib/r2/presigned-get";
import { isUuid, type ClipReference } from "@/lib/recordings/clip-reference";
import {
  and,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

export type ClipCandidate = {
  id: string;
  slug: string;
  title: string;
  durationSeconds: number | null;
  createdAt: Date;
  thumbnailUrl: string | null;
  summary: string | null;
  transcriptPreview: string | null;
};

export type AppendClipMedia = Pick<
  typeof mediaObjects.$inferSelect,
  | "id"
  | "ownerId"
  | "type"
  | "slug"
  | "title"
  | "status"
  | "durationSeconds"
  | "r2CompositeKey"
  | "trimStartSec"
  | "trimEndSec"
  | "deletedAt"
>;

export async function listAppendClipCandidates(params: {
  ownerId: string;
  targetId: string;
  query?: string;
  reference?: ClipReference | null;
  limit: number;
}): Promise<ClipCandidate[]> {
  const conditions = appendableVideoConditions(params.ownerId, params.targetId);
  const search = searchCondition(params.query, params.reference);
  if (search) conditions.push(search);

  const rows = await db
    .select({
      id: mediaObjects.id,
      slug: mediaObjects.slug,
      title: mediaObjects.title,
      durationSeconds: mediaObjects.durationSeconds,
      createdAt: mediaObjects.createdAt,
      compositeThumbnailKey: mediaObjects.compositeThumbnailKey,
      aiTitle: aiOutputs.titleSuggested,
      summary: aiOutputs.summary,
      transcript: transcripts.fullText,
    })
    .from(mediaObjects)
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .where(and(...conditions))
    .orderBy(desc(mediaObjects.createdAt))
    .limit(params.limit);

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title ?? row.aiTitle ?? "Untitled recording",
      durationSeconds:
        row.durationSeconds == null ? null : Number(row.durationSeconds),
      createdAt: row.createdAt,
      thumbnailUrl: row.compositeThumbnailKey
        ? await presignGet(row.compositeThumbnailKey)
        : null,
      summary: row.summary,
      transcriptPreview: previewText(row.transcript, params.query),
    }))
  );
}

export async function getAppendClipTarget(params: {
  ownerId: string;
  targetId: string;
}): Promise<AppendClipMedia | null> {
  const [row] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      type: mediaObjects.type,
      slug: mediaObjects.slug,
      title: mediaObjects.title,
      status: mediaObjects.status,
      durationSeconds: mediaObjects.durationSeconds,
      r2CompositeKey: mediaObjects.r2CompositeKey,
      trimStartSec: mediaObjects.trimStartSec,
      trimEndSec: mediaObjects.trimEndSec,
      deletedAt: mediaObjects.deletedAt,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.ownerId, params.ownerId),
        eq(mediaObjects.id, params.targetId),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function getAppendClipSource(params: {
  ownerId: string;
  reference: ClipReference;
}): Promise<AppendClipMedia | null> {
  const idOrSlug =
    params.reference.kind === "id"
      ? eq(mediaObjects.id, params.reference.value)
      : eq(mediaObjects.slug, params.reference.value);

  const [row] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      type: mediaObjects.type,
      slug: mediaObjects.slug,
      title: mediaObjects.title,
      status: mediaObjects.status,
      durationSeconds: mediaObjects.durationSeconds,
      r2CompositeKey: mediaObjects.r2CompositeKey,
      trimStartSec: mediaObjects.trimStartSec,
      trimEndSec: mediaObjects.trimEndSec,
      deletedAt: mediaObjects.deletedAt,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.ownerId, params.ownerId),
        idOrSlug,
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export function appendClipBlockReason(
  media: AppendClipMedia | null
):
  | "not_found"
  | "not_video"
  | "not_ready"
  | "missing_composite"
  | "missing_duration"
  | "trim_active"
  | null {
  if (!media) return "not_found";
  if (media.type !== "video") return "not_video";
  if (media.status !== "ready") return "not_ready";
  if (!media.r2CompositeKey) return "missing_composite";
  if (media.durationSeconds == null || !isFinite(Number(media.durationSeconds))) {
    return "missing_duration";
  }
  if (media.trimStartSec != null || media.trimEndSec != null) return "trim_active";
  return null;
}

function appendableVideoConditions(ownerId: string, targetId: string): SQL[] {
  return [
    eq(mediaObjects.ownerId, ownerId),
    ne(mediaObjects.id, targetId),
    eq(mediaObjects.type, "video"),
    eq(mediaObjects.status, "ready"),
    isNotNull(mediaObjects.r2CompositeKey),
    isNull(mediaObjects.trimStartSec),
    isNull(mediaObjects.trimEndSec),
    isNull(mediaObjects.deletedAt),
  ];
}

function searchCondition(
  query: string | undefined,
  reference: ClipReference | null | undefined
): SQL | null {
  const trimmed = query?.trim();
  const clauses: SQL[] = [];

  if (reference?.kind === "id" && isUuid(reference.value)) {
    clauses.push(eq(mediaObjects.id, reference.value));
  }
  if (reference?.kind === "slug") {
    clauses.push(eq(mediaObjects.slug, reference.value));
  }

  if (trimmed) {
    const like = `%${trimmed.replace(/[%_]/g, "\\$&")}%`;
    clauses.push(
      ilike(mediaObjects.title, like),
      ilike(aiOutputs.titleSuggested, like),
      ilike(aiOutputs.summary, like),
      ilike(transcripts.fullText, like),
      ilike(mediaObjects.slug, like)
    );
  }

  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : or(...clauses)!;
}

function previewText(text: string | null, query?: string): string | null {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const trimmedQuery = query?.trim().toLowerCase();
  if (!trimmedQuery) return truncate(normalized, 180);

  const index = normalized.toLowerCase().indexOf(trimmedQuery);
  if (index < 0) return truncate(normalized, 180);

  const start = Math.max(0, index - 70);
  const end = Math.min(normalized.length, index + trimmedQuery.length + 110);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < normalized.length ? " ..." : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 4)} ...`;
}
