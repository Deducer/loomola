"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

type Props = {
  name: string;
  defaultValue?: string;
  error?: string;
};

export function ColorSwatch({ name, defaultValue = "#7c3aed", error }: Props) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
      >
        Accent color
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <div
          aria-hidden="true"
          className="h-9 w-9 shrink-0 rounded-md border border-border-strong"
          style={{ background: value }}
        />
        <Input
          id={name}
          name={name}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="#7c3aed"
          className="flex-1 font-mono"
        />
        <input
          type="color"
          aria-label="Pick color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#7c3aed"}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded-md border border-border-strong bg-transparent"
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
