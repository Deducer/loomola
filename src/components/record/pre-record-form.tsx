"use client";

import { useEffect, useState } from "react";
import type {
  RecordingSettings,
  Resolution,
  BubbleShape,
  BubbleSize,
} from "@/lib/recording/types";
import { DEFAULT_SETTINGS } from "@/lib/recording/types";
import { BubblePreview } from "./bubble-preview";
import { DevicePickers } from "./device-pickers";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
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
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const ok =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    setSupported(ok);
  }, []);

  const update = <K extends keyof RecordingSettings>(
    key: K,
    value: RecordingSettings[K]
  ) => setSettings((s) => ({ ...s, [key]: value }));

  if (supported === false) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-bg-subtle p-6 text-center">
        <h2 className="text-lg font-semibold text-text">
          Recording isn&apos;t supported on this browser
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Screen capture requires{" "}
          <code className="rounded bg-bg-elevated px-1 font-mono text-xs">
            getDisplayMedia
          </code>
          , which isn&apos;t available on mobile browsers or iOS Safari. Open
          this page on desktop Chrome (or a Chromium-based browser on macOS /
          Windows / Linux) to record.
        </p>
        <p className="mt-3 text-xs text-text-subtle">
          The macOS menubar app (Stage 2) will eventually remove the browser
          dependency entirely.
        </p>
      </div>
    );
  }

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
            <p className="mt-1.5 text-xs text-text-subtle">
              4K uses significant CPU — if you see dropped frames, drop to 1440p.
            </p>
          )}
        </Group>

        <Group label="Camera">
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={settings.cameraEnabled}
              onChange={(e) => update("cameraEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-border-strong bg-bg-subtle"
              style={{ accentColor: "var(--accent)" }}
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
                {POSITIONS.map((p) => {
                  const active =
                    Math.abs(settings.bubblePosition.x - p.x) < 0.01 &&
                    Math.abs(settings.bubblePosition.y - p.y) < 0.01;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() =>
                        update("bubblePosition", { x: p.x, y: p.y })
                      }
                      className={
                        active
                          ? "rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs text-text"
                          : "rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:border-border-strong hover:text-text"
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </Group>
          </>
        )}

        <Group label="System audio">
          <label className="flex items-start gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={settings.systemAudioEnabled}
              onChange={(e) => update("systemAudioEnabled", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border-strong bg-bg-subtle"
              style={{ accentColor: "var(--accent)" }}
            />
            <span>
              Capture audio from apps (Chrome only; you&apos;ll be asked to
              share a tab or the whole screen with audio)
            </span>
          </label>
        </Group>

        <Group label="Devices">
          <DevicePickers
            micDeviceId={settings.micDeviceId}
            cameraDeviceId={settings.cameraDeviceId}
            cameraEnabled={settings.cameraEnabled}
            onMicChange={(id) => update("micDeviceId", id)}
            onCameraChange={(id) => update("cameraDeviceId", id)}
          />
        </Group>

        <Group label="Brand profile (optional)">
          <Select
            value={settings.brandProfileId ?? ""}
            onChange={(e) => update("brandProfileId", e.target.value || null)}
          >
            <option value="">None</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Group>
      </div>

      <div className="space-y-4">
        <Group label="Preview">
          <BubblePreview settings={settings} />
        </Group>

        <Button
          onClick={() => onStart(settings)}
          variant="destructive"
          size="lg"
          className="w-full"
        >
          Start recording
        </Button>
      </div>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </div>
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
    <div className="inline-flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            o.value === value
              ? "rounded-sm bg-bg-elevated px-3 py-1.5 text-xs capitalize text-text"
              : "rounded-sm px-3 py-1.5 text-xs capitalize text-text-subtle hover:text-text-muted"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
