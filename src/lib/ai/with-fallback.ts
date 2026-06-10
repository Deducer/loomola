import { generateObject, generateText } from "ai";
import type {
  CallSettings,
  FinishReason,
  LanguageModel,
  ModelMessage,
  Prompt,
} from "ai";
import type { z } from "zod";
import { getLlm, getFallbackLlm } from "./client";

type GenerateObjectWithFallbackArgs<T> = {
  schema: z.ZodType<T>;
  schemaName?: string;
  schemaDescription?: string;
  /** Forwarded to AI SDK's `generateObject`. Defaults to provider default
   * when omitted. Raise for long-form outputs (e.g. enhanced meeting notes
   * from hour-long meetings, where the default 8K-token cap truncates). */
  maxOutputTokens?: number;
  /** Override the primary model. Defaults to `getLlm()` (Sonnet for the
   * main pipeline). Used by classification-style callers that prefer
   * Haiku via `getClassifierLlm()`. */
  model?: LanguageModel;
} & (
  | { prompt: string; messages?: never }
  | { messages: ModelMessage[]; prompt?: never }
);

type GenerateTextWithFallbackArgs = CallSettings &
  Prompt & {
    /** Override the primary model. Defaults to `getLlm()`. */
    model?: LanguageModel;
  };

/**
 * Wraps `generateObject` with a one-shot fallback to OpenRouter when the
 * primary provider returns a non-retryable error (credit balance, auth,
 * hard rate-limit). pg-boss already retries transient errors via its
 * retryLimit/retryBackoff, so we only fall back when retrying the same
 * provider would be pointless.
 */
export async function generateObjectWithFallback<T>(
  args: GenerateObjectWithFallbackArgs<T>
): Promise<{ object: T; finishReason: FinishReason }> {
  const { model: overrideModel, ...rest } = args;
  const primary = overrideModel ?? getLlm();
  try {
    const result = await generateObject({ model: primary, ...rest });
    return {
      object: result.object as T,
      finishReason: result.finishReason,
    };
  } catch (err) {
    const fallback = getFallbackLlm();
    if (!fallback || !isNonRetryableProviderError(err)) throw err;
    console.warn(
      "[ai-fallback] primary failed non-retryably, falling back to OpenRouter:",
      err instanceof Error ? err.message : String(err)
    );
    const result = await generateObject({ model: fallback, ...rest });
    return {
      object: result.object as T,
      finishReason: result.finishReason,
    };
  }
}

export async function generateTextWithFallback(
  args: GenerateTextWithFallbackArgs
): Promise<{ text: string; finishReason: FinishReason }> {
  const { model: overrideModel, ...rest } = args;
  const primary = overrideModel ?? getLlm();
  try {
    const result = await generateText({ model: primary, ...rest });
    return {
      text: result.text,
      finishReason: result.finishReason,
    };
  } catch (err) {
    const fallback = getFallbackLlm();
    if (!fallback || !isNonRetryableProviderError(err)) throw err;
    console.warn(
      "[ai-fallback] primary failed non-retryably, falling back to OpenRouter:",
      err instanceof Error ? err.message : String(err)
    );
    const result = await generateText({ model: fallback, ...rest });
    return {
      text: result.text,
      finishReason: result.finishReason,
    };
  }
}

function isNonRetryableProviderError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { isRetryable?: boolean; statusCode?: number };
  if (e.isRetryable === false) return true;
  // Some provider errors don't set isRetryable but use status codes that
  // mean "don't bother retrying same provider": 401 auth, 402 payment,
  // 403 forbidden. 400 with credit-balance message also surfaces here.
  if (e.statusCode && [400, 401, 402, 403].includes(e.statusCode)) return true;
  return false;
}

/**
 * Maps a provider error to a human-readable failure_reason for the
 * recording row. Pure — unit-tested. Shown to the OWNER only (dashboard
 * card / edit page); the public share page never renders it.
 */
export function describeAiFailure(err: unknown): string {
  const e = (err ?? {}) as { statusCode?: unknown; message?: unknown };
  const status = typeof e.statusCode === "number" ? e.statusCode : undefined;
  const message =
    typeof e.message === "string" && e.message.trim() ? e.message.trim() : null;

  if (status === 401 || status === 403) {
    return "AI generation failed: the AI provider rejected the API key";
  }
  if (status === 402 || (message ?? "").toLowerCase().includes("credit balance")) {
    return "AI generation failed: the AI provider account is out of credits";
  }
  if (status === 429) {
    return "AI generation failed: AI provider rate limit";
  }
  if (message) {
    return `AI generation failed: ${message.slice(0, 200)}`;
  }
  return "AI generation failed";
}
