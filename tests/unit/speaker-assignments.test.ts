import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects, people } from "@/db/schema";
import {
  deleteSpeakerAssignment,
  listSpeakerAssignments,
  upsertSpeakerAssignment,
} from "@/db/queries/speaker-assignments";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const OWNER_B = randomUUID();
const TEST_SLUG_PREFIX = "granola-test-speakers-";
let OWNER_A = "";

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

async function createMedia(ownerId: string) {
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

async function createPerson(ownerId: string, displayName: string) {
  const [person] = await db
    .insert(people)
    .values({ ownerId, displayName })
    .returning();
  return person;
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
  await db.delete(people).where(eq(people.ownerId, OWNER_A));
  await db.delete(people).where(eq(people.ownerId, OWNER_B));
});

describeDb("speaker_assignments queries", () => {
  it("upsertSpeakerAssignment links speakerIdx to a person", async () => {
    const media = await createMedia(OWNER_A);
    const person = await createPerson(OWNER_A, "Aman");
    const result = await upsertSpeakerAssignment({
      mediaObjectId: media.id,
      ownerId: OWNER_A,
      speakerIdx: 0,
      personId: person.id,
    });
    expect(result.personId).toBe(person.id);
    expect(result.displayLabelOverride).toBeNull();
  });

  it("upsertSpeakerAssignment supports a one-off display label", async () => {
    const media = await createMedia(OWNER_A);
    const result = await upsertSpeakerAssignment({
      mediaObjectId: media.id,
      ownerId: OWNER_A,
      speakerIdx: 1,
      displayLabelOverride: "Customer A",
    });
    expect(result.personId).toBeNull();
    expect(result.displayLabelOverride).toBe("Customer A");
  });

  it("upsertSpeakerAssignment overwrites the same speakerIdx", async () => {
    const media = await createMedia(OWNER_A);
    const p1 = await createPerson(OWNER_A, "Aman");
    const p2 = await createPerson(OWNER_A, "Sara");
    await upsertSpeakerAssignment({
      mediaObjectId: media.id,
      ownerId: OWNER_A,
      speakerIdx: 0,
      personId: p1.id,
    });
    await upsertSpeakerAssignment({
      mediaObjectId: media.id,
      ownerId: OWNER_A,
      speakerIdx: 0,
      personId: p2.id,
    });
    const list = await listSpeakerAssignments(media.id, OWNER_A);
    expect(list.length).toBe(1);
    expect(list[0].personId).toBe(p2.id);
  });

  it("upsertSpeakerAssignment rejects empty assignments", async () => {
    const media = await createMedia(OWNER_A);
    await expect(
      upsertSpeakerAssignment({
        mediaObjectId: media.id,
        ownerId: OWNER_A,
        speakerIdx: 0,
      })
    ).rejects.toThrow();
  });

  it("upsertSpeakerAssignment rejects owner mismatch", async () => {
    const media = await createMedia(OWNER_A);
    await expect(
      upsertSpeakerAssignment({
        mediaObjectId: media.id,
        ownerId: OWNER_B,
        speakerIdx: 0,
        displayLabelOverride: "X",
      })
    ).rejects.toThrow();
  });

  it("upsertSpeakerAssignment rejects a different owner's person", async () => {
    const media = await createMedia(OWNER_A);
    const person = await createPerson(OWNER_B, "Bob");
    await expect(
      upsertSpeakerAssignment({
        mediaObjectId: media.id,
        ownerId: OWNER_A,
        speakerIdx: 0,
        personId: person.id,
      })
    ).rejects.toThrow("person_not_found");
  });

  it("listSpeakerAssignments returns rows scoped to the meeting", async () => {
    const media = await createMedia(OWNER_A);
    const person = await createPerson(OWNER_A, "Aman");
    await upsertSpeakerAssignment({
      mediaObjectId: media.id,
      ownerId: OWNER_A,
      speakerIdx: 0,
      personId: person.id,
    });
    await upsertSpeakerAssignment({
      mediaObjectId: media.id,
      ownerId: OWNER_A,
      speakerIdx: 1,
      displayLabelOverride: "X",
    });
    const list = await listSpeakerAssignments(media.id, OWNER_A);
    expect(list.length).toBe(2);
  });

  it("deleteSpeakerAssignment removes a single media and speakerIdx pair", async () => {
    const media = await createMedia(OWNER_A);
    await upsertSpeakerAssignment({
      mediaObjectId: media.id,
      ownerId: OWNER_A,
      speakerIdx: 0,
      displayLabelOverride: "X",
    });
    const removed = await deleteSpeakerAssignment(media.id, OWNER_A, 0);
    expect(removed).toBe(true);
    const list = await listSpeakerAssignments(media.id, OWNER_A);
    expect(list.length).toBe(0);
  });
});
