import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { isPermutation, orderVersions, versionPosition } from "@/lib/review/versions";

/**
 * Version stacks (Stage 25). A stack is every recording of one owner with
 * the same version_group_id, which starts as the id of the recording the
 * stack was built on. version_number orders the stack; what people see is
 * the position among live (not trashed) versions.
 */

export type StackVersion = {
  id: string;
  slug: string;
  title: string | null;
  status: (typeof mediaObjects.$inferSelect)["status"];
  versionNumber: number | null;
  createdAt: Date;
  /** 1-based position among the live versions. */
  number: number;
};

// --- SQL fragments for list queries ----------------------------------------
// Inside a subquery aliased `v`, the bare "media_objects" reference resolves
// to the outer row.

/** How many live versions the row's stack holds (1 when not stacked). */
export const versionCountSql = sql<number>`(case when ${mediaObjects.versionGroupId} is null then 1 else (
  select count(*)::int from media_objects v
  where v.version_group_id = ${mediaObjects.versionGroupId}
    and v.owner_id = ${mediaObjects.ownerId}
    and v.deleted_at is null
) end)`;

/** The row's 1-based position among its stack's live versions. */
export const versionPositionSql = sql<number>`(case when ${mediaObjects.versionGroupId} is null then 1 else (
  select count(*)::int from media_objects v
  where v.version_group_id = ${mediaObjects.versionGroupId}
    and v.owner_id = ${mediaObjects.ownerId}
    and v.deleted_at is null
    and (v.version_number < ${mediaObjects.versionNumber}
      or (v.version_number = ${mediaObjects.versionNumber} and v.id = ${mediaObjects.id}))
) end)`;

/** Hides every version but the latest live one of its stack. */
export const latestVersionOnlySql = sql`(${mediaObjects.versionGroupId} is null or not exists (
  select 1 from media_objects v
  where v.version_group_id = ${mediaObjects.versionGroupId}
    and v.owner_id = ${mediaObjects.ownerId}
    and v.deleted_at is null
    and v.version_number > ${mediaObjects.versionNumber}
))`;

// --- reads -------------------------------------------------------------------

/** Live versions of the stack `rec` belongs to, ordered and numbered. A
 *  recording outside any stack is returned as a stack of one. */
export async function listStack(rec: {
  id: string;
  ownerId: string;
  versionGroupId: string | null;
}): Promise<StackVersion[]> {
  const where = rec.versionGroupId
    ? and(
        eq(mediaObjects.versionGroupId, rec.versionGroupId),
        eq(mediaObjects.ownerId, rec.ownerId),
        isNull(mediaObjects.deletedAt)
      )
    : and(eq(mediaObjects.id, rec.id), isNull(mediaObjects.deletedAt));
  const rows = await db
    .select({
      id: mediaObjects.id,
      slug: mediaObjects.slug,
      title: mediaObjects.title,
      status: mediaObjects.status,
      versionNumber: mediaObjects.versionNumber,
      createdAt: mediaObjects.createdAt,
    })
    .from(mediaObjects)
    .where(where);
  const ordered = orderVersions(rows);
  return ordered.map((r) => ({ ...r, number: versionPosition(ordered, r.id) }));
}

export async function listStackForOwner(ownerId: string, recordingId: string) {
  const [rec] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      versionGroupId: mediaObjects.versionGroupId,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, recordingId),
        eq(mediaObjects.ownerId, ownerId),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);
  if (!rec) return null;
  return { groupId: rec.versionGroupId, versions: await listStack(rec) };
}

// --- writes ------------------------------------------------------------------

export type StackError =
  | "not_found"
  | "not_video"
  | "same_recording"
  | "already_stacked";

/**
 * Add `newId` as the next version of `baseId`'s stack (starting the stack if
 * `baseId` has none). The new version takes the stack's password so one
 * unlock covers every version. Rows are locked so two concurrent adds can't
 * pick the same number.
 */
export async function addToStack(params: {
  ownerId: string;
  baseId: string;
  newId: string;
}): Promise<{ ok: true; groupId: string; number: number } | { ok: false; error: StackError }> {
  if (params.baseId === params.newId) return { ok: false, error: "same_recording" };
  return db.transaction(async (tx) => {
    const lockRow = async (id: string) => {
      const [row] = await tx
        .select({
          id: mediaObjects.id,
          type: mediaObjects.type,
          versionGroupId: mediaObjects.versionGroupId,
          passwordHash: mediaObjects.passwordHash,
        })
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.id, id),
            eq(mediaObjects.ownerId, params.ownerId),
            isNull(mediaObjects.deletedAt)
          )
        )
        .for("update")
        .limit(1);
      return row ?? null;
    };
    // Lock in id order so two opposite adds can't deadlock.
    const [firstId, secondId] = [params.baseId, params.newId].sort();
    const first = await lockRow(firstId);
    const second = await lockRow(secondId);
    const base = firstId === params.baseId ? first : second;
    const added = firstId === params.newId ? first : second;
    if (!base || !added) return { ok: false as const, error: "not_found" as const };
    if (base.type !== "video" || added.type !== "video") {
      return { ok: false as const, error: "not_video" as const };
    }
    if (added.versionGroupId) return { ok: false as const, error: "already_stacked" as const };

    const groupId = base.versionGroupId ?? base.id;
    if (!base.versionGroupId) {
      await tx
        .update(mediaObjects)
        .set({ versionGroupId: groupId, versionNumber: 1 })
        .where(eq(mediaObjects.id, base.id));
    }
    // Serialise numbering per stack (trashed rows still hold their numbers,
    // so the max covers them too).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${groupId}))`);
    const [{ max }] = await tx
      .select({ max: sql<number | null>`max(${mediaObjects.versionNumber})` })
      .from(mediaObjects)
      .where(eq(mediaObjects.versionGroupId, groupId));
    const versionNumber = (max ?? 0) + 1;
    await tx
      .update(mediaObjects)
      .set({
        versionGroupId: groupId,
        versionNumber,
        passwordHash: base.passwordHash,
        updatedAt: sql`now()`,
      })
      .where(eq(mediaObjects.id, added.id));

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mediaObjects)
      .where(and(eq(mediaObjects.versionGroupId, groupId), isNull(mediaObjects.deletedAt)));
    return { ok: true as const, groupId, number: count };
  });
}

/**
 * Take one recording out of its stack (it becomes standalone; nothing is
 * deleted). A stack left with one member dissolves. If the removed row's
 * id was the stack key, the stack is re-keyed to its new first version, so
 * the removed row can later start a stack of its own without merging back.
 */
export async function removeFromStack(params: {
  ownerId: string;
  id: string;
}): Promise<{ ok: true; wasStacked: boolean } | { ok: false; error: "not_found" }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: mediaObjects.id, versionGroupId: mediaObjects.versionGroupId })
      .from(mediaObjects)
      .where(and(eq(mediaObjects.id, params.id), eq(mediaObjects.ownerId, params.ownerId)))
      .for("update")
      .limit(1);
    if (!row) return { ok: false as const, error: "not_found" as const };
    if (!row.versionGroupId) return { ok: true as const, wasStacked: false };
    const groupId = row.versionGroupId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${groupId}))`);

    await tx
      .update(mediaObjects)
      .set({ versionGroupId: null, versionNumber: null, updatedAt: sql`now()` })
      .where(eq(mediaObjects.id, row.id));

    const rest = await tx
      .select({
        id: mediaObjects.id,
        versionNumber: mediaObjects.versionNumber,
        createdAt: mediaObjects.createdAt,
        deletedAt: mediaObjects.deletedAt,
      })
      .from(mediaObjects)
      .where(and(eq(mediaObjects.versionGroupId, groupId), ne(mediaObjects.id, row.id)));
    const live = rest.filter((r) => !r.deletedAt);
    if (live.length <= 1) {
      // Nothing left to compare: every remaining row (trashed ones too)
      // goes back to standalone.
      await tx
        .update(mediaObjects)
        .set({ versionGroupId: null, versionNumber: null })
        .where(eq(mediaObjects.versionGroupId, groupId));
    } else if (groupId === row.id) {
      const newKey = orderVersions(live)[0].id;
      await tx
        .update(mediaObjects)
        .set({ versionGroupId: newKey })
        .where(eq(mediaObjects.versionGroupId, groupId));
    }
    return { ok: true as const, wasStacked: true };
  });
}

/**
 * Reorder a stack. `orderedIds` must be exactly the live versions. Trashed
 * versions keep their relative order after them. Done in two passes inside
 * one transaction because (group, number) is unique.
 */
export async function setStackOrder(params: {
  ownerId: string;
  recordingId: string;
  orderedIds: string[];
}): Promise<{ ok: true } | { ok: false; error: "not_found" | "not_stacked" | "bad_order" }> {
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .select({ versionGroupId: mediaObjects.versionGroupId })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.id, params.recordingId),
          eq(mediaObjects.ownerId, params.ownerId),
          isNull(mediaObjects.deletedAt)
        )
      )
      .limit(1);
    if (!rec) return { ok: false as const, error: "not_found" as const };
    if (!rec.versionGroupId) return { ok: false as const, error: "not_stacked" as const };
    const groupId = rec.versionGroupId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${groupId}))`);

    const rows = await tx
      .select({
        id: mediaObjects.id,
        versionNumber: mediaObjects.versionNumber,
        createdAt: mediaObjects.createdAt,
        deletedAt: mediaObjects.deletedAt,
      })
      .from(mediaObjects)
      .where(and(eq(mediaObjects.versionGroupId, groupId), eq(mediaObjects.ownerId, params.ownerId)))
      .for("update");
    const live = rows.filter((r) => !r.deletedAt).map((r) => r.id);
    if (!isPermutation(live, params.orderedIds)) {
      return { ok: false as const, error: "bad_order" as const };
    }
    const trashed = orderVersions(rows.filter((r) => r.deletedAt)).map((r) => r.id);
    const finalOrder = [...params.orderedIds, ...trashed];

    await tx
      .update(mediaObjects)
      .set({ versionNumber: sql`-1 * coalesce(${mediaObjects.versionNumber}, 0) - 1000000` })
      .where(eq(mediaObjects.versionGroupId, groupId));
    for (const [i, id] of finalOrder.entries()) {
      await tx
        .update(mediaObjects)
        .set({ versionNumber: i + 1 })
        .where(eq(mediaObjects.id, id));
    }
    return { ok: true as const };
  });
}

/** Ids of every recording in the stack (trashed included), for keeping the
 *  password in step across versions. */
export async function stackMemberIds(ownerId: string, recordingId: string): Promise<string[]> {
  const [rec] = await db
    .select({ versionGroupId: mediaObjects.versionGroupId })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, recordingId), eq(mediaObjects.ownerId, ownerId)))
    .limit(1);
  if (!rec) return [];
  if (!rec.versionGroupId) return [recordingId];
  const rows = await db
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.versionGroupId, rec.versionGroupId), eq(mediaObjects.ownerId, ownerId)));
  return rows.map((r) => r.id);
}

/** Slugs of the other live versions that share this password, for "one
 *  unlock covers the whole stack". */
export async function stackSlugsSharingPassword(rec: {
  id: string;
  ownerId: string;
  versionGroupId: string | null;
  passwordHash: string | null;
}): Promise<string[]> {
  if (!rec.versionGroupId || !rec.passwordHash) return [];
  const rows = await db
    .select({ slug: mediaObjects.slug })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.versionGroupId, rec.versionGroupId),
        eq(mediaObjects.ownerId, rec.ownerId),
        eq(mediaObjects.passwordHash, rec.passwordHash),
        ne(mediaObjects.id, rec.id),
        isNull(mediaObjects.deletedAt)
      )
    );
  return rows.map((r) => r.slug);
}

/** The owner's standalone, ready videos that could join a stack (newest
 *  first), for the edit page's "Add existing recording" picker. */
export async function listStackCandidates(ownerId: string, excludeId: string, limit = 50) {
  return db
    .select({ id: mediaObjects.id, slug: mediaObjects.slug, title: mediaObjects.title, createdAt: mediaObjects.createdAt })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.ownerId, ownerId),
        eq(mediaObjects.type, "video"),
        isNull(mediaObjects.deletedAt),
        isNull(mediaObjects.versionGroupId),
        ne(mediaObjects.id, excludeId)
      )
    )
    .orderBy(sql`${mediaObjects.createdAt} desc`)
    .limit(limit);
}
