"use client";

import { useState } from "react";
import type {
  RecordingSettings,
  Resolution,
  BubbleShape,
  BubbleSize,
} from "@/lib/recording/types";
import { DEFAULT_SETTINGS } from "@/lib/recording/types";
import { BubblePreview } from "./bubble-preview";
import type { BrandProfile } from "@/db/queries/brand-profiles";

type Props = {
  brands: BrandProfile[];
  onStart: (settings: RecordingSettings) => void;
};

const RESOLUTIONS: Resolution[] = ["1080p", "1440p", "4k"];
const SHAPES: BubbleShape[] = ["circle", "rounded-square", "rectangle", "hexagon"];
const SIZES: BubbleSize[] = ["small", "medium", "large"];
const POSITIONS = [
  { label: "Top left", x: 0.08, y: 0.12 },
  { label: "Top right", x: 0.92, y: 0.12 },
  { label: "Bottom left", x: 0.08, y: 0.88 },
  { label: "Bottom right", x: 0.92, y: 0.88 },
];

export function PreRecordForm({ brands, onStart }: Props) {
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT_SETTINGS);

  const update = <K extends keyof RecordingSettings>(
    key: K,
    value: RecordingSettings[K]
  ) => setSettings((s) => ({ ...s, [key]: value }));

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <Group label="Resolution">
          <Segmented
            options={RESOLUTIONS.map((r) => ({ value: r, label: r.toUpperCase() }))}
            value={settings.resolution}
            onChange={(v) => update("resolution", v as Resolution)}
          />
          {settings.resolution === "4k" && (
            <p className="mt-1 text-xs opacity-60">
              4K uses significant CPU — if you see dropped frames, drop to 1440p.
            </p>
          )}
        </Group>

        <Group label="Camera">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.cameraEnabled}
              onChange={(e) => update("cameraEnabled", e.target.checked)}
            />
            Include camera bubble
          </label>
        </Group>

        {settings.cameraEnabled && (
          <>
            <Group label="Bubble shape">
              <Segmented
                options={SHAPES.map((s) => ({
                  value: s,
                  label: s === "rounded-square" ? "R-square" : s,
                }))}
                value={settings.bubbleShape}
                onChange={(v) => update("bubbleShape", v as BubbleShape)}
              />
            </Group>

            <Group label="Bubble size">
              <Segmented
                options={SIZES.map((s) => ({ value: s, label: s }))}
                value={settings.bubbleSize}
                onChange={(v) => update("bubbleSize", v as BubbleSize)}
              />
            </Group>

            <Group label="Bubble position">
              <div className="grid grid-cols-2 gap-2">
                {POSITIONS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() =>
                      update("bubblePosition", { x: p.x, y: p.y })
                    }
                    className={
                      Math.abs(settings.bubblePosition.x - p.x) < 0.01 &&
                      Math.abs(settings.bubblePosition.y - p.y) < 0.01
                        ? "rounded border border-white/60 px-3 py-1.5 text-xs"
                        : "rounded border border-white/15 px-3 py-1.5 text-xs hover:border-white/40"
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Group>
          </>
        )}

        <Group label="System audio">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.systemAudioEnabled}
              onChange={(e) => update("systemAudioEnabled", e.target.checked)}
            />
            Capture audio from apps (Chrome only; you&apos;ll be asked to share
            a tab or the whole screen with audio)
          </label>
        </Group>

        <Group label="Brand profile (optional)">
          <select
            value={settings.brandProfileId ?? ""}
            onChange={(e) =>
              update("brandProfileId", e.target.value || null)
            }
            className="w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/40"
          >
            <option value="">None</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Group>
      </div>

      <div className="space-y-4">
        <Group label="Preview">
          <BubblePreview settings={settings} />
        </Group>

        <button
          type="button"
          onClick={() => onStart(settings)}
          className="w-full rounded bg-red-500/90 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Start recording
        </button>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded border border-white/15 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            o.value === value
              ? "rounded bg-white/90 px-3 py-1.5 text-xs capitalize text-black"
              : "rounded px-3 py-1.5 text-xs capitalize opacity-70 hover:opacity-100"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
