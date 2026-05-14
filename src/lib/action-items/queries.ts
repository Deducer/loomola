import { db } from "@/db";
import { aiOutputs, folders, mediaObjects, people } from "@/db/schema";
import { mediaShareUrl } from "@/lib/recordings/queries";
import { and, desc, eq, gte, ilike, isNull, sql } from "drizzle-orm";

export type ActionItemStatus = "open" | "done" | "any";

export type LoomolaActionItem = {
  id: string;
  text: string;
  status: "open";
  timestampSec: number | null;
  mediaId: string;
  mediaSlug: string;
  mediaTitle: string;
  mediaShareUrl: string;
  mediaType: "video" | "audio";
  attributedTo: string | null;
  folderName: string | null;
  createdAt: Date;
};

type RawActionItem = {
  text?: unknown;
  timestamp_sec?: unknown;
};

function sinceDate(daysBack: number): Date {
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
}

function parseActionItems(value: unknown): RawActionItem[] {
  return Array.isArray(value) ? (value as RawActionItem[]) : [];
}

function parseAttendeeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function matchingPersonIds(ownerId: string, person?: string): Promise<Set<string> | null> {
  const q = person?.trim();
  if (!q) return null;
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.ownerId, ownerId), ilike(people.displayName, `%${q}%`)));
  return new Set(rows.map((row) => row.id));
}

export async function openActionItems(params: {
  ownerId: string;
  status?: ActionItemStatus;
  person?: string;
  folder?: string;
  daysBack: number;
  limit: number;
}): Promise<LoomolaActionItem[]> {
  const status = params.status ?? "open";
  if (status === "done") return [];

  const conditions = [
    eq(mediaObjects.ownerId, params.ownerId),
    isNull(mediaObjects.deletedAt),
    gte(mediaObjects.createdAt, sinceDate(params.daysBack)),
    sql`${aiOutputs.actionItems} IS NOT NULL`,
  ];
  const folderQuery = params.folder?.trim();
  if (folderQuery) conditions.push(ilike(folders.name, `%${folderQuery}%`));

  const rows = await db
    .select({
      mediaId: mediaObjects.id,
      mediaSlug: mediaObjects.slug,
      mediaType: mediaObjects.type,
      mediaTitle: mediaObjects.title,
      attendees: mediaObjects.attendees,
      createdAt: mediaObjects.createdAt,
      aiTitle: aiOutputs.titleSuggested,
      actionItems: aiOutputs.actionItems,
      folderName: folders.name,
    })
    .from(aiOutputs)
    .innerJoin(mediaObjects, eq(mediaObjects.id, aiOutputs.mediaObjectId))
    .leftJoin(folders, eq(folders.id, mediaObjects.folderId))
    .where(and(...conditions))
    .orderBy(desc(mediaObjects.createdAt))
    .limit(Math.max(params.limit, 1));

  const personIds = await matchingPersonIds(params.ownerId, params.person);
  const items: LoomolaActionItem[] = [];

  for (const row of rows) {
    const attendeeIds = parseAttendeeIds(row.attendees);
    if (personIds && !attendeeIds.some((id) => personIds.has(id))) continue;

    for (const [index, item] of parseActionItems(row.actionItems).entries()) {
      if (typeof item.text !== "string" || item.text.trim().length === 0) {
        continue;
      }
      items.push({
        id: `${row.mediaId}:${index}`,
        text: item.text,
        status: "open",
        timestampSec:
          typeof item.timestamp_sec === "number" ? item.timestamp_sec : null,
        mediaId: row.mediaId,
        mediaSlug: row.mediaSlug,
        mediaTitle: row.mediaTitle ?? row.aiTitle ?? "Untitled",
        mediaShareUrl: mediaShareUrl({ type: row.mediaType, slug: row.mediaSlug }),
        mediaType: row.mediaType,
        attributedTo: null,
        folderName: row.folderName,
        createdAt: row.createdAt,
      });
      if (items.length >= params.limit) return items;
    }
  }

  return items;
}

export async function actionItemsByPerson(params: {
  ownerId: string;
  person: string;
  daysBack: number;
  limit: number;
}): Promise<LoomolaActionItem[]> {
  return openActionItems({ ...params, status: "open" });
}
