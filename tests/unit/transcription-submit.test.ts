import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDeepgramClient } from "@/lib/deepgram/client";
import { issueDeepgramCallbackToken } from "@/lib/deepgram/callback-signature";
import { runWhisperTranscription } from "@/lib/transcription/openai-whisper";
import { submitTranscription } from "@/lib/transcription/submit";

vi.mock("@/lib/deepgram/client", () => ({
  getDeepgramClient: vi.fn(),
}));

vi.mock("@/lib/deepgram/callback-signature", () => ({
  issueDeepgramCallbackToken: vi.fn(),
}));

vi.mock("@/lib/transcription/openai-whisper", () => ({
  runWhisperTranscription: vi.fn(),
}));

const transcribeUrl = vi.fn();

describe("submitTranscription", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TRANSCRIBE_PROVIDER = "deepgram";
    process.env.NEXT_PUBLIC_APP_URL = "https://loom.example.com";
    process.env.OPENAI_API_KEY = "sk-test";
    vi.mocked(issueDeepgramCallbackToken).mockResolvedValue({
      nonce: "nonce",
      sig: "sig",
    });
    vi.mocked(getDeepgramClient).mockReturnValue({
      listen: { v1: { media: { transcribeUrl } } },
    } as never);
  });

  it("falls back to OpenAI Whisper when Deepgram has no credits", async () => {
    transcribeUrl.mockRejectedValueOnce({ status: 402 });
    vi.mocked(runWhisperTranscription).mockResolvedValueOnce({
      ok: true,
      providerRequestId: "req_123",
      result: {
        fullText: "rescued transcript",
        language: "en",
        wordTimestamps: [{ word: "rescued", start: 0, end: 1, speaker: 0 }],
      },
    });

    const outcome = await submitTranscription({
      mediaObjectId: "media-1",
      audioUrl: "https://signed.example/audio.m4a",
      multichannel: true,
      language: "en",
      terms: ["n8n"],
    });

    expect(outcome).toMatchObject({
      mode: "sync",
      providerRequestId: "req_123",
    });
    expect(runWhisperTranscription).toHaveBeenCalledWith({
      mediaObjectId: "media-1",
      audioUrl: "https://signed.example/audio.m4a",
      language: "en",
      terms: ["n8n"],
    });
  });

  it("keeps the Deepgram no-credits failure when no OpenAI key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    transcribeUrl.mockRejectedValueOnce({ status: 402 });

    const outcome = await submitTranscription({
      mediaObjectId: "media-1",
      audioUrl: "https://signed.example/audio.m4a",
      multichannel: false,
      terms: [],
    });

    expect(outcome).toEqual({
      mode: "failed",
      failureReason:
        "Transcription failed: the Deepgram account has no credits (402 Payment Required).",
    });
    expect(runWhisperTranscription).not.toHaveBeenCalled();
  });

  it("includes both provider failures when the fallback is terminal too", async () => {
    transcribeUrl.mockRejectedValueOnce({ status: 402 });
    vi.mocked(runWhisperTranscription).mockResolvedValueOnce({
      ok: false,
      failureReason: "OpenAI account is out of credits.",
    });

    const outcome = await submitTranscription({
      mediaObjectId: "media-1",
      audioUrl: "https://signed.example/audio.m4a",
      multichannel: false,
      terms: [],
    });

    expect(outcome).toEqual({
      mode: "failed",
      failureReason:
        "Transcription failed: the Deepgram account has no credits (402 Payment Required). OpenAI Whisper fallback also failed: OpenAI account is out of credits.",
    });
  });
});
