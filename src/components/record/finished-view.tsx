"use client";

import { useEffect, useState } from "react";
import type { RecordingResult, TrackKind } from "@/lib/recording/types";
import Link from "next/link";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function trackLabel(kind: TrackKind): string {
  switch (kind) {
    case "composite": return "Composite (share-ready)";
    case "screen": return "Raw screen video";
    case "camera": return "Raw camera video";
    case "mic": return "Raw microphone audio";
    case "system-audio": return "Raw system audio";
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
        <h2 className="text-2xl font-semibold">Recording ready</h2>
        <p className="mt-1 text-sm opacity-60">
          Duration: {result.durationSeconds.toFixed(1)}s · Resolution:{" "}
          {result.settings.resolution.toUpperCase()} · Uploaded to your account
        </p>
      </div>

      <div className="rounded-lg border border-white/10 p-4">
        <p className="text-sm font-medium">Share link</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 rounded bg-white/5 px-3 py-2 text-sm">
            /v/{slug}
          </code>
          <Link
            href={`/v/${slug}`}
            className="rounded bg-white/90 px-3 py-2 text-sm font-medium text-black hover:bg-white"
          >
            Open
          </Link>
        </div>
      </div>

      {composite && (
        <video
          src={composite.url}
          controls
          className="w-full rounded border border-white/10 bg-black"
        />
      )}

      <div>
        <h3 className="text-sm font-medium">Local downloads (also on R2)</h3>
        <ul className="mt-2 grid gap-2">
          {urls.map((u) => (
            <li
              key={u.kind}
              className="flex items-center justify-between rounded border border-white/10 p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{trackLabel(u.kind)}</div>
                <div className="mt-0.5 text-xs opacity-60">
                  {u.mimeType} · {formatBytes(u.sizeBytes)}
                </div>
              </div>
              <a
                href={u.url}
                download={`loom-${result.settings.resolution}-${u.kind}.webm`}
                className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
      >
        New recording
      </button>
    </div>
  );
}
