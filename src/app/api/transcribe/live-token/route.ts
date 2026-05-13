import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { grantDeepgramLiveToken } from "@/lib/deepgram/live-token";

const requestSchema = z.object({
  ttlSeconds: z.number().optional(),
});

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function POST(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  await requireAuth(request);

  const json = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const token = await grantDeepgramLiveToken({
      ttlSeconds: parsed.data.ttlSeconds,
    });
    return NextResponse.json(token, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[transcribe/live-token] failed to mint token:", err);
    return NextResponse.json(
      { error: "live_token_unavailable" },
      { status: 503 }
    );
  }
}
