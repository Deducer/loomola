import {
  getNoteForSpeakerSuggestion,
  getPeopleForSuggestion,
  hasExistingSpeakerAssignments,
  persistSpeakerSuggestions,
} from "@/db/queries/speaker-suggestion";
import { composeSpeakerSuggestions } from "@/lib/speaker-suggestion/compose";
import { parseAttendees } from "@/lib/speaker-suggestion/parse-attendees";

export const SUGGEST_SPEAKERS_JOB = "suggest_speakers";

export type SuggestSpeakersJobData = { mediaObjectId: string };

/**
 * Auto-suggests speaker_idx → person mappings for a recording using the
 * meeting context's attendees + the user's existing people library. Only
 * runs when the schema is well-defined (Path B):
 *   - transcript exists with diarized words
 *   - user has marked one Person as is_self = true
 *   - meeting has attendees on the row
 *   - speaker count == attendee count + 1 (covers 1:1 and 3-person calls)
 *
 * On any other shape (3 speakers but only 1 attendee, no self-Person,
 * etc.), no-ops with a single log line. Path C will pick up the cases B
 * leaves on the floor by using voice biometrics.
 */
export async function runSuggestSpeakersJob(
  data: SuggestSpeakersJobData
): Promise<void> {
  const { mediaObjectId } = data;

  const note = await getNoteForSpeakerSuggestion(mediaObjectId);
  if (!note) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} not found, skipping`
    );
    return;
  }

  // v1 (Path B) is audio-only because the speaker-assignment UI only
  // exists for audio notes today. Video recordings get the same flow
  // when video gets a creator-side transcript labeling surface.
  if (note.type !== "audio") {
    console.log(
      `[suggest-speakers] ${mediaObjectId} is type=${note.type}; v1 is audio-only, skipping`
    );
    return;
  }

  if (note.words.length === 0) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} no transcript yet, skipping`
    );
    return;
  }

  if (await hasExistingSpeakerAssignments(mediaObjectId)) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} already has speaker_assignments rows; skipping`
    );
    return;
  }

  const attendees = parseAttendees(note.attendees);
  if (attendees.length === 0) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} no attendees, skipping`
    );
    return;
  }

  const people = await getPeopleForSuggestion(note.ownerId);
  const selfPerson = people.find((p) => p.isSelf);
  if (!selfPerson) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} owner has no self-Person, skipping`
    );
    return;
  }

  const suggestions = composeSpeakerSuggestions({
    words: note.words,
    attendees,
    people,
    selfPersonId: selfPerson.id,
  });

  if (suggestions.length === 0) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} compose returned no suggestions (count mismatch or tie), skipping`
    );
    return;
  }

  await persistSpeakerSuggestions({
    mediaObjectId,
    suggestions,
  });

  console.log(
    `[suggest-speakers] ${mediaObjectId} persisted ${suggestions.length} suggestion(s)`
  );
}
