"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  ChevronDown,
  Mic,
  MicOff,
  Settings as SettingsIcon,
  Volume2,
  VolumeX,
  Circle as CircleIcon,
  Square as SquareIcon,
  RectangleHorizontal,
  Hexagon,
} from "lucide-react";
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
import { cn } from "@/lib/cn";
import type { BrandProfile } from "@/db/queries/brand-profiles";

type Props = {
  brands: BrandProfile[];
  onStart: (settings: RecordingSettings) => void;
};

const RESOLUTIONS: Resolution[] = ["1080p", "1440p", "4k"];
const SHAPES: { value: BubbleShape; label: string; Icon: typeof CircleIcon }[] = [
  { value: "circle", label: "Circle", Icon: CircleIcon },
  { value: "rounded-square", label: "Square", Icon: SquareIcon },
  { value: "rectangle", label: "Rect", Icon: RectangleHorizontal },
  { value: "hexagon", label: "Hex", Icon: Hexagon },
];
const SIZES: BubbleSize[] = ["small", "medium", "large"];

export function PreRecordForm({ brands, onStart }: Props) {
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT_SETTINGS);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    <div className="mx-auto max-w-md space-y-5">
      {settings.cameraEnabled && <BubblePreview settings={settings} />}

      <div className="grid grid-cols-3 gap-2">
        <Toggle
          on={settings.cameraEnabled}
          OnIcon={Camera}
          OffIcon={CameraOff}
          label={settings.cameraEnabled ? "Camera" : "No camera"}
          onClick={() => update("cameraEnabled", !settings.cameraEnabled)}
        />
        <Toggle
          on={settings.micEnabled}
          OnIcon={Mic}
          OffIcon={MicOff}
          label={settings.micEnabled ? "Mic" : "No mic"}
          onClick={() => update("micEnabled", !settings.micEnabled)}
        />
        <Toggle
          on={settings.systemAudioEnabled}
          OnIcon={Volume2}
          OffIcon={VolumeX}
          label="App audio"
          onClick={() =>
            update("systemAudioEnabled", !settings.systemAudioEnabled)
          }
        />
      </div>

      <Button
        onClick={() => onStart(settings)}
        variant="destructive"
        size="lg"
        className="w-full"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-white" aria-hidden />
        Start recording
      </Button>

      <p className="text-center text-xs text-text-subtle">
        You&apos;ll pick which window or screen to share next.
      </p>

      <p className="text-center text-[11px] leading-relaxed text-text-subtle/80">
        Tip: capturing the entire screen opens the bubble in a small floating
        window so it follows you across apps. The macOS desktop app (coming
        soon) replaces it with a seamless system overlay.
      </p>

      <AdvancedSettings
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((o) => !o)}
        settings={settings}
        update={update}
        brands={brands}
      />
    </div>
  );
}

function Toggle({
  on,
  OnIcon,
  OffIcon,
  label,
  onClick,
}: {
  on: boolean;
  OnIcon: typeof Camera;
  OffIcon: typeof Camera;
  label: string;
  onClick: () => void;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "group flex flex-col items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-all duration-150 active:scale-[0.98]",
        on
          ? "border-accent/50 bg-accent/10 text-text"
          : "border-border bg-bg-subtle text-text-subtle hover:text-text-muted"
      )}
    >
      <Icon className={cn("h-5 w-5", on ? "text-accent" : "text-text-subtle")} />
      <span>{label}</span>
    </button>
  );
}

function AdvancedSettings({
  open,
  onToggle,
  settings,
  update,
  brands,
}: {
  open: boolean;
  onToggle: () => void;
  settings: RecordingSettings;
  update: <K extends keyof RecordingSettings>(
    key: K,
    value: RecordingSettings[K]
  ) => void;
  brands: BrandProfile[];
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Animate height open/close. We measure scrollHeight on the inner div
  // and apply it as a CSS height — gives a smooth reveal without
  // resorting to grid-template-rows tricks.
  const [maxHeight, setMaxHeight] = useState<string>("0px");
  useEffect(() => {
    if (!contentRef.current) return;
    if (open) {
      const h = contentRef.current.scrollHeight;
      setMaxHeight(`${h}px`);
    } else {
      setMaxHeight("0px");
    }
  }, [open, settings.cameraEnabled, settings.micEnabled]);

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-text-muted hover:text-text"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <SettingsIcon className="h-3.5 w-3.5" />
          Advanced settings
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        style={{ maxHeight }}
        className="overflow-hidden transition-[max-height] duration-200 ease-out"
      >
        <div ref={contentRef} className="space-y-4 px-4 pb-4">
          <Field label="Resolution">
            <Segmented
              options={RESOLUTIONS.map((r) => ({
                value: r,
                label: r.toUpperCase(),
              }))}
              value={settings.resolution}
              onChange={(v) => update("resolution", v as Resolution)}
            />
            {settings.resolution === "4k" && (
              <p className="mt-1.5 text-[11px] text-text-subtle">
                4K uses significant CPU — drop to 1440p if you see dropped frames.
              </p>
            )}
          </Field>

          {settings.cameraEnabled && (
            <>
              <Field label="Bubble shape">
                <Segmented
                  options={SHAPES.map((s) => ({
                    value: s.value,
                    label: s.label,
                  }))}
                  value={settings.bubbleShape}
                  onChange={(v) => update("bubbleShape", v as BubbleShape)}
                />
              </Field>

              <Field label="Bubble size">
                <Segmented
                  options={SIZES.map((s) => ({ value: s, label: s }))}
                  value={settings.bubbleSize}
                  onChange={(v) => update("bubbleSize", v as BubbleSize)}
                />
              </Field>
            </>
          )}

          {(settings.micEnabled || settings.cameraEnabled) && (
            <Field label="Devices">
              <DevicePickers
                micDeviceId={settings.micDeviceId}
                cameraDeviceId={settings.cameraDeviceId}
                cameraEnabled={settings.cameraEnabled}
                onMicChange={(id) => update("micDeviceId", id)}
                onCameraChange={(id) => update("cameraDeviceId", id)}
              />
            </Field>
          )}

          <Field label="Brand profile (optional)">
            <Select
              value={settings.brandProfileId ?? ""}
              onChange={(e) =>
                update("brandProfileId", e.target.value || null)
              }
            >
              <option value="">None</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
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
          className={cn(
            "rounded-sm px-2.5 py-1 text-xs capitalize transition-colors",
            o.value === value
              ? "bg-bg-elevated text-text"
              : "text-text-subtle hover:text-text-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
