"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { moveVersion } from "@/lib/review/versions";

type Version = { id: string; slug: string; title: string | null; number: number; status: string };
type Candidate = { id: string; title: string | null; createdAt: string };

const ERRORS: Record<string, string> = {
  already_stacked: "That recording is already in a version stack. Remove it from that stack first.",
  not_video: "Only videos can be versions.",
  same_recording: "Pick a different recording.",
  bad_order: "The stack changed. Reload and try again.",
};

/**
 * Edit-page card for the recording's version stack: list, reorder, add an
 * existing recording as the next version, take one out (it becomes
 * standalone; nothing is deleted). New drafts usually arrive through
 * `loomola upload --version-of`.
 */
export function VersionsCard({
  recordingId,
  versions,
  candidates,
}: {
  recordingId: string;
  versions: Version[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const stacked = versions.length > 1;

  async function call(method: string, url: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(ERRORS[data.error ?? ""] ?? `Couldn't update versions (${res.status}).`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.error("Couldn't reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(id: string, dir: -1 | 1) {
    const order = moveVersion(versions.map((v) => v.id), id, dir);
    void call("PUT", `/api/recordings/${recordingId}/versions`, { order });
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <Layers className="h-3.5 w-3.5" />
        Versions
      </h2>
      {stacked ? (
        <ol className="space-y-1.5">
          {versions.map((v, i) => (
            <li
              key={v.id}
              className={
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm " +
                (v.id === recordingId ? "border-accent/50 bg-accent/5" : "border-border")
              }
            >
              <span className="w-7 shrink-0 font-mono text-xs text-text-muted">v{v.number}</span>
              <Link
                href={v.id === recordingId ? `/v/${v.slug}` : `/recordings/${v.id}/edit`}
                className="min-w-0 flex-1 truncate text-text hover:underline"
                title={v.title ?? undefined}
              >
                {v.title || "Untitled"}
                {i === versions.length - 1 && <span className="ml-1.5 text-[10px] text-text-subtle">latest</span>}
              </Link>
              <button
                type="button"
                disabled={busy || i === 0}
                onClick={() => move(v.id, -1)}
                aria-label={`Move v${v.number} earlier`}
                className="rounded p-1 text-text-subtle hover:text-text disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={busy || i === versions.length - 1}
                onClick={() => move(v.id, 1)}
                aria-label={`Move v${v.number} later`}
                className="rounded p-1 text-text-subtle hover:text-text disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void call("DELETE", `/api/recordings/${v.id}/versions`)}
                className="rounded px-1.5 py-0.5 text-[11px] text-text-subtle hover:text-text"
                title="Make it a standalone recording again (nothing is deleted)"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs leading-relaxed text-text-subtle">
          Group drafts of the same piece so reviewers can switch between them and compare two side by side.
          Agents add new drafts with <code className="font-mono">loomola upload --version-of</code>.
        </p>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!pick) return;
          if (await call("POST", `/api/recordings/${recordingId}/versions`, { recording: pick })) setPick("");
        }}
      >
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          aria-label="Recording to add as the next version"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg-subtle px-2 py-1.5 text-xs text-text"
        >
          <option value="">Add existing recording as next version…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {(c.title || "Untitled").slice(0, 60)} · {new Date(c.createdAt).toLocaleDateString()}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !pick}>
          Add
        </Button>
      </form>
      {stacked && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
          Every version shares this recording&apos;s password, and the dashboard shows only the latest.
        </p>
      )}
    </section>
  );
}
