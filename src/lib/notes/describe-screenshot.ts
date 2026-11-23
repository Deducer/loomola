import {
  setNoteAttachmentDescription,
  type NoteAttachment,
} from "@/db/queries/notes";
import { getClassifierLlm } from "@/lib/ai/client";
import { generateTextWithFallback } from "@/lib/ai/with-fallback";
import { presignGet } from "@/lib/r2/presigned-get";
import { SCREENSHOT_KIND } from "./screenshots";

export const NO_SHARED_CONTENT = "NO_SHARED_CONTENT";

const DESCRIPTION_MAX_CHARS = 400;
const DESCRIBE_TIMEOUT_MS = 25_000;

const PROMPT = [
  "This is an automatic screenshot of a video-meeting window, taken while the meeting was being recorded for notes.",
  "",
  "If someone is sharing a screen, slide, document, app, website, whiteboard or video, say in one or two plain sentences (60 words at most) what is shown: its title or heading, and the key visible text, numbers, names or labels. Describe only what is visible. Start with the thing itself (\"Slide titled…\", \"Spreadsheet of…\", \"Settings page in…\"), not with \"The screenshot shows\" or \"The shared content is\". Do not mention the meeting app's own controls or the participants.",
  "",
  `If the window shows only participants (video tiles, avatars, names, a waiting or lobby screen) and no shared content, reply with exactly ${NO_SHARED_CONTENT} and nothing else.`,
].join("\n");

export type ScreenshotVerdict =
  | { kind: "described"; description: string }
  | { kind: "no_shared_content" }
  // No model configured, or the call failed. The frame is kept and the
  // summary job tries again.
  | { kind: "unavailable" };

/** Pure: the model's reply → verdict. */
export function parseScreenshotVerdict(reply: string): ScreenshotVerdict {
  const text = reply.trim();
  if (!text) return { kind: "unavailable" };
  if (text.toUpperCase().includes(NO_SHARED_CONTENT)) {
    return { kind: "no_shared_content" };
  }
  const oneLine = text.replace(/\s+/g, " ");
  return {
    kind: "described",
    description:
      oneLine.length > DESCRIPTION_MAX_CHARS
        ? `${oneLine.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`
        : oneLine,
  };
}

/** One cheap model call. Never throws: a failure is "unavailable". */
export async function describeScreenshot(
  image: Uint8Array | URL,
  contentType: string
): Promise<ScreenshotVerdict> {
  try {
    const { text } = await generateTextWithFallback({
      model: getClassifierLlm(),
      // Thinking counts toward the cap on current Claude models, so leave
      // room beyond the two sentences asked for.
      maxOutputTokens: 2_000,
      abortSignal: AbortSignal.timeout(DESCRIBE_TIMEOUT_MS),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image", image, mediaType: contentType },
          ],
        },
      ],
    });
    return parseScreenshotVerdict(text);
  } catch (err) {
    console.warn(
      "[screenshots] describe failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { kind: "unavailable" };
  }
}

const DESCRIBE_CONCURRENCY = 4;

/**
 * Describes screenshots that were stored without a description (the model
 * was unavailable at upload) and returns the list with those filled in.
 * Best effort: anything that fails stays undescribed and is simply left out
 * of the notes prompt.
 */
export async function describePendingScreenshots(
  attachments: NoteAttachment[]
): Promise<NoteAttachment[]> {
  const pending = attachments.filter(
    (attachment) =>
      attachment.kind === SCREENSHOT_KIND && attachment.description === null
  );
  if (pending.length === 0) return attachments;

  const described = new Map<string, string>();
  for (let i = 0; i < pending.length; i += DESCRIBE_CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + DESCRIBE_CONCURRENCY).map(async (attachment) => {
        try {
          const verdict = await describeScreenshot(
            new URL(await presignGet(attachment.r2Key)),
            attachment.contentType
          );
          if (verdict.kind === "unavailable") return;
          const description =
            verdict.kind === "described" ? verdict.description : "";
          await setNoteAttachmentDescription(attachment.id, description);
          described.set(attachment.id, description);
        } catch (err) {
          console.warn(
            "[screenshots] could not store description:",
            err instanceof Error ? err.message : String(err)
          );
        }
      })
    );
  }
  return attachments.map((attachment) =>
    described.has(attachment.id)
      ? { ...attachment, description: described.get(attachment.id) as string }
      : attachment
  );
}
