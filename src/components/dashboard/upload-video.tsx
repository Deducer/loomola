"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  formatBytes,
  pickDroppedVideo,
  validateVideoFile,
} from "@/lib/upload/validate-video-file";
import { readVideoDuration } from "@/lib/upload/read-video-duration";
import {
  UploadAbortedError,
  uploadVideoFile,
} from "@/lib/upload/upload-video-file";

type UploadState =
  | { kind: "idle" }
  | { kind: "probing"; file: File }
  | { kind: "uploading"; file: File; progress: number }
  | { kind: "cancelling"; file: File }
  | { kind: "finishing"; file: File };

type UploadContextValue = {
  state: UploadState;
  openPicker: () => void;
  cancel: () => void;
};

const UploadContext = createContext<UploadContextValue | null>(null);

function useUploadContext(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("UploadVideoProvider is missing above this component");
  return ctx;
}

/**
 * Owns one dashboard upload at a time: the hidden file input, the
 * page-wide drop target, the progress card and the cancel path.
 *
 * `folderId` is the sidebar's current folder (null = unfiled, undefined =
 * "all"), so a file dropped while browsing a folder lands in that folder.
 */
export function UploadVideoProvider({
  folderId,
  enabled = true,
  children,
}: {
  folderId: string | null | undefined;
  /** False on tabs where a dropped video makes no sense (Notes). */
  enabled?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  // Counter instead of a boolean: dragenter/dragleave fire for every child
  // element the cursor crosses, so a boolean flickers. A watchdog clears the
  // overlay if dragover stops firing (drag cancelled with Esc, dropped on
  // another window, or a dragleave the browser never delivered).
  const dragDepth = useRef(0);
  const dragWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = state.kind !== "idle";

  const startUpload = useCallback(
    async (file: File) => {
      if (abortRef.current) {
        toast.error("An upload is already in progress.");
        return;
      }
      const check = validateVideoFile(file);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setState({ kind: "probing", file });

      try {
        const duration = await readVideoDuration(file);
        if (controller.signal.aborted) throw new UploadAbortedError();
        if (duration === null) {
          throw new Error(
            "Chrome couldn't read this video. Re-export it as H.264 MP4 and try again."
          );
        }

        setState({ kind: "uploading", file, progress: 0 });
        const result = await uploadVideoFile({
          file,
          mimeType: check.mimeType,
          title: check.title,
          durationSeconds: duration,
          folderId: folderId ?? null,
          signal: controller.signal,
          onProgress: (progress) =>
            setState((s) =>
              s.kind === "uploading" ? { ...s, progress } : s
            ),
        });

        setState({ kind: "finishing", file });
        toast.success("Uploaded. Processing the video now.");
        router.push(`/recordings/${result.recordingId}/edit`);
        router.refresh();
      } catch (err) {
        // Any failure after the user hit cancel is the cancel, whatever
        // shape it arrived in (our marker error, or a raw fetch AbortError
        // from the start / folder / complete calls).
        if (err instanceof UploadAbortedError || controller.signal.aborted) {
          toast("Upload cancelled.");
        } else {
          console.error("[upload-video]", err);
          toast.error(
            err instanceof Error ? err.message : "Upload failed. Try again."
          );
        }
      } finally {
        abortRef.current = null;
        setState({ kind: "idle" });
      }
    },
    [folderId, router]
  );

  const openPicker = useCallback(() => {
    if (busy) return;
    inputRef.current?.click();
  }, [busy]);

  const cancel = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    setState((s) =>
      s.kind === "idle" || s.kind === "finishing" ? s : { kind: "cancelling", file: s.file }
    );
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so picking the same file twice in a row still fires onChange.
      e.target.value = "";
      if (file) void startUpload(file);
    },
    [startUpload]
  );

  // Page-wide drop target. Only reacts to drags that carry files, so
  // dragging a recording card onto a folder (the existing DnD) is untouched.
  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const clearDrag = () => {
      dragDepth.current = 0;
      if (dragWatchdog.current) clearTimeout(dragWatchdog.current);
      dragWatchdog.current = null;
      setDragging(false);
    };
    const armWatchdog = () => {
      if (dragWatchdog.current) clearTimeout(dragWatchdog.current);
      dragWatchdog.current = setTimeout(clearDrag, 400);
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
      armWatchdog();
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = busy ? "none" : "copy";
      armWatchdog();
    };
    const onDragLeave = (e: DragEvent) => {
      // Leaving the window: relatedTarget is null. Don't gate on hasFiles
      // here, some browsers strip dataTransfer.types on leave.
      if (e.relatedTarget === null) {
        clearDrag();
        return;
      }
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) clearDrag();
    };
    const onDragEnd = () => clearDrag();
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      clearDrag();
      if (busy) {
        toast.error("An upload is already in progress.");
        return;
      }
      const files = Array.from(e.dataTransfer?.files ?? []);
      const picked = pickDroppedVideo(files);
      if (!picked.ok) {
        toast.error(picked.reason);
        return;
      }
      void startUpload(files[0]);
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("drop", onDrop);
      clearDrag();
    };
  }, [busy, enabled, startUpload]);

  // Don't let a tab close silently kill a half-finished upload.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const value = useMemo(
    () => ({ state, openPicker, cancel }),
    [state, openPicker, cancel]
  );

  return (
    <UploadContext.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.mov,.webm"
        className="hidden"
        onChange={onInputChange}
        aria-hidden
        tabIndex={-1}
      />
      {dragging && !busy ? <DropOverlay /> : null}
      {busy ? <UploadProgressCard state={state} onCancel={cancel} /> : null}
    </UploadContext.Provider>
  );
}

/** Header button next to "New recording". */
export function UploadVideoButton({ className }: { className?: string }) {
  const { openPicker, state } = useUploadContext();
  return (
    <Button
      variant="outline"
      onClick={openPicker}
      disabled={state.kind !== "idle"}
      className={cn(
        "border-border-strong bg-bg-subtle text-text hover:bg-bg-elevated",
        className
      )}
    >
      <Upload className="h-4 w-4" />
      Upload video
    </Button>
  );
}

function DropOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      aria-hidden
    >
      <div className="rounded-2xl border-2 border-dashed border-accent bg-bg-subtle px-10 py-8 text-center shadow-xl">
        <Upload className="mx-auto h-8 w-8 text-accent" />
        <p className="mt-3 text-base font-semibold text-text">Drop to upload</p>
        <p className="mt-1 text-sm text-text-muted">MP4, MOV or WebM, up to 2 GB</p>
      </div>
    </div>
  );
}

function UploadProgressCard({
  state,
  onCancel,
}: {
  state: Exclude<UploadState, { kind: "idle" }>;
  onCancel: () => void;
}) {
  const percent =
    state.kind === "uploading"
      ? Math.round(state.progress * 100)
      : state.kind === "finishing"
        ? 100
        : 0;
  const label =
    state.kind === "probing"
      ? "Reading video…"
      : state.kind === "cancelling"
        ? "Cancelling…"
        : state.kind === "finishing"
          ? "Finishing up…"
          : `Uploading ${percent}%`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-xl border border-border bg-bg-elevated p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text" title={state.file.name}>
            {state.file.name}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {label} · {formatBytes(state.file.size)}
          </p>
        </div>
        {state.kind !== "finishing" && state.kind !== "cancelling" ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
            aria-label="Cancel upload"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div
          className={cn(
            "h-full rounded-full bg-accent transition-[width] duration-200",
            (state.kind === "probing" || state.kind === "cancelling") && "animate-pulse"
          )}
          style={{ width: `${state.kind === "probing" ? 8 : state.kind === "cancelling" ? 100 : percent}%` }}
        />
      </div>
    </div>
  );
}
