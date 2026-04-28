import { generateObject } from "ai";
import type { z } from "zod";
import { getLlm, getFallbackLlm } from "./client";

/**
 * Wraps `generateObject` with a one-shot fallback to OpenRouter when the
 * primary provider returns a non-retryable error (credit balance, auth,
 * hard rate-limit). pg-boss already retries transient errors via its
 * retryLimit/retryBackoff, so we only fall back when retrying the same
 * provider would be pointless.
 */
export async function generateObjectWithFallback<T>(args: {
  schema: z.ZodType<T>;
  schemaName?: string;
  schemaDescription?: string;
  prompt: string;
}): Promise<{ object: T }> {
  try {
    const result = await generateObject({ model: getLlm(), ...args });
    return { object: result.object as T };
  } catch (err) {
    const fallback = getFallbackLlm();
    if (!fallback || !isNonRetryableProviderError(err)) throw err;
    console.warn(
      "[ai-fallback] primary failed non-retryably, falling back to OpenRouter:",
      err instanceof Error ? err.message : String(err)
    );
    const result = await generateObject({ model: fallback, ...args });
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
