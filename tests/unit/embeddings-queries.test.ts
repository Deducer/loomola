import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  mediaObjects,
  summaryEmbeddings,
  transcriptChunks,
} from "@/db/schema";
import {
  replaceTranscriptChunkEmbeddings,
  upsertSummaryEmbedding,
} from "@/db/queries/embeddings";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const TEST_SLUG_PREFIX = "granola-test-embeddings-";
let ownerId = "";

async function findTestOwnerId() {
  const email = process.env.TEST_CREATOR_EMAIL ?? "test-owner@example.com";
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM auth.users WHERE email = ${email} LIMIT 1`
  );
  if (!rows[0]) throw new Error(`No auth.users row found for ${email}`);
  return rows[0].id;
}

async function createMedia() {
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

function vector(seed: number) {
  return Array.from({ length: 1536 }, (_, index) => (index === seed ? 1 : 0));
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  ownerId = await findTestOwnerId();
});

afterEach(async () => {
  if (!ownerId) return;
  await db
    .delete(mediaObjects)
    .where(
      and(
        eq(mediaObjects.ownerId, ownerId),
        like(mediaObjects.slug, `${TEST_SLUG_PREFIX}%`)
      )
    );
});

describeDb("embedding queries", () => {
  it("replaceTranscriptChunkEmbeddings replaces existing chunks", async () => {
    const media = await createMedia();

    await replaceTranscriptChunkEmbeddings(media.id, [
      {
        chunkIdx: 0,
        text: "first",
        startMs: 0,
        endMs: 1000,
        embedding: vector(0),
        modelVersion: "openai/text-embedding-3-small",
      },
    ]);
    await replaceTranscriptChunkEmbeddings(media.id, [
      {
        chunkIdx: 0,
        text: "second",
        startMs: 500,
        endMs: 1500,
        embedding: vector(1),
        modelVersion: "openai/text-embedding-3-small",
      },
      {
        chunkIdx: 1,
        text: "third",
        startMs: 1500,
        endMs: 2500,
        embedding: vector(2),
        modelVersion: "openai/text-embedding-3-small",
      },
    ]);

    const rows = await db
      .select({
        chunkIdx: transcriptChunks.chunkIdx,
        text: transcriptChunks.text,
        startMs: transcriptChunks.startMs,
        endMs: transcriptChunks.endMs,
      })
      .from(transcriptChunks)
      .where(eq(transcriptChunks.mediaObjectId, media.id))
      .orderBy(transcriptChunks.chunkIdx);

    expect(rows).toEqual([
      { chunkIdx: 0, text: "second", startMs: 500, endMs: 1500 },
      { chunkIdx: 1, text: "third", startMs: 1500, endMs: 2500 },
    ]);
  });

  it("upsertSummaryEmbedding stores one row per media object", async () => {
    const media = await createMedia();

    await upsertSummaryEmbedding({
      mediaObjectId: media.id,
      embedding: vector(0),
      modelVersion: "openai/text-embedding-3-small",
    });
    await upsertSummaryEmbedding({
      mediaObjectId: media.id,
      embedding: vector(1),
      modelVersion: "openai/text-embedding-3-small",
    });

    const rows = await db
      .select({ id: summaryEmbeddings.id })
      .from(summaryEmbeddings)
      .where(eq(summaryEmbeddings.mediaObjectId, media.id));

    expect(rows.length).toBe(1);
  });
});
