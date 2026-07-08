import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  AttendeeUpdateError,
  updateAudioNoteAttendees,
} from "@/db/queries/notes";
import { enqueueSpeakerSuggestion } from "@/lib/queue/boss";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const attendeesSchema = z.object({
  personIds: z.array(z.string().uuid()).max(50),
  // Optional provenance: which calendar event these attendees came from
  // (set by the desktop at recording start, or when the user links an
  // event afterwards). Drives the workspace's Today pill.
  calendarEventTitle: z.string().trim().max(300).nullish(),
  calendarEventStartedAt: z.string().datetime({ offset: true }).nullish(),
});

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const json = await request.json().catch(() => ({}));
  const parsed = attendeesSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_attendees" }, { status: 400 });
  }

  try {
    const attendees = await updateAudioNoteAttendees({
      mediaObjectId: id,
      ownerId: user.id,
      personIds: parsed.data.personIds,
    });

    if (parsed.data.calendarEventTitle !== undefined) {
      await db
        .update(mediaObjects)
        .set({
          calendarEventTitle: parsed.data.calendarEventTitle ?? null,
          calendarEventStartedAt: parsed.data.calendarEventStartedAt
            ? new Date(parsed.data.calendarEventStartedAt)
            : null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, user.id)));
    }

    try {
      await enqueueSpeakerSuggestion({ mediaObjectId: id });
    } catch (err) {
      console.error(
        `[attendees] failed to enqueue speaker suggestion for ${id}:`,
        err
      );
    }

    return NextResponse.json({ attendees }, { status: 200 });
  } catch (err) {
    if (err instanceof AttendeeUpdateError) {
      const status = err.message === "media_object_not_found" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[attendees] update failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
