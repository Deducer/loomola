"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { RecordingResult, TrackKind } from "@/lib/recording/types";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function trackLabel(kind: TrackKind): string {
  switch (kind) {
    case "composite":
      return "Composite (share-ready)";
    case "screen":
      return "Raw screen video";
    case "camera":
      return "Raw camera video";
    case "mic":
      return "Raw microphone audio";
    case "system-audio":
      return "Raw system audio";
  }
}

export function FinishedView({
  slug,
  result,
  onReset,
}: {
  slug: string;
  result: RecordingResult;
  onReset: () => void;
}) {
  const [urls] = useState(() =>
    result.tracks.map((t) => ({
      kind: t.kind,
      url: URL.createObjectURL(t.blob),
      sizeBytes: t.sizeBytes,
      mimeType: t.mimeType,
    }))
  );

  useEffect(() => {
    return () => {
      for (const u of urls) URL.revokeObjectURL(u.url);
    };
  }, [urls]);

  const composite = urls.find((u) => u.kind === "composite");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text">
          Recording uploaded
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Duration: {result.durationSeconds.toFixed(1)}s · Resolution:{" "}
          {result.settings.resolution.toUpperCase()} · Transcript and AI
          summary are processing — the share page fills in as they finish
        </p>
      </div>

      <div className="rounded-xl border border-border bg-bg-subtle p-4">
        <p className="text-sm font-medium text-text">Share link</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted">
            /v/{slug}
          </code>
          <Link href={`/v/${slug}`}>
            <Button size="sm">Open</Button>
          </Link>
        </div>
      </div>

      {composite && (
        <video
          src={composite.url}
          controls
          className="w-full rounded-xl border border-border bg-black"
        />
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Local downloads (also on R2)
        </h3>
        <ul className="mt-3 grid gap-2">
          {urls.map((u) => (
            <li
              key={u.kind}
              className="flex items-center justify-between rounded-lg border border-border bg-bg-subtle p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-text">
                  {trackLabel(u.kind)}
                </div>
                <div className="mt-0.5 text-xs text-text-subtle">
                  {u.mimeType} · {formatBytes(u.sizeBytes)}
                </div>
              </div>
              <a
                href={u.url}
                download={`loom-${result.settings.resolution}-${u.kind}.webm`}
                className="inline-flex items-center rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      </div>

      <Button variant="outline" onClick={onReset}>
        New recording
      </Button>
    </div>
  );
}
