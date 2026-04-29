"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  RecorderState,
  RecordingSettings,
  RecordingResult,
  TrackKind,
} from "@/lib/recording/types";
import {
  prepareRecording,
  type RecorderHandle,
  type PreparedRecording,
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
import { ExtensionBridge } from "./extension-bridge";

type Action =
  | { type: "begin-preparing" }
  | { type: "start-countdown"; settings: RecordingSettings }
  | { type: "begin-recording"; startedAt: number }
  | { type: "begin-upload" }
  | { type: "upload-progress"; progress: number }
  | { type: "finish"; slug: string; result: RecordingResult }
  | { type: "error"; message: string }
  | { type: "reset" };

function reducer(state: RecorderState, action: Action): RecorderState {
  switch (action.type) {
    case "begin-preparing":
      return { kind: "preparing" };
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
  const preparedRef = useRef<PreparedRecording | null>(null);
  const coordinatorRef = useRef<UploadCoordinator | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const pendingSettingsRef = useRef<RecordingSettings | null>(null);

  // 1. PREPARE: provision the server-side row + multipart uploads, build the
  // coordinator, then acquire streams (Chrome permission prompts). After
  // preparation, transition to countdown — so 3-2-1 actually counts down to
  // recording, not to permission prompts.
  const onStart = useCallback(async (settings: RecordingSettings) => {
    pendingSettingsRef.current = settings;
    dispatch({ type: "begin-preparing" });
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

      // Acquire streams + wire MediaRecorders to the coordinator (Chrome
      // permission prompts happen here). Single prepare call, single set of
      // prompts — done before the countdown begins.
      const prepared = await prepareRecording({ settings, coordinator });
      preparedRef.current = prepared;

      dispatch({ type: "start-countdown", settings });
    } catch (err) {
      const message =
        err instanceof CaptureError
          ? err.message
          : `Failed to start recording: ${String(err)}`;
      // Best-effort cleanup of the server-side row if API succeeded but we
      // failed to acquire streams.
      const id = recordingIdRef.current;
      if (id) {
        await fetch(`/api/recordings/${id}/abort`, { method: "POST" }).catch(
          () => {}
        );
      }
      dispatch({ type: "error", message });
    }
  }, []);

  // 2. COUNTDOWN DONE: streams are already live; just kick off the
  // MediaRecorders. We swap the UI to the recording HUD FIRST and wait two
  // animation frames for the browser to paint, so MediaRecorders never
  // capture a lingering countdown frame (which used to leak into the
  // generated thumbnail at t=1s). Then we start the recorders.
  const onCountdownDone = useCallback(async () => {
    const prepared = preparedRef.current;
    if (!prepared) {
      dispatch({ type: "error", message: "Internal error: recording not prepared" });
      return;
    }
    dispatch({ type: "begin-recording", startedAt: performance.now() });
    // Yield two frames so React paints the post-countdown state (Countdown
    // unmounted, RecordingHud mounted) before we start capturing canvas
    // frames. Otherwise the first ~16ms of the recording is the still-
    // visible "1" — and ffmpeg's t=1s thumbnail extraction grabs it.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve())
      )
    );
    try {
      const handle = prepared.start();
      handleRef.current = handle;
    } catch (err) {
      dispatch({
        type: "error",
        message: `Failed to start recording: ${String(err)}`,
      });
    }
  }, []);

  const onStop = useCallback(async () => {
    const handle = handleRef.current;
    const coordinator = coordinatorRef.current;
    const recordingId = recordingIdRef.current;
    if (!handle || !coordinator || !recordingId) return;

    // Prevent duplicate work if the user mashes the stop button.
    handleRef.current = null;

    // Transition to the upload screen IMMEDIATELY so the click feels
    // responsive. handle.stop() takes 500ms–2s to flush final chunks
    // from the five MediaRecorders; without this the HUD stays
    // visible and the user assumes the click didn't register and
    // hammers the button.
    dispatch({ type: "begin-upload" });
    const unsubscribe = coordinator.onProgress((progress) => {
      dispatch({ type: "upload-progress", progress });
    });

    let result;
    try {
      result = await handle.stop();
    } catch (err) {
      unsubscribe();
      await fetch(`/api/recordings/${recordingId}/abort`, { method: "POST" })
        .catch(() => {});
      dispatch({
        type: "error",
        message: `Failed to finalise recording: ${String(err)}`,
      });
      return;
    }

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
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail =
          body && typeof body === "object"
            ? body.error
              ? `${body.error}${body.message ? ` — ${body.message}` : ""}${
                  Array.isArray(body.details)
                    ? ` (${body.details
                        .map(
                          (d: { kind?: string; message?: string }) =>
                            `${d.kind ?? "?"}: ${d.message ?? "?"}`
                        )
                        .join(", ")})`
                    : ""
                }`
              : JSON.stringify(body)
            : `status ${res.status}`;
        throw new Error(`complete failed: ${detail}`);
      }
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
    preparedRef.current = null;
    coordinatorRef.current = null;
    recordingIdRef.current = null;
    pendingSettingsRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  // Settings + prepared are stable across the countdown → recording
  // transition; rendering ExtensionBridge in BOTH states means the
  // extension's frameless bubble appears during the 3-2-1 countdown so
  // the user can see + reposition it BEFORE recording starts. Same camera
  // stream, same position controller, no remount — so the bubble is
  // continuous across the state transition.
  const settings = pendingSettingsRef.current;
  const prepared = preparedRef.current;
  const showExtensionBridge =
    (state.kind === "countdown" || state.kind === "recording") &&
    !!settings?.cameraEnabled &&
    !!prepared;

  const extensionBridge = showExtensionBridge && settings && prepared && (
    <ExtensionBridge
      bubbleShape={settings.bubbleShape}
      bubbleSize={settings.bubbleSize}
      positionController={prepared.positionController}
    />
  );

  if (state.kind === "idle") {
    return <PreRecordForm brands={brands} onStart={onStart} />;
  }
  if (state.kind === "preparing") {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-bg-subtle p-8 text-center">
        <h2 className="text-base font-semibold text-text">Setting up</h2>
        <p className="mt-2 text-sm text-text-muted">
          Pick the screen, camera, and mic when prompted by your browser.
        </p>
      </div>
    );
  }
  if (state.kind === "countdown") {
    return (
      <>
        <Countdown
          seconds={state.secondsLeft}
          onComplete={onCountdownDone}
          cameraStream={prepared?.cameraStream ?? null}
        />
        {extensionBridge}
      </>
    );
  }
  if (state.kind === "recording") {
    return (
      <>
        <RecordingHud
          startedAt={state.startedAt}
          onStop={onStop}
        />
        {extensionBridge}
      </>
    );
  }
  if (state.kind === "uploading") {
    return <UploadProgress progress={state.progress} />;
  }
  if (state.kind === "finished") {
    return <FinishedView slug={state.slug} result={state.result} onReset={onReset} />;
  }
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-border bg-bg-subtle p-8 text-center">
      <h2 className="text-lg font-semibold text-text">
        Couldn&apos;t complete recording
      </h2>
      <p className="text-sm text-text-muted">{state.message}</p>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-border-strong px-4 py-2 text-sm text-text-muted hover:bg-bg-elevated hover:text-text"
      >
        Try again
      </button>
    </div>
  );
}
