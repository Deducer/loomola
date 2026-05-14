import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects, notes } from "@/db/schema";
import {
  createQuickAudioNote,
  deleteNotes,
  getNotesByMediaObject,
  upsertNotesBody,
} from "@/db/queries/notes";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const OWNER_B = randomUUID();
const TEST_SLUG_PREFIX = "granola-test-notes-";
let OWNER_A = "";
let createdQuickNoteIds: string[] = [];

async function findTestOwnerId() {
  const email = process.env.TEST_CREATOR_EMAIL ?? "test-owner@example.com";
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM auth.users WHERE email = ${email} LIMIT 1`
  );
  if (!rows[0]) {
    throw new Error(`No auth.users row found for ${email}`);
  }
  return rows[0].id;
}

async function createMediaObject(ownerId: string) {
  const [media] = await db
    .insert(mediaObjects)
    .values({
      ownerId,
      type: "audio",
      slug: `${TEST_SLUG_PREFIX}${randomUUID().slice(0, 8)}`,
      status: "ready",
    })
    .returning();
  return media;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  OWNER_A = await findTestOwnerId();
});

afterEach(async () => {
  if (!OWNER_A) return;
  await db
    .delete(mediaObjects)
    .where(
      and(
        eq(mediaObjects.ownerId, OWNER_A),
        like(mediaObjects.slug, `${TEST_SLUG_PREFIX}%`)
      )
    );
  if (createdQuickNoteIds.length > 0) {
    await db
      .delete(mediaObjects)
      .where(
        and(
          eq(mediaObjects.ownerId, OWNER_A),
          inArray(mediaObjects.id, createdQuickNoteIds)
        )
      );
    createdQuickNoteIds = [];
  }
});

describeDb("notes queries", () => {
  it("createQuickAudioNote creates a ready audio note shell", async () => {
    const quickNote = await createQuickAudioNote(OWNER_A);
    createdQuickNoteIds.push(quickNote.id);

    const [media] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, quickNote.id))
      .limit(1);

    expect(media.type).toBe("audio");
    expect(media.status).toBe("ready");
    expect(media.slug).toBe(quickNote.slug);
  });

  it("upsertNotesBody creates a row when none exists", async () => {
    const media = await createMediaObject(OWNER_A);
    const result = await upsertNotesBody(media.id, OWNER_A, "Hello world");
    expect(result.body).toBe("Hello world");
    expect(result.mediaObjectId).toBe(media.id);
    expect(result.ownerId).toBe(OWNER_A);
  });

  it("upsertNotesBody updates the existing row when one exists", async () => {
    const media = await createMediaObject(OWNER_A);
    await upsertNotesBody(media.id, OWNER_A, "First");
    const result = await upsertNotesBody(media.id, OWNER_A, "Second");
    expect(result.body).toBe("Second");

    const all = await db
      .select()
      .from(notes)
      .where(eq(notes.mediaObjectId, media.id));
    expect(all.length).toBe(1);
  });

  it("getNotesByMediaObject returns null when no row exists", async () => {
    const media = await createMediaObject(OWNER_A);
    const result = await getNotesByMediaObject(media.id, OWNER_A);
    expect(result).toBeNull();
  });

  it("getNotesByMediaObject returns the row for the correct owner", async () => {
    const media = await createMediaObject(OWNER_A);
    await upsertNotesBody(media.id, OWNER_A, "Owner A notes");
    const result = await getNotesByMediaObject(media.id, OWNER_A);
    expect(result?.body).toBe("Owner A notes");
  });

  it("getNotesByMediaObject returns null for a different owner", async () => {
    const media = await createMediaObject(OWNER_A);
    await upsertNotesBody(media.id, OWNER_A, "Owner A notes");
    const result = await getNotesByMediaObject(media.id, OWNER_B);
    expect(result).toBeNull();
  });

  it("deleteNotes removes the row", async () => {
    const media = await createMediaObject(OWNER_A);
    await upsertNotesBody(media.id, OWNER_A, "to delete");
    const removed = await deleteNotes(media.id, OWNER_A);
    expect(removed).toBe(true);
    const result = await getNotesByMediaObject(media.id, OWNER_A);
    expect(result).toBeNull();
  });
});
