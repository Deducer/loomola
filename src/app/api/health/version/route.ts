import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    app: "loomola",
    commit: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown",
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
    environment: process.env.NODE_ENV ?? "unknown",
  });
}
