import { db } from "@/db";
import {
  mediaObjects,
  aiOutputs,
  transcripts,
  brandProfiles,
  views,
  comments,
} from "@/db/schema";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { RecordingWithBrand } from "./recordings";
import { presignGet } from "@/lib/r2/presigned-get";

export type SearchSort =
  | "date_desc"
  | "date_asc"
  | "duration_desc"
  | "duration_asc"
  | "views_desc"
  | "title_asc";

export async function searchRecordings(params: {
  ownerId: string;
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
    conditions.push(
      sql`(
        coalesce(${mediaObjects.searchTsv}, ''::tsvector) ||
        coalesce(${aiOutputs.searchTsv}, ''::tsvector) ||
        coalesce(${transcripts.searchTsv}, ''::tsvector)
      ) @@ websearch_to_tsquery('english', ${q})`
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

  return Promise.all(
    rows.map(async (r) => {
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
          }
        : null;
      return {
        ...r.rec,
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
