"use client";

import { useEffect, useRef, useState } from "react";
import {
  LOGO_ALLOWED_MIME,
  LOGO_MAX_BYTES,
} from "@/lib/validation/brand-profile";

type Props = {
  /** Form-data field name. */
  name: string;
  /** Label rendered above the picker. */
  label: string;
  /** Optional secondary label, shown next to the main label in lighter text. */
  sublabel?: string;
  /** Existing logo URL to render in the preview when no new file is selected. */
  initialPreviewUrl: string | null;
  /** Background variant for the preview tile (so dark logos read on dark and vice versa). */
  variant: "light" | "dark";
};

const MAX_MB = LOGO_MAX_BYTES / (1024 * 1024);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One file-upload slot with a live preview. Used twice in the brand
 * form — once for the light-mode logo, once for the dark-mode variant.
 *
 * The native file input is visually hidden and replaced with a custom
 * button + filename label. Reasons:
 *   1. The native renderer shows "No file chosen" next to the button;
 *      in our narrow grid column it truncated to "N." which read as
 *      a rendering glitch.
 *   2. Lets us validate size + MIME on selection and show a clear
 *      error inline — Next.js server-action body limit (4 MB) bounces
 *      oversized uploads before our server validation runs.
 *
 * Layout uses `items-start` so the two pickers in the grid align by
 * their top edges regardless of whether one has a pending filename
 * or an error displayed.
 */
export function LogoPicker({
  name,
  label,
  sublabel,
  initialPreviewUrl,
  variant,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pendingFile) return;
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (!f) {
      setPendingFile(null);
      setPreviewUrl(initialPreviewUrl);
      return;
    }
    if (!LOGO_ALLOWED_MIME.has(f.type)) {
      setError("Use PNG, JPG, WebP, or SVG.");
      setPendingFile(null);
      setPreviewUrl(initialPreviewUrl);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (f.size > LOGO_MAX_BYTES) {
      setError(`Image is ${formatBytes(f.size)} — max is ${MAX_MB} MB.`);
      setPendingFile(null);
      setPreviewUrl(initialPreviewUrl);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setPendingFile(f);
  }
  function clearPending() {
    setPendingFile(null);
    setPreviewUrl(initialPreviewUrl);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const tileBg =
    variant === "dark"
      ? "bg-[#0a0a0a] text-zinc-400"
      : "bg-zinc-100 text-zinc-500";

  const hasPending = !!pendingFile;
  const hasExisting = !!initialPreviewUrl;

  return (
    <div>
      <label
        htmlFor={name}
        className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
      >
        {label}
        {sublabel && (
          <>
            {" "}
            <span className="font-normal normal-case tracking-normal text-text-subtle">
              {sublabel}
            </span>
          </>
        )}
      </label>
      <div className="mt-1.5 flex items-start gap-3">
        <div
          className={`flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border p-2 ${tileBg}`}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={`${label} preview`}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-[10px] uppercase tracking-wider">
              No logo
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <input
            ref={fileRef}
            id={name}
            name={name}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={onChange}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-bg-elevated/70"
          >
            {hasPending || hasExisting ? "Replace" : "Choose file"}
          </button>
          {hasPending && (
            <div className="mt-1.5 truncate text-xs text-text-muted">
              {pendingFile!.name}{" "}
              <span className="text-text-subtle">
                ({formatBytes(pendingFile!.size)})
              </span>
            </div>
          )}
          {error && (
            <p className="mt-1.5 text-xs text-destructive">{error}</p>
          )}
          {hasPending && !error && (
            <button
              type="button"
              onClick={clearPending}
              className="mt-1 text-xs text-text-subtle underline-offset-2 hover:text-text-muted hover:underline"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
