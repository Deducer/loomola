import { db } from "@/db";
import {
  aiOutputs,
  brandProfiles,
  mediaObjects,
  notes,
  transcripts,
} from "@/db/schema";
import { and, desc, eq, gte, isNull, type SQL } from "drizzle-orm";

export type ExportBundleMediaData = {
  media: typeof mediaObjects.$inferSelect;
  brandProfile: typeof brandProfiles.$inferSelect | null;
  note: typeof notes.$inferSelect | null;
  transcript: typeof transcripts.$inferSelect | null;
  aiOutput: typeof aiOutputs.$inferSelect | null;
};

export async function listExportBundleMedia(params: {
  ownerId?: string;
  type?: "audio" | "video";
  since?: Date;
  folderId?: string;
}): Promise<ExportBundleMediaData[]> {
  const conditions: SQL[] = [isNull(mediaObjects.deletedAt)];
  if (params.ownerId) conditions.push(eq(mediaObjects.ownerId, params.ownerId));
  if (params.type) conditions.push(eq(mediaObjects.type, params.type));
  if (params.since) conditions.push(gte(mediaObjects.createdAt, params.since));
  if (params.folderId) conditions.push(eq(mediaObjects.folderId, params.folderId));

  return db
    .select({
      media: mediaObjects,
      brandProfile: brandProfiles,
      note: notes,
      transcript: transcripts,
      aiOutput: aiOutputs,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(notes, eq(notes.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(and(...conditions))
    .orderBy(desc(mediaObjects.createdAt));
}
