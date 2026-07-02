"use client";

import { useRouter } from "next/navigation";
import { useStatusPoll } from "@/lib/hooks/use-status-poll";

const NON_TERMINAL = new Set(["uploading", "transcribing", "processing"]);

/**
 * Watches a set of the owner's recordings that are still in the pipeline and
 * router.refresh()es when any of them reaches a new state, so dashboard cards
 * and the edit page move uploading → transcribing → processing → ready
 * without a manual reload. Renders nothing.
 */
export function ProcessingStatusWatcher({
  items,
}: {
  items: { id: string; status: string }[];
}) {
  const router = useRouter();
  const pending = items.filter((item) => NON_TERMINAL.has(item.status));

  useStatusPoll(pending.length > 0, async () => {
    const ids = pending.map((item) => item.id).join(",");
    const res = await fetch(`/api/recordings/status?ids=${ids}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      items: { id: string; status: string }[];
    };
    const byId = new Map(data.items.map((item) => [item.id, item.status]));
    const changed = pending.some(
      (item) => byId.get(item.id) !== undefined && byId.get(item.id) !== item.status
    );
    // A refresh re-renders the server component with fresh statuses, which
    // re-renders this watcher with the new `items` — the poll stops by itself
    // once nothing is pending.
    if (changed) router.refresh();
  });

  return null;
}

/**
 * Same idea for the public share page's not-ready view: polls the slim
 * status route and refreshes once the recording is ready (or failed), making
 * the page's "catches up automatically" copy true.
 */
export function ShareStatusWatcher({
  slug,
  status,
}: {
  slug: string;
  status: string;
}) {
  const router = useRouter();

  useStatusPoll(NON_TERMINAL.has(status), async () => {
    const res = await fetch(`/api/v/${slug}/status`);
    if (!res.ok) return;
    const data = (await res.json()) as { status: string };
    if (data.status !== status) router.refresh();
  });

  return null;
}
