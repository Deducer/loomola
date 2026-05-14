import { getMediaById, recentMediaItems, type MediaDetails } from "@/lib/recordings/queries";

export async function recentNotes(params: {
  ownerId: string;
  limit: number;
  daysBack?: number;
}) {
  return recentMediaItems({ ...params, type: "audio" });
}

export async function getNoteById(params: {
  ownerId: string;
  idOrSlug: string;
}): Promise<MediaDetails | null> {
  const details = await getMediaById(params);
  if (details?.media.type !== "audio") return null;
  return details;
}
