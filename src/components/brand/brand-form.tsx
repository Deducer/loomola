"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Monitor, Moon, Sun } from "lucide-react";
import { ColorSwatch } from "./color-swatch";
import { LogoPicker } from "./logo-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
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
  const initialLight = initialValues?.logoUrl ?? null;
  const initialDark = initialValues?.logoUrlDark ?? null;

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
        <div className="grid gap-4 sm:grid-cols-2">
          <LogoPicker
            name="logoFile"
            label="Logo (light mode)"
            initialPreviewUrl={initialLight}
            variant="light"
          />
          <LogoPicker
            name="logoFileDark"
            label="Logo (dark mode)"
            sublabel="(falls back to light)"
            initialPreviewUrl={initialDark}
            variant="dark"
          />
        </div>
        <p className="mt-2 text-xs text-text-subtle">
          PNG, JPG, WebP, or SVG · up to 2 MB
        </p>
        {errors.logo && (
          <p className="mt-1 text-xs text-destructive">{errors.logo}</p>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <h2 className="text-sm font-semibold text-text">Page theming</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Applied automatically on every share page assigned to this brand.
          Tagline appears under the logo, font family is loaded from Google
          Fonts and applied page-wide, the CTA renders as a pill in the
          header (visible to viewers, hidden for you as the owner), and
          footer text shows at the bottom of the page.
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

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted">
          Default theme{" "}
          <span className="font-normal normal-case tracking-normal text-text-subtle">
            (optional)
          </span>
        </label>
        <div className="mt-1.5">
          <DefaultThemePicker
            initial={
              initialValues?.defaultTheme === "light" ||
              initialValues?.defaultTheme === "dark"
                ? initialValues.defaultTheme
                : null
            }
          />
        </div>
        <p className="mt-1.5 text-xs text-text-subtle">
          Applied to share pages on a visitor&apos;s first load. They can still toggle to their preferred theme; the choice persists for that visitor.
        </p>
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

function DefaultThemePicker({ initial }: { initial: "light" | "dark" | null }) {
  const [value, setValue] = useState<"auto" | "light" | "dark">(
    initial ?? "auto"
  );
  const options: Array<{
    v: "auto" | "light" | "dark";
    label: string;
    Icon: typeof Sun;
  }> = [
    { v: "auto", label: "Auto", Icon: Monitor },
    { v: "light", label: "Light", Icon: Sun },
    { v: "dark", label: "Dark", Icon: Moon },
  ];
  return (
    <>
      <input
        type="hidden"
        name="defaultTheme"
        value={value === "auto" ? "" : value}
      />
      <div className="inline-flex rounded-md border border-border p-0.5">
        {options.map(({ v, label, Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => setValue(v)}
            aria-pressed={value === v}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
              value === v
                ? "bg-bg-elevated text-text"
                : "text-text-subtle hover:text-text-muted"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
