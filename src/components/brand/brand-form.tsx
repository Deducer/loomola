"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ColorSwatch } from "./color-swatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
