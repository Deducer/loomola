import { db } from "@/db";
import {
  aiOutputs,
  comments,
  folders,
  mediaObjects,
  notes,
  people,
  speakerAssignments,
  summaryEmbeddings,
  transcripts,
} from "@/db/schema";
import { listImageAttachmentsForMediaIds } from "@/db/queries/notes";
import { presignGet } from "@/lib/r2/presigned-get";
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

export type MediaType = "video" | "audio";
export type MediaTypeFilter = MediaType | "any";

export type RecentMediaItem = {
  id: string;
  slug: string;
  type: MediaType;
  title: string;
  summary: string | null;
  durationSeconds: number | null;
  status: typeof mediaObjects.$inferSelect.status;
  createdAt: Date;
  shareUrl: string;
  thumbnailUrl: string | null;
  transcriptReady: boolean | null;
  folderId: string | null;
  folderName: string | null;
  attendees: Array<{ id: string; name: string; email: string | null }>;
};

export type MediaDetails = {
  media: typeof mediaObjects.$inferSelect;
  title: string;
  summary: string | null;
  shareUrl: string;
  folder: typeof folders.$inferSelect | null;
  note: typeof notes.$inferSelect | null;
  transcript: typeof transcripts.$inferSelect | null;
  aiOutput: typeof aiOutputs.$inferSelect | null;
  comments: Array<typeof comments.$inferSelect>;
  attendees: Array<{ id: string; name: string; email: string | null }>;
  speakerAssignments: Array<{
    speakerIdx: number;
    personId: string | null;
    displayName: string | null;
    displayLabelOverride: string | null;
    isSuggestion: boolean;
  }>;
};

export type SearchMediaResult = {
  id: string;
  slug: string;
  type: MediaType;
  title: string;
  summary: string | null;
  createdAt: Date;
  similarity: number;
  shareUrl: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

export function mediaShareUrl(media: {
  type: MediaType;
  slug: string;
}): string {
  return `${appUrl()}${media.type === "audio" ? "/notes" : "/v"}/${media.slug}`;
}

function sinceDate(daysBack?: number): Date | undefined {
  if (!daysBack) return undefined;
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
}

function titleFor(row: {
  title: string | null;
  aiTitle: string | null;
}): string {
  return row.title ?? row.aiTitle ?? "Untitled";
}

export function parseAttendeeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && UUID_RE.test(item)
  );
}

async function attendeesForRows(
  ownerId: string,
  rows: Array<{ id: string; attendees: unknown }>
): Promise<Map<string, RecentMediaItem["attendees"]>> {
  const personIds = Array.from(
    new Set(rows.flatMap((row) => parseAttendeeIds(row.attendees)))
  );
  const result = new Map<string, RecentMediaItem["attendees"]>();
  if (personIds.length === 0) return result;

  const peopleRows = await db
    .select({
      id: people.id,
      displayName: people.displayName,
      email: people.email,
    })
    .from(people)
    .where(and(eq(people.ownerId, ownerId), inArray(people.id, personIds)));
  const personById = new Map(peopleRows.map((person) => [person.id, person]));

  for (const row of rows) {
    const list = parseAttendeeIds(row.attendees)
      .map((id) => personById.get(id))
      .filter((person): person is NonNullable<typeof person> => !!person)
      .map((person) => ({
        id: person.id,
        name: person.displayName,
        email: person.email,
      }));
    result.set(row.id, list);
  }

  return result;
}

export async function recentMediaItems(params: {
  ownerId: string;
  type?: MediaType;
  limit: number;
  daysBack?: number;
  // ai_outputs.summary can run to 200K chars per row. The desktop recent
  // route never returns it, so it passes false to keep the bytes in
  // Postgres; the MCP tools (which do surface summaries) keep the default.
  includeSummary?: boolean;
}): Promise<RecentMediaItem[]> {
  const conditions = [
    eq(mediaObjects.ownerId, params.ownerId),
    isNull(mediaObjects.deletedAt),
  ];
  if (params.type) conditions.push(eq(mediaObjects.type, params.type));
  const since = sinceDate(params.daysBack);
  if (since) conditions.push(gte(mediaObjects.createdAt, since));

  const rows = await db
    .select({
      id: mediaObjects.id,
      slug: mediaObjects.slug,
      type: mediaObjects.type,
      title: mediaObjects.title,
      status: mediaObjects.status,
      durationSeconds: mediaObjects.durationSeconds,
      compositeThumbnailKey: mediaObjects.compositeThumbnailKey,
      folderId: mediaObjects.folderId,
      attendees: mediaObjects.attendees,
      createdAt: mediaObjects.createdAt,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary:
        (params.includeSummary ?? true)
          ? aiOutputs.summary
          : (sql<string | null>`null` as unknown as typeof aiOutputs.summary),
      folderName: folders.name,
      // Compute readiness in SQL instead of selecting the full transcript text.
      // Selecting transcripts.fullText here pulled every transcript in the list
      // out of Postgres (large DB egress) just to derive a boolean, and it was
      // discarded entirely for video rows. See egress audit 2026-06-05.
      transcriptReady: sql<boolean>`(${transcripts.fullText} is not null and length(btrim(${transcripts.fullText})) > 0)`,
    })
    .from(mediaObjects)
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .leftJoin(folders, eq(folders.id, mediaObjects.folderId))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .where(and(...conditions))
    .orderBy(desc(mediaObjects.createdAt))
    .limit(params.limit);

  const audioIds = rows.filter((row) => row.type === "audio").map((row) => row.id);
  const attachments =
    audioIds.length > 0
      ? await listImageAttachmentsForMediaIds(audioIds, params.ownerId)
      : new Map();
  const attendeeMap = await attendeesForRows(params.ownerId, rows);

  return Promise.all(
    rows.map(async (row) => {
      let thumbnailUrl: string | null = null;
      if (row.type === "audio") {
        const firstImage = attachments.get(row.id)?.[0];
        if (firstImage) thumbnailUrl = await presignGet(firstImage.r2Key);
      } else if (row.compositeThumbnailKey) {
        thumbnailUrl = await presignGet(row.compositeThumbnailKey);
      }

      return {
        id: row.id,
        slug: row.slug,
        type: row.type,
        title: titleFor(row),
        summary: row.aiSummary,
        durationSeconds:
          row.durationSeconds == null ? null : Number(row.durationSeconds),
        status: row.status,
        createdAt: row.createdAt,
        shareUrl: mediaShareUrl(row),
        thumbnailUrl,
        transcriptReady: row.type === "audio" ? row.transcriptReady : null,
        folderId: row.folderId,
        folderName: row.folderName,
        attendees: attendeeMap.get(row.id) ?? [],
      };
    })
  );
}

export async function recentRecordings(params: {
  ownerId: string;
  limit: number;
  daysBack?: number;
}): Promise<RecentMediaItem[]> {
  return recentMediaItems({ ...params, type: "video" });
}

export async function getMediaById(params: {
  ownerId: string;
  idOrSlug: string;
  // word_timestamps is a large jsonb blob (often bigger than the transcript
  // itself) only the interactive web player needs. Callers that just want the
  // text (e.g. the MCP get_media tool) pass false to skip reading it from
  // Postgres and avoid the egress. Defaults true so the web viewer is unchanged.
  includeWordTimestamps?: boolean;
}): Promise<MediaDetails | null> {
  const includeWordTimestamps = params.includeWordTimestamps ?? true;
  const mediaWhere = UUID_RE.test(params.idOrSlug)
    ? or(eq(mediaObjects.id, params.idOrSlug), eq(mediaObjects.slug, params.idOrSlug))
    : eq(mediaObjects.slug, params.idOrSlug);

  // Select transcript columns explicitly so the lite path can swap the heavy
  // word_timestamps column for an empty jsonb literal (never read from disk),
  // while keeping the same result shape as typeof transcripts.$inferSelect.
  const transcriptColumns = getTableColumns(transcripts);
  // search_tsv columns are transcript-sized tsvectors only ever consulted in
  // SQL WHERE clauses — no caller reads them. Null them out of every select.
  const transcriptBase = {
    ...transcriptColumns,
    searchTsv: sql<string | null>`null` as unknown as typeof transcriptColumns.searchTsv,
  };
  const transcriptSelection = includeWordTimestamps
    ? transcriptBase
    : {
        ...transcriptBase,
        // Empty literal, computed in SQL, so the real column bytes never leave
        // Postgres. Cast to the column type to preserve the result row shape.
        wordTimestamps: sql<unknown>`'[]'::jsonb` as unknown as typeof transcriptColumns.wordTimestamps,
      };
  const mediaColumns = getTableColumns(mediaObjects);
  const aiColumns = getTableColumns(aiOutputs);

  const [row] = await db
    .select({
      media: {
        ...mediaColumns,
        searchTsv: sql<string | null>`null` as unknown as typeof mediaColumns.searchTsv,
      },
      folder: folders,
      note: notes,
      transcript: transcriptSelection,
      aiOutput: {
        ...aiColumns,
        searchTsv: sql<string | null>`null` as unknown as typeof aiColumns.searchTsv,
      },
    })
    .from(mediaObjects)
    .leftJoin(folders, eq(folders.id, mediaObjects.folderId))
    .leftJoin(notes, eq(notes.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(
      and(
        mediaWhere,
        eq(mediaObjects.ownerId, params.ownerId),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);

  if (!row) return null;

  const [commentRows, attendeeMap, assignmentRows] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(eq(comments.mediaObjectId, row.media.id))
      .orderBy(comments.createdAt),
    attendeesForRows(params.ownerId, [
      { id: row.media.id, attendees: row.media.attendees },
    ]),
    db
      .select({
        speakerIdx: speakerAssignments.speakerIdx,
        personId: speakerAssignments.personId,
        displayName: people.displayName,
        displayLabelOverride: speakerAssignments.displayLabelOverride,
        isSuggestion: speakerAssignments.isSuggestion,
      })
      .from(speakerAssignments)
      .leftJoin(people, eq(people.id, speakerAssignments.personId))
      .where(eq(speakerAssignments.mediaObjectId, row.media.id))
      .orderBy(speakerAssignments.speakerIdx),
  ]);

  return {
    media: row.media,
    title: titleFor({
      title: row.media.title,
      aiTitle: row.aiOutput?.titleSuggested ?? null,
    }),
    summary: row.aiOutput?.summary ?? null,
    shareUrl: mediaShareUrl(row.media),
    folder: row.folder,
    note: row.note,
    transcript: row.transcript,
    aiOutput: row.aiOutput,
    comments: commentRows,
    attendees: attendeeMap.get(row.media.id) ?? [],
    speakerAssignments: assignmentRows,
  };
}

export async function searchMedia(_params: {
  ownerId: string;
  query: string;
  limit: number;
  type: MediaTypeFilter;
  since?: string;
  embedding?: number[];
}): Promise<{ results: SearchMediaResult[]; totalCandidates: number }> {
  if (!_params.embedding) {
    throw new Error("search_embedding_required");
  }

  const vector = `[${_params.embedding.join(",")}]`;
  const conditions = [
    eq(mediaObjects.ownerId, _params.ownerId),
    isNull(mediaObjects.deletedAt),
  ];
  if (_params.type !== "any") conditions.push(eq(mediaObjects.type, _params.type));
  if (_params.since) conditions.push(gte(mediaObjects.createdAt, new Date(_params.since)));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mediaObjects)
    .innerJoin(
      summaryEmbeddings,
      eq(summaryEmbeddings.mediaObjectId, mediaObjects.id)
    )
    .where(and(...conditions));

  const rows = await db
    .select({
      id: mediaObjects.id,
      slug: mediaObjects.slug,
      type: mediaObjects.type,
      title: mediaObjects.title,
      aiTitle: aiOutputs.titleSuggested,
      summary: aiOutputs.summary,
      createdAt: mediaObjects.createdAt,
      similarity: sql<number>`1 - (${summaryEmbeddings.embedding} <=> ${vector}::vector)`,
    })
    .from(mediaObjects)
    .innerJoin(
      summaryEmbeddings,
      eq(summaryEmbeddings.mediaObjectId, mediaObjects.id)
    )
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(and(...conditions))
    .orderBy(sql`${summaryEmbeddings.embedding} <=> ${vector}::vector`)
    .limit(_params.limit);

  return {
    results: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      type: row.type,
      title: titleFor(row),
      summary: row.summary,
      createdAt: row.createdAt,
      similarity: Number(row.similarity),
      shareUrl: mediaShareUrl(row),
    })),
    totalCandidates: count ?? 0,
  };
}
