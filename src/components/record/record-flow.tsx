"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  RecorderState,
  RecordingSettings,
  RecordingResult,
} from "@/lib/recording/types";
import {
  startRecording,
  type RecorderHandle,
} from "@/lib/recording/recorder";
import { CaptureError } from "@/lib/recording/capture-streams";
import type { BrandProfile } from "@/db/queries/brand-profiles";
import { PreRecordForm } from "./pre-record-form";
import { Countdown } from "./countdown";
import { RecordingHud } from "./recording-hud";
import { FinishedView } from "./finished-view";

type Action =
  | { type: "start-countdown"; settings: RecordingSettings }
  | { type: "begin-recording"; startedAt: number }
  | { type: "finish"; result: RecordingResult }
  | { type: "error"; message: string }
  | { type: "reset" };

function reducer(state: RecorderState, action: Action): RecorderState {
  switch (action.type) {
    case "start-countdown":
      return { kind: "countdown", secondsLeft: 3 };
    case "begin-recording":
      return { kind: "recording", startedAt: action.startedAt };
    case "finish":
      return { kind: "finished", result: action.result };
    case "error":
      return { kind: "error", message: action.message };
    case "reset":
      return { kind: "idle" };
  }
}

export function RecordFlow({ brands }: { brands: BrandProfile[] }) {
  const [state, dispatch] = useReducer(reducer, { kind: "idle" } as RecorderState);
  const handleRef = useRef<RecorderHandle | null>(null);
  const pendingSettingsRef = useRef<RecordingSettings | null>(null);

  const onStart = useCallback((settings: RecordingSettings) => {
    pendingSettingsRef.current = settings;
    dispatch({ type: "start-countdown", settings });
  }, []);

  const onCountdownDone = useCallback(async () => {
    const settings = pendingSettingsRef.current;
    if (!settings) return;
    try {
      const handle = await startRecording(settings);
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
    if (!handle) return;
    const result = await handle.stop();
    handleRef.current = null;
    dispatch({ type: "finish", result });
  }, []);

  const onReset = useCallback(() => {
    handleRef.current = null;
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
  if (state.kind === "finished") {
    return <FinishedView result={state.result} onReset={onReset} />;
  }
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Couldn&apos;t start recording</h2>
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
