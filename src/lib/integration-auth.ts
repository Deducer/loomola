import { timingSafeEqual } from "crypto";
import { bearerTokenFromRequest } from "@/lib/require-auth";

export function hasIntegrationToken(request: Request): boolean {
  const expected = process.env.INTEGRATION_API_TOKEN;
  const token = bearerTokenFromRequest(request);
  if (!expected || !token) return false;

  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  return (
    expectedBuffer.length === tokenBuffer.length &&
    timingSafeEqual(expectedBuffer, tokenBuffer)
  );
}
