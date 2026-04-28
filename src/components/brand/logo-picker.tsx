"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Form-data field name. */
  name: string;
  /** Label rendered above the picker. */
  label: string;
  /** Helper text rendered below the file input. */
  hint: string;
  /** Existing logo URL to render in the preview when no new file is selected. */
  initialPreviewUrl: string | null;
  /** Background variant for the preview tile (so dark logos read on dark and vice versa). */
  variant: "light" | "dark";
};

/**
 * One file-upload slot with a live preview. Used twice in the brand
 * form — once for the light-mode logo, once for the dark-mode variant.
 */
export function LogoPicker({
  name,
  label,
  hint,
  initialPreviewUrl,
  variant,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pendingFile) return;
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPendingFile(f);
    if (!f) setPreviewUrl(initialPreviewUrl);
  }
  function clearPending() {
    setPendingFile(null);
    setPreviewUrl(initialPreviewUrl);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Light variant uses the light/elevated background tile so a dark
  // logo reads against it (and vice versa for the dark slot).
  const tileBg =
    variant === "dark"
      ? "bg-[#0a0a0a] text-zinc-400"
      : "bg-zinc-100 text-zinc-500";

  return (
    <div>
      <label
        htmlFor={name}
        className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
      >
        {label}{" "}
        <span className="font-normal normal-case tracking-normal text-text-subtle">
          (optional)
        </span>
      </label>
      <div className="mt-1.5 flex items-center gap-4">
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
        <div className="min-w-0 flex-1">
          <input
            ref={fileRef}
            id={name}
            name={name}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={onChange}
            className="block w-full text-xs text-text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-bg-elevated file:px-3 file:py-1.5 file:text-xs file:text-text hover:file:bg-bg-elevated/70"
          />
          <p className="mt-1.5 text-xs text-text-subtle">{hint}</p>
          {pendingFile && (
            <button
              type="button"
              onClick={clearPending}
              className="mt-1 text-xs text-text-subtle underline-offset-2 hover:text-text-muted hover:underline"
            >
              Cancel new upload
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
