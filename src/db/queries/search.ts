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
import type { RecordingWithBrand } from "./recordings";
import { presignGet } from "@/lib/r2/presigned-get";

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
}): Promise<RecordingWithBrand[]> {
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
      rec: mediaObjects,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
      brandLogoUrl: brandProfiles.logoUrl,
      brandLogoR2Key: brandProfiles.logoR2Key,
      brandLogoR2KeyDark: brandProfiles.logoR2KeyDark,
      brandTagline: brandProfiles.tagline,
      brandFontFamily: brandProfiles.fontFamily,
      brandCtaLabel: brandProfiles.ctaLabel,
      brandCtaUrl: brandProfiles.ctaUrl,
      brandFooterText: brandProfiles.footerText,
      brandDefaultTheme: brandProfiles.defaultTheme,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
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
          rows.map((r) => ({ id: r.rec.id, attendees: r.rec.attendees }))
        )
      : new Map<string, string[]>();

  return Promise.all(
    rows.map(async (r) => {
      const dt = r.brandDefaultTheme;
      const brand = r.brandId
        ? {
            id: r.brandId,
            name: r.brandName!,
            accentColor: r.brandAccent!,
            logoUrl: r.brandLogoR2Key
              ? await presignGet(r.brandLogoR2Key)
              : (r.brandLogoUrl ?? null),
            logoUrlDark: r.brandLogoR2KeyDark
              ? await presignGet(r.brandLogoR2KeyDark)
              : null,
            tagline: r.brandTagline,
            fontFamily: r.brandFontFamily,
            ctaLabel: r.brandCtaLabel,
            ctaUrl: r.brandCtaUrl,
            footerText: r.brandFooterText,
            defaultTheme:
              (dt === "light" || dt === "dark" ? dt : null) as
                | "light"
                | "dark"
                | null,
          }
        : null;
      const resolvedAttendeeNames = attendeeNames.get(r.rec.id);
      return {
        ...r.rec,
        attendees:
          resolvedAttendeeNames && resolvedAttendeeNames.length > 0
            ? resolvedAttendeeNames
            : r.rec.attendees,
        brand,
        aiTitle: r.aiTitle,
        aiSummary: r.aiSummary,
        aiChapters: r.aiChapters as RecordingWithBrand["aiChapters"],
        aiActionItems: r.aiActionItems as RecordingWithBrand["aiActionItems"],
        viewCount: r.viewCount ?? 0,
        commentCount: r.commentCount ?? 0,
      };
    })
  );
}
