"use client";

import { useCallback, useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import {
  listMediaDevices,
  primeDeviceLabels,
} from "@/lib/recording/capture-streams";

type Props = {
  micDeviceId: string | null;
  cameraDeviceId: string | null;
  cameraEnabled: boolean;
  onMicChange: (id: string | null) => void;
  onCameraChange: (id: string | null) => void;
};

type DeviceState = {
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  hasLabels: boolean;
  error: string | null;
};

export function DevicePickers({
  micDeviceId,
  cameraDeviceId,
  cameraEnabled,
  onMicChange,
  onCameraChange,
}: Props) {
  const [state, setState] = useState<DeviceState>({
    mics: [],
    cameras: [],
    hasLabels: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const { mics, cameras } = await listMediaDevices();
      const hasLabels = mics.some((m) => m.label) || cameras.some((c) => c.label);
      setState({ mics, cameras, hasLabels, error: null });
    } catch (err) {
      setState((s) => ({ ...s, error: String(err) }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, [refresh]);

  const unlock = useCallback(async () => {
    try {
      await primeDeviceLabels();
      await refresh();
    } catch (err) {
      setState((s) => ({ ...s, error: String(err) }));
    }
  }, [refresh]);

  return (
    <div className="space-y-3">
      <Picker
        label="Microphone"
        value={micDeviceId}
        devices={state.mics}
        hasLabels={state.hasLabels}
        onChange={onMicChange}
      />
      {cameraEnabled && (
        <Picker
          label="Camera"
          value={cameraDeviceId}
          devices={state.cameras}
          hasLabels={state.hasLabels}
          onChange={onCameraChange}
        />
      )}
      {!state.hasLabels && (
        <button
          type="button"
          onClick={() => void unlock()}
          className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text"
        >
          Show specific devices
        </button>
      )}
      {state.error && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
    </div>
  );
}

function Picker({
  label,
  value,
  devices,
  hasLabels,
  onChange,
}: {
  label: string;
  value: string | null;
  devices: MediaDeviceInfo[];
  hasLabels: boolean;
  onChange: (id: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-text-subtle">{label}</label>
      <Select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1"
      >
        <option value="">System default</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label ||
              (hasLabels
                ? `(unnamed ${d.kind})`
                : "Tap button below to load names")}
          </option>
        ))}
      </Select>
    </div>
  );
}
