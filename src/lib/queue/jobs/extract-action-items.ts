import { generateObjectWithFallback } from "@/lib/ai/with-fallback";
import { actionItemsSchema } from "@/lib/ai/schemas";
import {
  getTranscriptByRecording,
  type WordTimestamp,
} from "@/db/queries/transcripts";
import { buildTimedTranscript } from "@/lib/transcript/timed-transcript";
import {
  updateActionItems,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";

export const ACTION_ITEMS_JOB = "extract_action_items";

export type ActionItemsJobData = { mediaObjectId: string };

export async function runActionItemsJob(
  data: ActionItemsJobData
): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(`[action-items] transcript not found for ${data.mediaObjectId}`);
  }

  const text = transcript.fullText.trim();
  if (text.length === 0) {
    await updateActionItems(data.mediaObjectId, []);
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const words = transcript.wordTimestamps as WordTimestamp[];
  const durationSec =
    Array.isArray(words) && words.length > 0
      ? words[words.length - 1]?.end ?? 0
      : 0;
  const timedTranscript =
    Array.isArray(words) && words.length > 0 ? buildTimedTranscript(words) : "";

  const { object } = await generateObjectWithFallback({
    schema: actionItemsSchema,
    schemaName: "ActionItems",
    prompt: [
      "You extract concrete action items from screen-recording transcripts.",
      "When timed transcript markers are available, choose the timestamp where the action item was discussed or committed.",
      "",
      "Rules:",
      "- Include only items that represent a specific committed action or next step.",
      "- Phrase each as a single imperative sentence (e.g. 'Send Kate the updated mockups').",
      "- If the speaker says 'I'll do X', phrase as 'Do X' — drop the 'I'll'.",
      "- Skip vague ideas, hypotheticals, or casual remarks.",
      "- Return an EMPTY array if there are no concrete next steps.",
      "- Use approximate timestamps (round to the nearest second).",
      "",
      `Recording duration: ${Math.ceil(durationSec)} seconds.`,
      "",
      timedTranscript
        ? "Timed transcript (seconds in brackets):"
        : "Transcript:",
      timedTranscript || text,
    ].join("\n"),
  });

  const clamped = object.action_items.map((a) => ({
    text: a.text,
    timestamp_sec: Math.min(Math.max(0, a.timestamp_sec), durationSec),
  }));

  await updateActionItems(data.mediaObjectId, clamped);
  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[action-items] completed for ${data.mediaObjectId}: ${clamped.length} items`
  );
}
