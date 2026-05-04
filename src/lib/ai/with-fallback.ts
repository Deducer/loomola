import { generateObject } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
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

/**
 * Wraps `generateObject` with a one-shot fallback to OpenRouter when the
 * primary provider returns a non-retryable error (credit balance, auth,
 * hard rate-limit). pg-boss already retries transient errors via its
 * retryLimit/retryBackoff, so we only fall back when retrying the same
 * provider would be pointless.
 */
export async function generateObjectWithFallback<T>(
  args: GenerateObjectWithFallbackArgs<T>
): Promise<{ object: T }> {
  const { model: overrideModel, ...rest } = args;
  const primary = overrideModel ?? getLlm();
  try {
    const result = await generateObject({ model: primary, ...rest });
    return { object: result.object as T };
  } catch (err) {
    const fallback = getFallbackLlm();
    if (!fallback || !isNonRetryableProviderError(err)) throw err;
    console.warn(
      "[ai-fallback] primary failed non-retryably, falling back to OpenRouter:",
      err instanceof Error ? err.message : String(err)
    );
    const result = await generateObject({ model: fallback, ...rest });
    return { object: result.object as T };
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
