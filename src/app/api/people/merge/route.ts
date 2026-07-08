// POST /api/people/merge
// Body: { canonicalId: string, mergeIds: string[] }
//
// Combines N+1 `people` rows that turned out to be the same human (e.g.
// "chris@acme.com" and "chris@acme.dev" — same person, two emails).
// In one transaction:
//   1. Reassign every speaker_assignments.person_id from merged → canonical.
//   2. Replace each merged row's display name/email in
//      media_objects.attendees jsonb with the canonical row's display
//      name; deduplicate the array.
//   3. Copy merged rows' canonical+alias emails into canonical's
//      email_aliases (case-insensitive dedup, normalized to lowercase).
//   4. Carry forward `is_self` if any merged row had it.
//   5. Delete merged rows.
//
// Auth: existing Supabase session (cookie or Bearer). Owner-scoped:
// rows must all belong to the requesting user.

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects, people, speakerAssignments } from "@/db/schema";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const mergeSchema = z
  .object({
    canonicalId: z.string().uuid(),
    mergeIds: z.array(z.string().uuid()).min(1).max(20),
  })
  .refine((v) => !v.mergeIds.includes(v.canonicalId), {
    message: "canonicalId cannot also be in mergeIds",
  });

export async function POST(request: Request) {
  if (!enableGranola()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { canonicalId, mergeIds } = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // Verify ownership of all rows in one shot.
      const allIds = [canonicalId, ...mergeIds];
      const rows = await tx
        .select()
        .from(people)
        .where(and(eq(people.ownerId, user.id), inArray(people.id, allIds)));
      if (rows.length !== allIds.length) {
        return {
          status: 404 as const,
          body: { error: "not_found", message: "one or more ids not found" },
        };
      }
      const canonical = rows.find((r) => r.id === canonicalId)!;
      const merged = rows.filter((r) => r.id !== canonicalId);

      // ─── 1. Reassign speaker_assignments.person_id ───
      // The unique index on speaker_assignments is (media_object_id,
      // speaker_idx), not on person_id, so this UPDATE is always safe.
      await tx
        .update(speakerAssignments)
        .set({ personId: canonicalId })
        .where(inArray(speakerAssignments.personId, mergeIds));

      // ─── 2. Replace strings in media_objects.attendees jsonb ───
      // attendees is stored as an array of display strings (names with
      // email fallback). For each affected media_object, dedupe by
      // canonical name. We pull, mutate, write — only for rows that
      // actually contain any merged name.
      const mergedNames = merged
        .map((r) => r.displayName)
        .filter((n): n is string => Boolean(n));
      if (mergedNames.length > 0) {
        // Build OR clauses for each name (jsonb @> jsonb_build_array).
        const conditions = mergedNames.map(
          (n) => sql`${mediaObjects.attendees} @> ${JSON.stringify([n])}::jsonb`
        );
        const orClause =
          conditions.length === 1
            ? conditions[0]
            : sql.join(conditions, sql` OR `);
        const affected = await tx
          .select({ id: mediaObjects.id, attendees: mediaObjects.attendees })
          .from(mediaObjects)
          .where(and(eq(mediaObjects.ownerId, user.id), orClause!));
        for (const m of affected) {
          const arr = Array.isArray(m.attendees)
            ? (m.attendees as unknown[]).filter(
                (x): x is string => typeof x === "string"
              )
            : [];
          // Replace each merged name with canonical, then dedupe.
          const replaced = arr.map((s) =>
            mergedNames.includes(s) ? canonical.displayName : s
          );
          const seen = new Set<string>();
          const dedup: string[] = [];
          for (const s of replaced) {
            const k = s.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            dedup.push(s);
          }
          await tx
            .update(mediaObjects)
            .set({ attendees: dedup })
            .where(eq(mediaObjects.id, m.id));
        }
      }

      // ─── 3. Email aliases — fold every merged email into canonical's ───
      const canonicalAliasesIn = Array.isArray(canonical.emailAliases)
        ? (canonical.emailAliases as unknown[]).filter(
            (x): x is string => typeof x === "string"
          )
        : [];
      // Track all known emails in lowercase to dedupe; preserve original
      // casing in the output.
      const canonicalLower = canonical.email?.toLowerCase() ?? "";
      const seenLower = new Set<string>(
        canonicalLower ? [canonicalLower] : []
      );
      const aliasesOut: string[] = [];
      const pushIfNew = (raw: string | null | undefined) => {
        if (!raw) return;
        const trimmed = raw.trim();
        if (!trimmed) return;
        const lower = trimmed.toLowerCase();
        if (seenLower.has(lower)) return;
        seenLower.add(lower);
        aliasesOut.push(trimmed);
      };
      for (const existing of canonicalAliasesIn) pushIfNew(existing);
      for (const m of merged) {
        pushIfNew(m.email);
        const ma = Array.isArray(m.emailAliases)
          ? (m.emailAliases as unknown[]).filter(
              (x): x is string => typeof x === "string"
            )
          : [];
        for (const e of ma) pushIfNew(e);
      }

      // ─── 4. is_self carry-forward ───
      const becomesSelf =
        canonical.isSelf || merged.some((m) => m.isSelf);

      const updates: Partial<typeof people.$inferInsert> = {};
      if (aliasesOut.length !== canonicalAliasesIn.length) {
        updates.emailAliases = aliasesOut;
      }
      if (becomesSelf && !canonical.isSelf) updates.isSelf = true;
      if (Object.keys(updates).length > 0) {
        await tx
          .update(people)
          .set(updates)
          .where(eq(people.id, canonicalId));
      }

      // ─── 5. Delete merged rows ───
      await tx
        .delete(people)
        .where(
          and(eq(people.ownerId, user.id), inArray(people.id, mergeIds))
        );

      return {
        status: 200 as const,
        body: {
          canonicalId,
          mergedCount: merged.length,
          newAliasCount: aliasesOut.length,
          isSelf: becomesSelf,
        },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("[people/merge] failed", e);
    return NextResponse.json(
      { error: "internal", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
