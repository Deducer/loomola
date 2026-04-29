/**
 * Returns the public-facing origin for the current request, honoring
 * the reverse-proxy headers Coolify/Traefik sets in front of the
 * container. Inside the container, `request.url` resolves to the
 * internal bind address (HOSTNAME=0.0.0.0:3000), which is wrong for
 * any redirect the browser will actually follow. Falls back to the
 * request URL's origin for local dev or direct-hit scenarios where
 * the proxy headers aren't present.
 *
 * Use this anywhere you'd otherwise write `new URL(request.url).origin`
 * in a route handler.
 */
export function publicOrigin(request: Request): string {
  const xfHost = request.headers.get("x-forwarded-host");
  const xfProto = request.headers.get("x-forwarded-proto");
  if (xfHost) {
    return `${xfProto ?? "https"}://${xfHost}`;
  }
  return new URL(request.url).origin;
}
