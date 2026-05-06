import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  folders,
  mediaFolderAssignments,
  mediaObjects,
} from "@/db/schema";
import {
  addRecordingToFolder,
  createFolder,
  listFolderAssignmentsForRecordings,
  listFoldersForRecording,
  moveRecordingToFolder,
  removeRecordingFromFolder,
} from "@/db/queries/folders";

/**
 * Phase-1 multi-folder migration coverage. Locks:
 *
 * - dual-write: moveRecordingToFolder updates both
 *   media_objects.folder_id AND media_folder_assignments.
 * - idempotency: addRecordingToFolder is safe to call twice.
 * - clearing: removeRecordingFromFolder is idempotent on miss.
 * - bulk lookup: listFolderAssignmentsForRecordings returns one map
 *   entry per (recordingId → folders[]).
 *
 * Skipped without a DATABASE_URL — same gating as the rest of the
 * `tests/unit/*-queries.test.ts` files.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const TEST_SLUG_PREFIX = "folder-assignments-test-";
const TEST_FOLDER_PREFIX = "folder-assignments-test-folder-";
let OWNER_A = "";
const createdMediaIds: string[] = [];
const createdFolderIds: string[] = [];

async function findTestOwnerId() {
  const email = process.env.TEST_CREATOR_EMAIL ?? "theiancross@gmail.com";
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
  createdMediaIds.push(media.id);
  return media;
}

async function createTestFolder(ownerId: string, name?: string) {
  const folder = await createFolder({
    ownerId,
    name: name ?? `${TEST_FOLDER_PREFIX}${randomUUID().slice(0, 8)}`,
    parentId: null,
  });
  createdFolderIds.push(folder.id);
  return folder;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  OWNER_A = await findTestOwnerId();
});

afterEach(async () => {
  if (!OWNER_A) return;
  if (createdMediaIds.length > 0) {
    await db
      .delete(mediaObjects)
      .where(inArray(mediaObjects.id, createdMediaIds));
    createdMediaIds.length = 0;
  }
  if (createdFolderIds.length > 0) {
    await db
      .delete(folders)
      .where(inArray(folders.id, createdFolderIds));
    createdFolderIds.length = 0;
  }
  // Belt-and-suspenders cleanup of any leaked rows by slug pattern.
  await db
    .delete(mediaObjects)
    .where(
      and(
        eq(mediaObjects.ownerId, OWNER_A),
        like(mediaObjects.slug, `${TEST_SLUG_PREFIX}%`)
      )
    );
  await db
    .delete(folders)
    .where(
      and(
        eq(folders.ownerId, OWNER_A),
        like(folders.name, `${TEST_FOLDER_PREFIX}%`)
      )
    );
});

describeDb("media_folder_assignments — phase 1 dual-write", () => {
  it("moveRecordingToFolder dual-writes legacy column AND join table", async () => {
    const media = await createMedia(OWNER_A);
    const folder = await createTestFolder(OWNER_A);

    const ok = await moveRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folder.id,
    });
    expect(ok).toBe(true);

    // Legacy column updated.
    const [m] = await db
      .select({ folderId: mediaObjects.folderId })
      .from(mediaObjects)
      .where(eq(mediaObjects.id, media.id))
      .limit(1);
    expect(m.folderId).toBe(folder.id);

    // Join table got the row too.
    const assignments = await db
      .select()
      .from(mediaFolderAssignments)
      .where(eq(mediaFolderAssignments.mediaObjectId, media.id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].folderId).toBe(folder.id);
    expect(assignments[0].ownerId).toBe(OWNER_A);
  });

  it("moveRecordingToFolder with null wipes both legacy AND join table", async () => {
    const media = await createMedia(OWNER_A);
    const folder = await createTestFolder(OWNER_A);
    await moveRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folder.id,
    });

    const ok = await moveRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: null,
    });
    expect(ok).toBe(true);

    const [m] = await db
      .select({ folderId: mediaObjects.folderId })
      .from(mediaObjects)
      .where(eq(mediaObjects.id, media.id))
      .limit(1);
    expect(m.folderId).toBeNull();

    const assignments = await db
      .select()
      .from(mediaFolderAssignments)
      .where(eq(mediaFolderAssignments.mediaObjectId, media.id));
    expect(assignments).toHaveLength(0);
  });

  it("moveRecordingToFolder replaces existing assignments (single-folder semantics)", async () => {
    const media = await createMedia(OWNER_A);
    const folderA = await createTestFolder(OWNER_A);
    const folderB = await createTestFolder(OWNER_A);

    await moveRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folderA.id,
    });
    // First add via the multi-folder primitive too, to simulate a
    // mixed-state record from a future Phase-2 read flip.
    await addRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folderB.id,
    });

    let assignments = await db
      .select()
      .from(mediaFolderAssignments)
      .where(eq(mediaFolderAssignments.mediaObjectId, media.id));
    expect(assignments).toHaveLength(2);

    // Move replaces — both pre-existing assignments wiped, new one added.
    await moveRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folderA.id,
    });
    assignments = await db
      .select()
      .from(mediaFolderAssignments)
      .where(eq(mediaFolderAssignments.mediaObjectId, media.id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].folderId).toBe(folderA.id);
  });

  it("addRecordingToFolder is idempotent on re-add", async () => {
    const media = await createMedia(OWNER_A);
    const folder = await createTestFolder(OWNER_A);

    expect(
      await addRecordingToFolder({
        recordingId: media.id,
        ownerId: OWNER_A,
        folderId: folder.id,
      })
    ).toBe(true);
    // Re-add: still true, no duplicate row.
    expect(
      await addRecordingToFolder({
        recordingId: media.id,
        ownerId: OWNER_A,
        folderId: folder.id,
      })
    ).toBe(true);

    const assignments = await db
      .select()
      .from(mediaFolderAssignments)
      .where(eq(mediaFolderAssignments.mediaObjectId, media.id));
    expect(assignments).toHaveLength(1);
  });

  it("addRecordingToFolder rejects unknown recording id", async () => {
    const folder = await createTestFolder(OWNER_A);
    const ok = await addRecordingToFolder({
      recordingId: randomUUID(),
      ownerId: OWNER_A,
      folderId: folder.id,
    });
    expect(ok).toBe(false);
  });

  it("removeRecordingFromFolder is idempotent on missing assignment", async () => {
    const media = await createMedia(OWNER_A);
    const folder = await createTestFolder(OWNER_A);

    // Never assigned. Remove should still return true (idempotent).
    const ok = await removeRecordingFromFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folder.id,
    });
    expect(ok).toBe(true);
  });

  it("removeRecordingFromFolder removes only the named assignment, leaving others", async () => {
    const media = await createMedia(OWNER_A);
    const folderA = await createTestFolder(OWNER_A);
    const folderB = await createTestFolder(OWNER_A);
    await addRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folderA.id,
    });
    await addRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folderB.id,
    });

    await removeRecordingFromFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folderA.id,
    });

    const remaining = await listFoldersForRecording({
      recordingId: media.id,
      ownerId: OWNER_A,
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(folderB.id);
  });

  it("listFoldersForRecording returns alphabetical folders for a recording", async () => {
    const media = await createMedia(OWNER_A);
    const zFolder = await createTestFolder(OWNER_A, `${TEST_FOLDER_PREFIX}zzz-${randomUUID().slice(0, 4)}`);
    const aFolder = await createTestFolder(OWNER_A, `${TEST_FOLDER_PREFIX}aaa-${randomUUID().slice(0, 4)}`);

    await addRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: zFolder.id,
    });
    await addRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: aFolder.id,
    });

    const list = await listFoldersForRecording({
      recordingId: media.id,
      ownerId: OWNER_A,
    });
    expect(list.map((f) => f.id)).toEqual([aFolder.id, zFolder.id]);
  });

  it("listFolderAssignmentsForRecordings batches lookups in one round trip", async () => {
    const m1 = await createMedia(OWNER_A);
    const m2 = await createMedia(OWNER_A);
    const m3UnfiledIntentionally = await createMedia(OWNER_A);
    const f1 = await createTestFolder(OWNER_A);
    const f2 = await createTestFolder(OWNER_A);

    await addRecordingToFolder({ recordingId: m1.id, ownerId: OWNER_A, folderId: f1.id });
    await addRecordingToFolder({ recordingId: m1.id, ownerId: OWNER_A, folderId: f2.id });
    await addRecordingToFolder({ recordingId: m2.id, ownerId: OWNER_A, folderId: f1.id });

    const map = await listFolderAssignmentsForRecordings({
      recordingIds: [m1.id, m2.id, m3UnfiledIntentionally.id],
      ownerId: OWNER_A,
    });

    expect(map.get(m1.id)?.map((f) => f.id).sort()).toEqual([f1.id, f2.id].sort());
    expect(map.get(m2.id)?.map((f) => f.id)).toEqual([f1.id]);
    // Unfiled note: not present in the map (Map.has === false).
    expect(map.has(m3UnfiledIntentionally.id)).toBe(false);
  });

  it("listFolderAssignmentsForRecordings is a no-op on empty input", async () => {
    const map = await listFolderAssignmentsForRecordings({
      recordingIds: [],
      ownerId: OWNER_A,
    });
    expect(map.size).toBe(0);
  });

  it("foreign-key cascade: deleting a folder wipes its assignments", async () => {
    const media = await createMedia(OWNER_A);
    const folder = await createTestFolder(OWNER_A);
    await addRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folder.id,
    });

    await db.delete(folders).where(eq(folders.id, folder.id));
    // Pop from cleanup list — already deleted.
    const idx = createdFolderIds.indexOf(folder.id);
    if (idx >= 0) createdFolderIds.splice(idx, 1);

    const assignments = await db
      .select()
      .from(mediaFolderAssignments)
      .where(eq(mediaFolderAssignments.mediaObjectId, media.id));
    expect(assignments).toHaveLength(0);
  });

  it("foreign-key cascade: deleting a recording wipes its assignments", async () => {
    const media = await createMedia(OWNER_A);
    const folder = await createTestFolder(OWNER_A);
    await addRecordingToFolder({
      recordingId: media.id,
      ownerId: OWNER_A,
      folderId: folder.id,
    });

    await db.delete(mediaObjects).where(eq(mediaObjects.id, media.id));
    const idx = createdMediaIds.indexOf(media.id);
    if (idx >= 0) createdMediaIds.splice(idx, 1);

    const assignments = await db
      .select()
      .from(mediaFolderAssignments)
      .where(eq(mediaFolderAssignments.folderId, folder.id));
    expect(assignments).toHaveLength(0);
  });
});
