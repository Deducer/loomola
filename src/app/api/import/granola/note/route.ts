// POST /api/import/granola/note
//
// Single endpoint for the Granola → Loomola CLI migration tool.
// Receives one Granola-shaped payload per note, upserts media_objects
// + notes + transcripts + ai_outputs + people + folders +
// speaker_assignments + media_folder_assignments inside one transaction
// under the merge / fill-the-gaps idempotency rule. Queues
// suggest_folder pg-boss job for orphan notes after commit.
//
// Spec: docs/superpowers/specs/2026-05-06-granola-migration-tool-design.md

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getOptionalAuthUser } from "@/lib/require-auth";
import { db } from "@/db";
import {
  mediaObjects,
  notes,
  aiOutputs,
  transcripts,
  people,
  folders,
  speakerAssignments,
  mediaFolderAssignments,
} from "@/db/schema";
import { enableGranola } from "@/lib/feature-flags";
import {
  granolaNoteImportSchema,
  type GranolaNoteImportPayload,
  type GranolaNoteImportResult,
} from "@/lib/import/granola/schema";
import {
  assignSpeakerIndices,
  buildImportSlug,
  detectMeetingApp,
} from "@/lib/import/granola/transform";
import { getBoss } from "@/lib/queue/boss";
import { SUGGEST_FOLDER_JOB } from "@/lib/queue/jobs/suggest-folder";

/**
 * Strip Postgres-incompatible null bytes () from every string in
 * the payload. Granola's API has been observed returning raw  in
 * note bodies, transcripts, and titles; Bun/Node JSON.parse accepts
 * them but Postgres `text` columns reject them with "invalid byte
 * sequence". Cheap recursive scrub.
 */
function stripNulls(s: string): string {
  return s.includes("\x00") ? s.replace(/\x00/g, "") : s;
}

function sanitizePayload(p: GranolaNoteImportPayload): GranolaNoteImportPayload {
  return {
    ...p,
    title: stripNulls(p.title),
    notesBody: stripNulls(p.notesBody),
    aiSummary: stripNulls(p.aiSummary),
    attendees: p.attendees.map((a) => ({
      ...a,
      name: stripNulls(a.name),
    })),
    lists: p.lists.map((l) => ({ ...l, name: stripNulls(l.name) })),
    transcript: p.transcript
      ? {
          fullText: stripNulls(p.transcript.fullText),
          segments: p.transcript.segments.map((s) => ({
            ...s,
            text: stripNulls(s.text),
          })),
        }
      : null,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!enableGranola()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Accept either a cookie session (browser) or an Authorization: Bearer
  // <jwt> header (CLI). Claims verification avoids a full Auth user fetch
  // for each imported note.
  const user = await getOptionalAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = user.id;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = granolaNoteImportSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const payload: GranolaNoteImportPayload = sanitizePayload(parsed.data);
  const warnings: string[] = [];

  let result: { mediaObjectId: string; action: "created" | "updated" | "unchanged"; hadFolder: boolean };
  try {
    result = await db.transaction(async (tx) => {
    // ─── 1. Upsert attendee people rows (resolve granolaPersonId → people.id) ───
    const personIdByGranolaId = new Map<string, string>();

    for (const a of payload.attendees) {
      let existing = await tx
        .select()
        .from(people)
        .where(
          and(
            eq(people.ownerId, ownerId),
            eq(people.importSource, "granola"),
            eq(people.importSourceId, a.granolaPersonId)
          )
        )
        .limit(1);
      // Fallback: if no Granola-id match, try matching by any email
      // (canonical or alias). Lets a Granola attendee that you've
      // already added to your People library get merged onto your
      // existing row instead of forking a duplicate.
      if (existing.length === 0 && a.email) {
        const lower = a.email.trim().toLowerCase();
        const byEmail = await tx
          .select()
          .from(people)
          .where(
            and(
              eq(people.ownerId, ownerId),
              sql`(lower(${people.email}) = ${lower}
                   OR ${people.emailAliases} @> ${JSON.stringify([lower])}::jsonb)`
            )
          )
          .limit(1);
        if (byEmail.length > 0) {
          // Stamp the Granola identity onto the matched person so
          // future re-imports hit the import-key path above.
          const e = byEmail[0];
          const aliases = Array.isArray(e.emailAliases)
            ? (e.emailAliases as string[])
            : [];
          const updates: Partial<typeof people.$inferInsert> = {
            importSource: "granola",
            importSourceId: a.granolaPersonId,
          };
          // Add Granola's email to aliases if different from canonical.
          if (
            a.email &&
            e.email?.toLowerCase() !== a.email.toLowerCase() &&
            !aliases.some((x) => x.toLowerCase() === a.email!.toLowerCase())
          ) {
            updates.emailAliases = [...aliases, a.email];
          }
          await tx.update(people).set(updates).where(eq(people.id, e.id));
          existing = [{ ...e, ...updates }];
        }
      }

      let personId: string;
      if (existing.length > 0) {
        const e = existing[0];
        const updates: Partial<typeof people.$inferInsert> = {};
        if (!e.displayName && a.name) updates.displayName = a.name;
        if (!e.email && a.email) updates.email = a.email;
        if (!e.isSelf && a.isSelf) updates.isSelf = true;
        if (Object.keys(updates).length > 0) {
          await tx.update(people).set(updates).where(eq(people.id, e.id));
        }
        personId = e.id;
      } else if (a.isSelf) {
        // Look for a pre-existing is_self=true row without import metadata.
        // If one exists, merge the granolaPersonId onto it (don't dup).
        const selfRow = await tx
          .select()
          .from(people)
          .where(and(eq(people.ownerId, ownerId), eq(people.isSelf, true)))
          .limit(1);
        if (selfRow.length > 0) {
          const r = selfRow[0];
          await tx
            .update(people)
            .set({
              importSource: "granola",
              importSourceId: a.granolaPersonId,
              displayName: r.displayName || a.name,
              email: r.email ?? a.email,
            })
            .where(eq(people.id, r.id));
          personId = r.id;
        } else {
          const inserted = await tx
            .insert(people)
            .values({
              ownerId,
              displayName: a.name || "Me",
              email: a.email,
              isSelf: true,
              importSource: "granola",
              importSourceId: a.granolaPersonId,
            })
            .returning({ id: people.id });
          personId = inserted[0].id;
        }
      } else {
        // Race-safe insert. If another concurrent import for the same
        // user already inserted this granolaPersonId, our INSERT would
        // violate the partial unique index and the whole transaction
        // would abort. ON CONFLICT DO NOTHING + a fetch-fallback turns
        // that race into a quiet collision.
        const inserted = await tx
          .insert(people)
          .values({
            ownerId,
            displayName: a.name || "Unknown",
            email: a.email,
            isSelf: false,
            importSource: "granola",
            importSourceId: a.granolaPersonId,
          })
          .onConflictDoNothing({
            target: [
              people.ownerId,
              people.importSource,
              people.importSourceId,
            ],
          })
          .returning({ id: people.id });
        if (inserted.length > 0) {
          personId = inserted[0].id;
        } else {
          const refetch = await tx
            .select({ id: people.id })
            .from(people)
            .where(
              and(
                eq(people.ownerId, ownerId),
                eq(people.importSource, "granola"),
                eq(people.importSourceId, a.granolaPersonId)
              )
            )
            .limit(1);
          personId = refetch[0]!.id;
        }
      }
      personIdByGranolaId.set(a.granolaPersonId, personId);
    }

    // ─── 2. Upsert folders for each list ───
    // Lookup priority:
    //   1. By (owner, 'granola', granolaListId) — the dedicated import key.
    //   2. Fallback: by (owner, name, parent IS NULL) — merges into an
    //      existing user-created folder of the same name. Required because
    //      `folders_unique_sibling_name` (owner, COALESCE(parent, …), name)
    //      forbids creating a second folder with the same name; name
    //      collisions with manually-created folders are common (users
    //      mirror their Granola list names locally) and the practical
    //      answer is to merge into the existing folder rather than fail.
    //      When we merge, we ALSO stamp `import_source` + `import_source_id`
    //      on the existing folder so future runs find it via the dedicated
    //      key on path 1 — keeping the merge sticky.
    const folderIdByGranolaListId = new Map<string, string>();
    for (const l of payload.lists) {
      const byImportKey = await tx
        .select()
        .from(folders)
        .where(
          and(
            eq(folders.ownerId, ownerId),
            eq(folders.importSource, "granola"),
            eq(folders.importSourceId, l.granolaListId)
          )
        )
        .limit(1);
      let folderId: string;
      if (byImportKey.length > 0) {
        folderId = byImportKey[0].id;
      } else {
        const byName = await tx
          .select()
          .from(folders)
          .where(
            and(
              eq(folders.ownerId, ownerId),
              eq(folders.name, l.name),
              isNull(folders.parentId)
            )
          )
          .limit(1);
        if (byName.length > 0) {
          // Merge into the existing user-created folder. Stamp the import
          // metadata only if currently null so we don't overwrite a
          // different Granola list id mapped earlier.
          const existing = byName[0];
          if (!existing.importSource) {
            await tx
              .update(folders)
              .set({
                importSource: "granola",
                importSourceId: l.granolaListId,
              })
              .where(eq(folders.id, existing.id));
          }
          folderId = existing.id;
          warnings.push(
            `merged Granola list "${l.name}" into existing folder ${existing.id}`
          );
        } else {
          // Race-safe insert: same partial unique index logic as people.
          const inserted = await tx
            .insert(folders)
            .values({
              ownerId,
              name: l.name,
              importSource: "granola",
              importSourceId: l.granolaListId,
            })
            .onConflictDoNothing({
              target: [
                folders.ownerId,
                folders.importSource,
                folders.importSourceId,
              ],
            })
            .returning({ id: folders.id });
          if (inserted.length > 0) {
            folderId = inserted[0].id;
          } else {
            const refetch = await tx
              .select({ id: folders.id })
              .from(folders)
              .where(
                and(
                  eq(folders.ownerId, ownerId),
                  eq(folders.importSource, "granola"),
                  eq(folders.importSourceId, l.granolaListId)
                )
              )
              .limit(1);
            folderId = refetch[0]!.id;
          }
        }
      }
      folderIdByGranolaListId.set(l.granolaListId, folderId);
    }

    // ─── 3. Upsert media_objects row ───
    // The dashboard's notes-list renders this jsonb directly as an array
    // of display strings (see src/components/dashboard/notes-list.tsx
    // attendeeLabel) — so store NAMES here, not the people UUIDs. The
    // structured link to people rows is preserved separately on
    // people.import_source_id and via speaker_assignments.
    const attendeesJson = payload.attendees
      .map((a) => a.name?.trim() || a.email)
      .filter((s): s is string => Boolean(s));

    const existingMedia = await tx
      .select()
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.ownerId, ownerId),
          eq(mediaObjects.importSource, "granola"),
          eq(mediaObjects.importSourceId, payload.granolaId)
        )
      )
      .limit(1);

    let mediaObjectId: string;
    let action: "created" | "updated" | "unchanged" = "unchanged";

    if (existingMedia.length > 0) {
      const m = existingMedia[0];
      mediaObjectId = m.id;
      const updates: Partial<typeof mediaObjects.$inferInsert> = {};
      if (!m.title && payload.title) updates.title = payload.title;
      if (!m.meetingStartedAtLocal) {
        updates.meetingStartedAtLocal = new Date(payload.createdAt);
      }
      if (!m.durationSeconds && payload.durationSeconds !== null) {
        updates.durationSeconds = String(payload.durationSeconds);
      }
      if (!m.meetingDetectedApp) {
        const app = detectMeetingApp(payload.meetingUrl);
        if (app) updates.meetingDetectedApp = app;
      }
      // Attendees is metadata (display strings), not user-editable data.
      // Always refresh on import so a new attendee or a fixed name on
      // Granola's side propagates. Skip only when source is empty AND
      // we'd clobber an existing list.
      const existingAttendees = m.attendees as unknown;
      if (attendeesJson.length > 0) {
        updates.attendees = attendeesJson;
      } else if (
        existingAttendees === null ||
        (Array.isArray(existingAttendees) && existingAttendees.length === 0)
      ) {
        updates.attendees = attendeesJson;
      }
      if (Object.keys(updates).length > 0) {
        await tx
          .update(mediaObjects)
          .set(updates)
          .where(eq(mediaObjects.id, m.id));
        action = "updated";
      }
    } else {
      const slug = buildImportSlug(payload.title, payload.granolaId);
      const inserted = await tx
        .insert(mediaObjects)
        .values({
          ownerId,
          type: "audio",
          slug,
          title: payload.title || null,
          status: "ready",
          durationSeconds:
            payload.durationSeconds !== null
              ? String(payload.durationSeconds)
              : null,
          meetingStartedAtLocal: new Date(payload.createdAt),
          meetingDetectedApp: detectMeetingApp(payload.meetingUrl),
          attendees: attendeesJson.length > 0 ? attendeesJson : null,
          importSource: "granola",
          importSourceId: payload.granolaId,
        })
        .returning({ id: mediaObjects.id });
      mediaObjectId = inserted[0].id;
      action = "created";
    }

    // ─── 4. Upsert notes row ───
    const existingNote = await tx
      .select()
      .from(notes)
      .where(eq(notes.mediaObjectId, mediaObjectId))
      .limit(1);
    if (existingNote.length === 0) {
      await tx.insert(notes).values({
        mediaObjectId,
        ownerId,
        body: payload.notesBody,
      });
    } else if (
      payload.notesBody &&
      (payload.replaceContent || !existingNote[0].body)
    ) {
      await tx
        .update(notes)
        .set({ body: payload.notesBody })
        .where(eq(notes.id, existingNote[0].id));
    }

    // ─── 5. Insert transcript if absent ───
    if (payload.transcript) {
      const existingTranscript = await tx
        .select()
        .from(transcripts)
        .where(eq(transcripts.mediaObjectId, mediaObjectId))
        .limit(1);
      if (existingTranscript.length === 0) {
        const speakerMap = assignSpeakerIndices(payload.transcript.segments);
        await tx.insert(transcripts).values({
          mediaObjectId,
          fullText: payload.transcript.fullText,
          // Granola provides segment-level timing only. Word-level
          // hover-scrub features in the renderer don't apply to
          // imports — documented limitation.
          wordTimestamps: [],
          provider: "granola",
          language: "en",
        });
        // ─── 6. Speaker assignments derived from speakerMap ───
        const inserts: Array<typeof speakerAssignments.$inferInsert> = [];
        for (const [granolaPersonId, idx] of Object.entries(speakerMap)) {
          const personId = personIdByGranolaId.get(granolaPersonId);
          if (!personId) continue;
          inserts.push({
            mediaObjectId,
            speakerIdx: idx,
            personId,
            isSuggestion: false,
          });
        }
        if (inserts.length > 0) {
          await tx.insert(speakerAssignments).values(inserts);
        }
      }
    } else {
      warnings.push("transcript not available from Granola");
    }

    // ─── 7. media_folder_assignments + dual-write legacy folder_id ───
    let assignedAnyFolder = false;
    for (const l of payload.lists) {
      const folderId = folderIdByGranolaListId.get(l.granolaListId);
      if (!folderId) continue;
      const existingAssn = await tx
        .select()
        .from(mediaFolderAssignments)
        .where(
          and(
            eq(mediaFolderAssignments.mediaObjectId, mediaObjectId),
            eq(mediaFolderAssignments.folderId, folderId)
          )
        )
        .limit(1);
      if (existingAssn.length === 0) {
        await tx.insert(mediaFolderAssignments).values({
          mediaObjectId,
          folderId,
          ownerId,
        });
      }
      assignedAnyFolder = true;
    }
    if (assignedAnyFolder && payload.lists[0]) {
      const firstListFolderId = folderIdByGranolaListId.get(
        payload.lists[0].granolaListId
      );
      if (firstListFolderId) {
        await tx
          .update(mediaObjects)
          .set({ folderId: firstListFolderId })
          .where(
            and(
              eq(mediaObjects.id, mediaObjectId),
              isNull(mediaObjects.folderId)
            )
          );
      }
    }

    // ─── 8. Upsert ai_outputs ───
    const existingAi = await tx
      .select()
      .from(aiOutputs)
      .where(eq(aiOutputs.mediaObjectId, mediaObjectId))
      .limit(1);
    if (existingAi.length === 0) {
      await tx.insert(aiOutputs).values({
        mediaObjectId,
        titleSuggested: payload.title || null,
        summary: payload.aiSummary || null,
        chapters: [],
        actionItems: [],
        llmModel: "granola",
        templateId: "granola-import",
        generationStatusValue: "complete",
      });
    } else {
      const a = existingAi[0];
      const updates: Partial<typeof aiOutputs.$inferInsert> = {};
      if (!a.titleSuggested && payload.title) {
        updates.titleSuggested = payload.title;
      }
      if (
        payload.aiSummary &&
        (payload.replaceContent || !a.summary)
      ) {
        updates.summary = payload.aiSummary;
      }
      if (Object.keys(updates).length > 0) {
        await tx.update(aiOutputs).set(updates).where(eq(aiOutputs.id, a.id));
      }
    }

    return { mediaObjectId, action, hadFolder: assignedAnyFolder };
    });
  } catch (e) {
    const err = e as Error & {
      code?: string;
      detail?: string;
      constraint?: string;
      table?: string;
      column?: string;
      cause?: unknown;
    };
    const msg = err?.message ?? String(e);
    const cause = err?.cause as
      | { code?: string; detail?: string; constraint?: string; message?: string }
      | undefined;
    console.error("[import/granola/note] transaction failed", {
      granolaId: payload.granolaId,
      title: payload.title?.slice(0, 60),
      attendees: payload.attendees.length,
      lists: payload.lists.length,
      transcriptSegs: payload.transcript?.segments.length ?? 0,
      error: msg,
      pgCode: err?.code ?? cause?.code,
      pgDetail: err?.detail ?? cause?.detail,
      pgConstraint: err?.constraint ?? cause?.constraint,
      causeMsg: cause?.message,
      stack: err?.stack,
    });
    return NextResponse.json(
      {
        error: "Import failed",
        granolaId: payload.granolaId,
        message: msg,
        pgCode: err?.code ?? cause?.code ?? null,
        pgDetail: err?.detail ?? cause?.detail ?? null,
        pgConstraint: err?.constraint ?? cause?.constraint ?? null,
        causeMsg: cause?.message ?? null,
      },
      { status: 500 }
    );
  }

  // ─── 9. Outside the transaction: queue suggest_folder for orphans ───
  if (!result.hadFolder && result.action === "created") {
    try {
      const boss = await getBoss();
      await boss.send(SUGGEST_FOLDER_JOB, {
        mediaObjectId: result.mediaObjectId,
      });
    } catch (e) {
      warnings.push(
        `suggest_folder enqueue failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const responseBody: GranolaNoteImportResult = {
    mediaObjectId: result.mediaObjectId,
    action: result.action,
    warnings,
  };
  return NextResponse.json(responseBody);
}
