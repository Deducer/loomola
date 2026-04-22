"use client";

import { useState } from "react";

type Props = {
  name: string;
  defaultValue?: string;
  error?: string;
};

export function ColorSwatch({ name, defaultValue = "#4F46E5", error }: Props) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div>
      <label htmlFor={name} className="block text-sm">
        Accent color
      </label>
      <div className="mt-1 flex items-center gap-2">
        <div
          aria-hidden="true"
          className="h-10 w-10 shrink-0 rounded border border-white/20"
          style={{ background: value }}
        />
        <input
          id={name}
          name={name}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="#FF6B35"
          className="flex-1 rounded border border-white/20 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-white/40"
        />
        <input
          type="color"
          aria-label="Pick color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#4F46E5"}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}
