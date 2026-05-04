import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { acceptPendingSuggestion } from "@/db/queries/folder-suggestion";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const result = await acceptPendingSuggestion({
    mediaObjectId: id,
    ownerId: user.id,
  });

  if (!result) {
    // Either the recording doesn't belong to the user, doesn't exist, or
    // the suggestion was already cleared by another tab. Return 409 so the
    // client can refetch instead of treating it as a hard error.
    return NextResponse.json(
      { error: "no_pending_suggestion" },
      { status: 409 }
    );
  }

  return NextResponse.json(result);
}
