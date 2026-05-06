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
import { and, eq, isNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!enableGranola()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const payload: GranolaNoteImportPayload = parsed.data;
  const warnings: string[] = [];

  const result = await db.transaction(async (tx) => {
    // ─── 1. Upsert attendee people rows (resolve granolaPersonId → people.id) ───
    const personIdByGranolaId = new Map<string, string>();

    for (const a of payload.attendees) {
      const existing = await tx
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
          .returning({ id: people.id });
        personId = inserted[0].id;
      }
      personIdByGranolaId.set(a.granolaPersonId, personId);
    }

    // ─── 2. Upsert folders for each list ───
    const folderIdByGranolaListId = new Map<string, string>();
    for (const l of payload.lists) {
      const existing = await tx
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
      if (existing.length > 0) {
        folderId = existing[0].id;
      } else {
        const inserted = await tx
          .insert(folders)
          .values({
            ownerId,
            name: l.name,
            importSource: "granola",
            importSourceId: l.granolaListId,
          })
          .returning({ id: folders.id });
        folderId = inserted[0].id;
      }
      folderIdByGranolaListId.set(l.granolaListId, folderId);
    }

    // ─── 3. Upsert media_objects row ───
    const attendeesJson = payload.attendees
      .map((a) => personIdByGranolaId.get(a.granolaPersonId))
      .filter((id): id is string => Boolean(id));

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
      const existingAttendees = m.attendees as unknown;
      if (
        existingAttendees === null ||
        (Array.isArray(existingAttendees) && existingAttendees.length === 0)
      ) {
        if (attendeesJson.length > 0) updates.attendees = attendeesJson;
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
    } else if (!existingNote[0].body && payload.notesBody) {
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
      if (!a.summary && payload.aiSummary) updates.summary = payload.aiSummary;
      if (Object.keys(updates).length > 0) {
        await tx.update(aiOutputs).set(updates).where(eq(aiOutputs.id, a.id));
      }
    }

    return { mediaObjectId, action, hadFolder: assignedAnyFolder };
  });

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
