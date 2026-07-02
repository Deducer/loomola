import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPerson,
  findPersonByAnyEmail,
  findPersonByDisplayName,
} from "@/db/queries/people";
import { normalizeCalendarAttendees } from "@/lib/people/resolve-attendees";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const resolveSchema = z.object({
  attendees: z
    .array(
      z.object({
        displayName: z.string().max(200),
        email: z.string().max(320).optional().nullable(),
      })
    )
    .max(50),
});

/// Resolves calendar attendees ({displayName, email?}) to Person ids,
/// creating People on first sight — the bridge that lets the desktop app
/// turn an EventKit attendee list into media_objects.attendees so
/// suggest_speakers fires without any manual filing. People marked
/// is_self are matched but excluded from the result: the speaker
/// suggestion contract expects attendees to be the OTHER participants.
export async function POST(request: Request) {
  if (!enableGranola()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const user = await requireAuth(request);
  const json = await request.json().catch(() => ({}));
  const parsed = resolveSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_attendees" }, { status: 400 });
  }

  const normalized = normalizeCalendarAttendees(parsed.data.attendees);
  const personIds: string[] = [];
  for (const attendee of normalized) {
    let person = attendee.email
      ? await findPersonByAnyEmail(user.id, attendee.email)
      : null;
    if (!person) {
      person = await findPersonByDisplayName(user.id, attendee.displayName);
    }
    if (!person) {
      person = await createPerson(user.id, {
        displayName: attendee.displayName,
        email: attendee.email,
      });
    }
    if (person.isSelf) continue;
    if (!personIds.includes(person.id)) personIds.push(person.id);
  }

  return NextResponse.json({ personIds });
}
