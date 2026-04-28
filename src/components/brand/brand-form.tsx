"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ColorSwatch } from "./color-swatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandProfile } from "@/db/queries/brand-profiles";

type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string> };

type Props = {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  initialValues?: Partial<BrandProfile>;
  submitLabel: string;
};

export function BrandForm({ action, initialValues, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action,
    null
  );

  const errors = state && !state.ok ? state.fieldErrors : {};

  // The currently displayed logo preview: either the brand's existing
  // logo (resolved by server queries to a presigned R2 URL or legacy
  // direct URL) or an object URL for a freshly-selected file.
  const initialLogo = initialValues?.logoUrl ?? null;
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialLogo);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Object URLs for selected files have to be revoked or they leak.
  useEffect(() => {
    if (!pendingFile) return;
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPendingFile(f);
    if (!f) setPreviewUrl(initialLogo);
  }
  function clearPendingLogo() {
    setPendingFile(null);
    setPreviewUrl(initialLogo);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label
          htmlFor="name"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          Name
        </label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initialValues?.name ?? ""}
          maxLength={60}
          placeholder="Vayu Labs"
          className="mt-1.5"
        />
        {errors.name && (
          <p className="mt-1 text-xs text-destructive">{errors.name}</p>
        )}
      </div>

      <ColorSwatch
        name="accentColor"
        defaultValue={initialValues?.accentColor ?? "#7c3aed"}
        error={errors.accentColor}
      />

      <div>
        <label
          htmlFor="logoFile"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          Logo{" "}
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            (optional)
          </span>
        </label>
        <div className="mt-1.5 flex items-center gap-4">
          <div className="flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-bg-elevated p-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Logo preview"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-text-subtle">
                No logo
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <input
              ref={fileRef}
              id="logoFile"
              name="logoFile"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={onLogoChange}
              className="block w-full text-xs text-text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-bg-elevated file:px-3 file:py-1.5 file:text-xs file:text-text hover:file:bg-bg-elevated/70"
            />
            <p className="mt-1.5 text-xs text-text-subtle">
              PNG / JPG / WebP / SVG, up to 2 MB. Inline (horizontal)
              wordmarks render best in the share-page header.
            </p>
            {pendingFile && (
              <button
                type="button"
                onClick={clearPendingLogo}
                className="mt-1 text-xs text-text-subtle underline-offset-2 hover:text-text-muted hover:underline"
              >
                Cancel new upload
              </button>
            )}
          </div>
        </div>
        {errors.logo && (
          <p className="mt-1 text-xs text-destructive">{errors.logo}</p>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <h2 className="text-sm font-semibold text-text">Page theming</h2>
        <p className="mt-1 text-xs text-text-muted">
          Customizes the share page when this brand is assigned to a recording.
        </p>
      </div>

      <div>
        <label
          htmlFor="tagline"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          Tagline{" "}
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            (optional)
          </span>
        </label>
        <Input
          id="tagline"
          name="tagline"
          type="text"
          defaultValue={initialValues?.tagline ?? ""}
          maxLength={140}
          placeholder="Async video walkthroughs from the Vayu team"
          className="mt-1.5"
        />
        {errors.tagline && (
          <p className="mt-1 text-xs text-destructive">{errors.tagline}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="fontFamily"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          Font family{" "}
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            (Google Font name, optional)
          </span>
        </label>
        <Input
          id="fontFamily"
          name="fontFamily"
          type="text"
          defaultValue={initialValues?.fontFamily ?? ""}
          maxLength={60}
          placeholder="Inter, Manrope, IBM Plex Sans…"
          className="mt-1.5"
        />
        {errors.fontFamily && (
          <p className="mt-1 text-xs text-destructive">{errors.fontFamily}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="ctaLabel"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            CTA label{" "}
            <span className="font-normal normal-case tracking-normal text-text-subtle">
              (optional)
            </span>
          </label>
          <Input
            id="ctaLabel"
            name="ctaLabel"
            type="text"
            defaultValue={initialValues?.ctaLabel ?? ""}
            maxLength={40}
            placeholder="Book a call"
            className="mt-1.5"
          />
          {errors.ctaLabel && (
            <p className="mt-1 text-xs text-destructive">{errors.ctaLabel}</p>
          )}
        </div>
        <div>
          <label
            htmlFor="ctaUrl"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            CTA URL{" "}
            <span className="font-normal normal-case tracking-normal text-text-subtle">
              (optional)
            </span>
          </label>
          <Input
            id="ctaUrl"
            name="ctaUrl"
            type="url"
            defaultValue={initialValues?.ctaUrl ?? ""}
            placeholder="https://cal.com/your-handle"
            className="mt-1.5"
          />
          {errors.ctaUrl && (
            <p className="mt-1 text-xs text-destructive">{errors.ctaUrl}</p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="footerText"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          Footer text{" "}
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            (optional)
          </span>
        </label>
        <Textarea
          id="footerText"
          name="footerText"
          defaultValue={initialValues?.footerText ?? ""}
          maxLength={280}
          rows={3}
          placeholder="Made with care by the Vayu Labs team."
          className="mt-1.5"
        />
        {errors.footerText && (
          <p className="mt-1 text-xs text-destructive">{errors.footerText}</p>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Link href="/brands">
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
