"use client";

import { useActionState } from "react";
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
          htmlFor="logoUrl"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          Logo URL{" "}
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            (optional)
          </span>
        </label>
        <Input
          id="logoUrl"
          name="logoUrl"
          type="url"
          defaultValue={initialValues?.logoUrl ?? ""}
          placeholder="https://vayulabs.com/logo.png"
          className="mt-1.5"
        />
        {errors.logoUrl && (
          <p className="mt-1 text-xs text-destructive">{errors.logoUrl}</p>
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
