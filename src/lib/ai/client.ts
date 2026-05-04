import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

let cachedPrimary: LanguageModel | null = null;
let cachedFallback: LanguageModel | null = null;
let cachedClassifier: LanguageModel | null = null;

/**
 * Returns a cached LanguageModel configured from env. Defaults to
 * claude-sonnet-4-6 on the Anthropic provider. Swapping providers/models
 * is a config change — set LLM_PROVIDER + LLM_MODEL_ID in Doppler.
 */
export function getLlm(): LanguageModel {
  if (cachedPrimary) return cachedPrimary;
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  const modelId =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const anthropic = createAnthropic({ apiKey });
    cachedPrimary = anthropic(modelId);
    return cachedPrimary;
  }

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    const openrouter = createOpenRouter({ apiKey });
    cachedPrimary = openrouter(modelId);
    return cachedPrimary;
  }

  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}

/**
 * Returns a cached LanguageModel for classification-style tasks (folder
 * suggestion, etc.) — defaults to Haiku 4.5 because classification is
 * latency- and cost-sensitive and Sonnet's reasoning isn't required.
 * Override with LLM_CLASSIFIER_MODEL in Doppler.
 */
export function getClassifierLlm(): LanguageModel {
  if (cachedClassifier) return cachedClassifier;
  const provider = process.env.LLM_CLASSIFIER_PROVIDER ?? process.env.LLM_PROVIDER ?? "anthropic";
  const modelId =
    process.env.LLM_CLASSIFIER_MODEL ?? "claude-haiku-4-5-20251001";

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const anthropic = createAnthropic({ apiKey });
    cachedClassifier = anthropic(modelId);
    return cachedClassifier;
  }

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    const openrouter = createOpenRouter({ apiKey });
    cachedClassifier = openrouter(modelId);
    return cachedClassifier;
  }

  throw new Error(`Unsupported LLM_CLASSIFIER_PROVIDER: ${provider}`);
}

/**
 * Returns a cached fallback LanguageModel via OpenRouter, or null if
 * OPENROUTER_API_KEY is not set. Used by `generateObjectWithFallback`
 * when the primary provider returns a non-retryable error (credits,
 * auth, hard rate-limit). Model defaults to a cheap structured-output
 * capable model — override with LLM_FALLBACK_MODEL in Doppler.
 */
export function getFallbackLlm(): LanguageModel | null {
  if (cachedFallback) return cachedFallback;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const modelId = process.env.LLM_FALLBACK_MODEL ?? "google/gemini-2.5-flash";
  const openrouter = createOpenRouter({ apiKey });
  cachedFallback = openrouter(modelId);
  return cachedFallback;
}
