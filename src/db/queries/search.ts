import { db } from "@/db";
import {
  mediaObjects,
  aiOutputs,
  transcripts,
  brandProfiles,
  views,
  comments,
  people,
} from "@/db/schema";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { RecordingListItem } from "./recordings";

export type SearchSort =
  | "date_desc"
  | "date_asc"
  | "duration_desc"
  | "duration_asc"
  | "views_desc"
  | "title_asc";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseAttendeeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && UUID_RE.test(item)
  );
}

async function attendeeNamesForRows(
  ownerId: string,
  rows: Array<{ id: string; attendees: unknown }>
): Promise<Map<string, string[]>> {
  const personIds = Array.from(
    new Set(rows.flatMap((row) => parseAttendeeIds(row.attendees)))
  );
  const result = new Map<string, string[]>();
  if (personIds.length === 0) return result;

  const peopleRows = await db
    .select({
      id: people.id,
      displayName: people.displayName,
    })
    .from(people)
    .where(and(eq(people.ownerId, ownerId), inArray(people.id, personIds)));
  const peopleById = new Map(
    peopleRows.map((person) => [person.id, person.displayName])
  );

  for (const row of rows) {
    const names = parseAttendeeIds(row.attendees)
      .map((id) => peopleById.get(id))
      .filter((name): name is string => Boolean(name));
    result.set(row.id, names);
  }

  return result;
}

function attendeeSearchCondition(query: string): SQL {
  const like = `%${query}%`;
  return sql`EXISTS (
    SELECT 1 FROM ${people}
    WHERE ${people.ownerId} = ${mediaObjects.ownerId}
      AND ${mediaObjects.attendees} @> jsonb_build_array(${people.id}::text)
      AND (
        ${people.displayName} ILIKE ${like}
        OR ${people.email} ILIKE ${like}
      )
  )`;
}

export async function searchRecordings(params: {
  ownerId: string;
  type?: "video" | "audio";
  query?: string;
  folderId?: string | null; // undefined = all folders; null = unfiled
  status?: string[];
  brandId?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}): Promise<RecordingListItem[]> {
  const hasQuery = !!params.query?.trim();
  const q = hasQuery ? params.query!.trim() : null;
  const sort: SearchSort = params.sort ?? "date_desc";
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const conditions: SQL[] = [
    eq(mediaObjects.ownerId, params.ownerId),
    eq(mediaObjects.type, params.type ?? "video"),
    isNull(mediaObjects.deletedAt),
  ];
  if (params.folderId === null) {
    conditions.push(isNull(mediaObjects.folderId));
  } else if (typeof params.folderId === "string") {
    conditions.push(eq(mediaObjects.folderId, params.folderId));
  }
  if (params.status && params.status.length > 0) {
    conditions.push(sql`${mediaObjects.status}::text = ANY(${params.status})`);
  }
  if (params.brandId) {
    conditions.push(eq(mediaObjects.brandProfileId, params.brandId));
  }

  const rankExpr = hasQuery
    ? sql<number>`ts_rank(
        coalesce(${mediaObjects.searchTsv}, ''::tsvector) ||
        coalesce(${aiOutputs.searchTsv}, ''::tsvector) ||
        coalesce(${transcripts.searchTsv}, ''::tsvector),
        websearch_to_tsquery('english', ${q})
      )`
    : sql<number>`0::float4`;

  if (hasQuery) {
    const textSearchCondition = sql`(
      coalesce(${mediaObjects.searchTsv}, ''::tsvector) ||
      coalesce(${aiOutputs.searchTsv}, ''::tsvector) ||
      coalesce(${transcripts.searchTsv}, ''::tsvector)
    ) @@ websearch_to_tsquery('english', ${q})`;
    conditions.push(
      params.type === "audio"
        ? sql`(${textSearchCondition} OR ${attendeeSearchCondition(q!)})`
        : textSearchCondition
    );
  }

  const viewCountExpr = sql<number>`(
    SELECT count(*)::int FROM ${views}
    WHERE ${views.mediaObjectId} = ${mediaObjects.id}
  )`.as("view_count");
  const commentCountExpr = sql<number>`(
    SELECT count(*)::int FROM ${comments}
    WHERE ${comments.mediaObjectId} = ${mediaObjects.id}
  )`.as("comment_count");

  const orderBy = hasQuery
    ? sql`rank DESC, ${mediaObjects.createdAt} DESC`
    : sort === "date_asc"
      ? sql`${mediaObjects.createdAt} ASC`
      : sort === "duration_desc"
        ? sql`${mediaObjects.durationSeconds} DESC NULLS LAST`
        : sort === "duration_asc"
          ? sql`${mediaObjects.durationSeconds} ASC NULLS LAST`
          : sort === "views_desc"
            ? sql`view_count DESC`
            : sort === "title_asc"
              ? sql`coalesce(${mediaObjects.title}, ${aiOutputs.titleSuggested}, '') ASC`
              : sql`${mediaObjects.createdAt} DESC`;

  const rows = await db
    .select({
      id: mediaObjects.id,
      type: mediaObjects.type,
      slug: mediaObjects.slug,
      title: mediaObjects.title,
      status: mediaObjects.status,
      failureReason: mediaObjects.failureReason,
      durationSeconds: mediaObjects.durationSeconds,
      r2CompositeKey: mediaObjects.r2CompositeKey,
      compositeThumbnailKey: mediaObjects.compositeThumbnailKey,
      folderId: mediaObjects.folderId,
      attendees: mediaObjects.attendees,
      suggestedFolderId: mediaObjects.suggestedFolderId,
      createdAt: mediaObjects.createdAt,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
      aiTitle: aiOutputs.titleSuggested,
      viewCount: viewCountExpr,
      commentCount: commentCountExpr,
      rank: rankExpr.as("rank"),
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const attendeeNames =
    params.type === "audio"
      ? await attendeeNamesForRows(
          params.ownerId,
          rows.map((r) => ({ id: r.id, attendees: r.attendees }))
        )
      : new Map<string, string[]>();

  return rows.map((r) => {
    const brand = r.brandId
      ? {
          id: r.brandId,
          name: r.brandName!,
          accentColor: r.brandAccent!,
        }
      : null;
    const resolvedAttendeeNames = attendeeNames.get(r.id);
    return {
      id: r.id,
      type: r.type,
      slug: r.slug,
      title: r.title,
      status: r.status,
      failureReason: r.failureReason,
      durationSeconds: r.durationSeconds,
      r2CompositeKey: r.r2CompositeKey,
      compositeThumbnailKey: r.compositeThumbnailKey,
      folderId: r.folderId,
      attendees:
        resolvedAttendeeNames && resolvedAttendeeNames.length > 0
          ? resolvedAttendeeNames
          : r.attendees,
      suggestedFolderId: r.suggestedFolderId,
      createdAt: r.createdAt,
      brand,
      aiTitle: r.aiTitle,
      viewCount: r.viewCount ?? 0,
      commentCount: r.commentCount ?? 0,
    };
  });
}
