/**
 * Shared API error helpers (spec 3.6). Plain Response (NextResponse extends
 * it) so this module stays framework-light and trivially unit-testable.
 *
 * Shape: { error: <machine code>, message: <human text> } — matches the
 * dominant existing convention (e.g. complete/route.ts "multipart_complete_failed").
 */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: code, message }, { status });
}

/** Next.js signals redirect()/notFound() by THROWING tagged errors. The
 * wrapper must let those propagate or requireAuth's login redirect breaks. */
function isNextControlFlowError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") ||
      digest === "NEXT_NOT_FOUND")
  );
}

/**
 * Wraps a route handler: unexpected throws become a logged, generic 500 —
 * no stack traces or internal messages in the response body.
 *
 * The handler receives any arguments passed through (Next.js route handlers
 * are called with (request, context) — those are forwarded as-is). The
 * return type accepts any call-site arity so the wrapper stays testable
 * with simple zero-arg lambdas while still wrapping real route handlers.
 */
export function withApiErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => Promise<Response>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (...args: any[]) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (isNextControlFlowError(err)) throw err;
      console.error("[api] unhandled route error:", err);
      return apiError(
        500,
        "internal_error",
        "Something went wrong. Try again, or check the server logs."
      );
    }
  };
}
