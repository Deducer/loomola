"use client";

import { useActionState } from "react";
import { ColorSwatch } from "./color-swatch";
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
        <label htmlFor="name" className="block text-sm">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initialValues?.name ?? ""}
          maxLength={60}
          placeholder="Vayu Labs"
          className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
        />
        {errors.name && <p className="mt-1 text-xs text-red-300">{errors.name}</p>}
      </div>

      <ColorSwatch
        name="accentColor"
        defaultValue={initialValues?.accentColor ?? "#4F46E5"}
        error={errors.accentColor}
      />

      <div>
        <label htmlFor="logoUrl" className="block text-sm">
          Logo URL <span className="opacity-60">(optional)</span>
        </label>
        <input
          id="logoUrl"
          name="logoUrl"
          type="url"
          defaultValue={initialValues?.logoUrl ?? ""}
          placeholder="https://vayulabs.com/logo.png"
          className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
        />
        {errors.logoUrl && <p className="mt-1 text-xs text-red-300">{errors.logoUrl}</p>}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <a
          href="/brands"
          className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
