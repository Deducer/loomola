"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  RecorderState,
  RecordingSettings,
  RecordingResult,
  TrackKind,
} from "@/lib/recording/types";
import {
  startRecording,
  type RecorderHandle,
} from "@/lib/recording/recorder";
import { CaptureError } from "@/lib/recording/capture-streams";
import {
  createUploadCoordinator,
  type UploadCoordinator,
  type TrackUploadInit,
} from "@/lib/recording/upload-coordinator";
import type { BrandProfile } from "@/db/queries/brand-profiles";
import { PreRecordForm } from "./pre-record-form";
import { Countdown } from "./countdown";
import { RecordingHud } from "./recording-hud";
import { FinishedView } from "./finished-view";
import { UploadProgress } from "./upload-progress";

type Action =
  | { type: "start-countdown"; settings: RecordingSettings }
  | { type: "begin-recording"; startedAt: number }
  | { type: "begin-upload" }
  | { type: "upload-progress"; progress: number }
  | { type: "finish"; slug: string; result: RecordingResult }
  | { type: "error"; message: string }
  | { type: "reset" };

function reducer(state: RecorderState, action: Action): RecorderState {
  switch (action.type) {
    case "start-countdown":
      return { kind: "countdown", secondsLeft: 3 };
    case "begin-recording":
      return { kind: "recording", startedAt: action.startedAt };
    case "begin-upload":
      return { kind: "uploading", progress: 0 };
    case "upload-progress":
      return state.kind === "uploading"
        ? { kind: "uploading", progress: action.progress }
        : state;
    case "finish":
      return { kind: "finished", slug: action.slug, result: action.result };
    case "error":
      return { kind: "error", message: action.message };
    case "reset":
      return { kind: "idle" };
  }
}

export function RecordFlow({ brands }: { brands: BrandProfile[] }) {
  const [state, dispatch] = useReducer(reducer, { kind: "idle" } as RecorderState);
  const handleRef = useRef<RecorderHandle | null>(null);
  const coordinatorRef = useRef<UploadCoordinator | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const pendingSettingsRef = useRef<RecordingSettings | null>(null);

  const onStart = useCallback((settings: RecordingSettings) => {
    pendingSettingsRef.current = settings;
    dispatch({ type: "start-countdown", settings });
  }, []);

  const onCountdownDone = useCallback(async () => {
    const settings = pendingSettingsRef.current;
    if (!settings) return;
    try {
      const tracksRequested: Array<{ kind: TrackKind; mimeType: string }> = [
        { kind: "composite", mimeType: "video/webm;codecs=vp9,opus" },
        { kind: "screen", mimeType: "video/webm;codecs=vp9,opus" },
        { kind: "mic", mimeType: "audio/webm;codecs=opus" },
      ];
      if (settings.cameraEnabled) {
        tracksRequested.push({
          kind: "camera",
          mimeType: "video/webm;codecs=vp9,opus",
        });
      }
      if (settings.systemAudioEnabled) {
        tracksRequested.push({
          kind: "system-audio",
          mimeType: "audio/webm;codecs=opus",
        });
      }

      const startRes = await fetch("/api/recordings/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: tracksRequested,
          resolution: settings.resolution,
          brandProfileId: settings.brandProfileId,
        }),
      });
      if (!startRes.ok) {
        throw new Error(`start failed: ${startRes.status}`);
      }
      const startData = (await startRes.json()) as {
        recordingId: string;
        slug: string;
        uploads: Partial<Record<TrackKind, { key: string; uploadId: string }>>;
      };

      recordingIdRef.current = startData.recordingId;

      const inits: TrackUploadInit[] = [];
      for (const t of tracksRequested) {
        const u = startData.uploads[t.kind];
        if (u) inits.push({ kind: t.kind, key: u.key, uploadId: u.uploadId });
      }

      const coordinator = createUploadCoordinator(
        inits,
        async (track, partNumber) => {
          const res = await fetch(
            `/api/recordings/${startData.recordingId}/part-url`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ track, partNumber }),
            }
          );
          if (!res.ok) throw new Error(`part-url failed: ${res.status}`);
          const data = (await res.json()) as { url: string };
          return data.url;
        }
      );
      coordinatorRef.current = coordinator;

      const handle = await startRecording({ settings, coordinator });
      handleRef.current = handle;
      dispatch({ type: "begin-recording", startedAt: performance.now() });
    } catch (err) {
      const message =
        err instanceof CaptureError
          ? err.message
          : `Failed to start recording: ${String(err)}`;
      dispatch({ type: "error", message });
    }
  }, []);

  const onStop = useCallback(async () => {
    const handle = handleRef.current;
    const coordinator = coordinatorRef.current;
    const recordingId = recordingIdRef.current;
    if (!handle || !coordinator || !recordingId) return;

    // Prevent duplicate work if the user mashes the stop button.
    handleRef.current = null;

    let result;
    try {
      result = await handle.stop();
    } catch (err) {
      await fetch(`/api/recordings/${recordingId}/abort`, { method: "POST" })
        .catch(() => {});
      dispatch({
        type: "error",
        message: `Failed to finalise recording: ${String(err)}`,
      });
      return;
    }

    dispatch({ type: "begin-upload" });
    const unsubscribe = coordinator.onProgress((progress) => {
      dispatch({ type: "upload-progress", progress });
    });

    try {
      const completed = coordinator.getCompletedParts();
      const res = await fetch(`/api/recordings/${recordingId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: completed,
          durationSeconds: result.durationSeconds,
        }),
      });
      if (!res.ok) throw new Error(`complete failed: ${res.status}`);
      const data = (await res.json()) as { slug: string };
      unsubscribe();
      dispatch({ type: "finish", slug: data.slug, result });
    } catch (err) {
      unsubscribe();
      await fetch(`/api/recordings/${recordingId}/abort`, { method: "POST" })
        .catch(() => {});
      dispatch({
        type: "error",
        message: `Upload failed: ${String(err)}`,
      });
    }
  }, []);

  const onReset = useCallback(() => {
    handleRef.current = null;
    coordinatorRef.current = null;
    recordingIdRef.current = null;
    pendingSettingsRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  if (state.kind === "idle") {
    return <PreRecordForm brands={brands} onStart={onStart} />;
  }
  if (state.kind === "countdown") {
    return <Countdown seconds={state.secondsLeft} onComplete={onCountdownDone} />;
  }
  if (state.kind === "recording") {
    return <RecordingHud startedAt={state.startedAt} onStop={onStop} />;
  }
  if (state.kind === "uploading") {
    return <UploadProgress progress={state.progress} />;
  }
  if (state.kind === "finished") {
    return <FinishedView slug={state.slug} result={state.result} onReset={onReset} />;
  }
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Couldn&apos;t complete recording</h2>
      <p className="text-sm opacity-70">{state.message}</p>
      <button
        type="button"
        onClick={onReset}
        className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
      >
        Try again
      </button>
    </div>
  );
}
