import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

let cached: LanguageModel | null = null;

/**
 * Returns a cached LanguageModel configured from env. Defaults to
 * claude-sonnet-4-6 on the Anthropic provider. Swapping providers/models
 * is a config change — set LLM_PROVIDER + LLM_MODEL_ID in Doppler.
 */
export function getLlm(): LanguageModel {
  if (cached) return cached;
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  const modelId = process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const anthropic = createAnthropic({ apiKey });
    cached = anthropic(modelId);
    return cached;
  }

  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}
