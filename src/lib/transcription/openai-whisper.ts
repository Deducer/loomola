import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeWhisperTranscript,
  type WhisperVerboseResponse,
} from "./whisper-normalize";
import {
  OPENAI_TRANSCRIBE_MAX_BYTES,
  classifyWhisperHttpFailure,
  whisperOversizeReason,
} from "./whisper-errors";
import type { NormalizedTranscript } from "./types";

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

export type WhisperRunResult =
  | { ok: true; result: NormalizedTranscript; providerRequestId: string | null }
  | { ok: false; failureReason: string };

/**
 * Synchronous whisper path. ffmpeg reads the presigned URL directly (same
 * pattern as mix-audio) and re-encodes to 16kHz mono AAC @56kbps so a
 * screen recording's VIDEO track never counts against OpenAI's 25MB cap
 * (~25MB ≈ ~1 hour of audio at this bitrate). Oversize and terminal HTTP
 * failures return ok:false with a user-facing failure_reason; transient
 * failures throw so pg-boss retries.
 */
export async function runWhisperTranscription(params: {
  mediaObjectId: string;
  audioUrl: string;
  language?: string;
  terms: string[];
}): Promise<WhisperRunResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";

  const dir = await mkdtemp(join(tmpdir(), "loom-whisper-"));
  const audioPath = join(dir, "audio.m4a");
  try {
    await extractMonoAudio(params.audioUrl, audioPath);

    const { size } = await stat(audioPath);
    if (size > OPENAI_TRANSCRIBE_MAX_BYTES) {
      return { ok: false, failureReason: whisperOversizeReason(size) };
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(await readFile(audioPath))], {
        type: "audio/mp4",
      }),
      "audio.m4a"
    );
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (params.language) form.append("language", params.language);
    if (params.terms.length > 0) {
      // Whisper's closest analogue to Deepgram keyword boosting: list the
      // user's dictionary terms in the decoding prompt (~224-token cap).
      form.append("prompt", params.terms.slice(0, 60).join(", "));
    }

    const res = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      }
    );
    const providerRequestId = res.headers.get("x-request-id");
    const bodyText = await res.text();

    if (!res.ok) {
      const verdict = classifyWhisperHttpFailure(res.status, bodyText);
      if (verdict.terminal) {
        return { ok: false, failureReason: verdict.reason };
      }
      throw new Error(
        `OpenAI transcription failed (${res.status}): ${bodyText.slice(0, 300)}`
      );
    }

    const parsed = JSON.parse(bodyText) as WhisperVerboseResponse;
    return {
      ok: true,
      result: normalizeWhisperTranscript(parsed),
      providerRequestId,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function extractMonoAudio(
  inputUrl: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputUrl,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "aac",
      "-b:a", "56k",
      "-y",
      outputPath,
    ];
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const errChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk) => errChunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg audio extract exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve();
    });
  });
}
