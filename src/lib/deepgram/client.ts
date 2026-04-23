import { DeepgramClient } from "@deepgram/sdk";

let cached: DeepgramClient | null = null;

export function getDeepgramClient(): DeepgramClient {
  if (cached) return cached;
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  cached = new DeepgramClient({ apiKey: key });
  return cached;
}
