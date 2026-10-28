import {
  createUploadCoordinator,
  type CompletedPart,
} from "@/lib/recording/upload-coordinator";

export type UploadVideoOptions = {
  file: File;
  mimeType: "video/mp4" | "video/webm";
  title: string;
  durationSeconds: number;
  /** Folder to file the recording in; null = unfiled. */
  folderId: string | null;
  signal: AbortSignal;
  onProgress: (ratio: number) => void;
};

export type UploadVideoResult = { recordingId: string; slug: string };

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${path} failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

/**
 * Upload one local video file as a finished recording, using the same
 * start / part-url / complete flow as the in-browser recorder, so the
 * post-upload pipeline (transcode, thumbnail, sprite, transcript, AI title)
 * runs unchanged. On any failure after `start`, the recording is aborted
 * server-side so no ghost row is left behind.
 */
export async function uploadVideoFile(
  opts: UploadVideoOptions
): Promise<UploadVideoResult> {
  const { file, mimeType, title, durationSeconds, folderId, signal, onProgress } = opts;

  const throwIfAborted = () => {
    if (signal.aborted) throw new UploadAbortedError();
  };

  throwIfAborted();
  // Deliberately NOT abortable: if the user cancels while this request is in
  // flight, the server may already have created the row and opened the R2
  // multipart upload. Let it finish so we always hold an id to abort, then
  // the throwIfAborted() below routes into the abort path.
  const start = await postJson<{
    recordingId: string;
    slug: string;
    uploads: Partial<Record<"composite", { key: string; uploadId: string }>>;
  }>("/api/recordings/start", {
    type: "video",
    tracks: [{ kind: "composite", mimeType }],
    brandProfileId: null,
    title,
  });

  const composite = start.uploads.composite;
  if (!composite) throw new Error("Server did not open a composite upload");

  const abortServerSide = () =>
    fetch(`/api/recordings/${start.recordingId}/abort`, { method: "POST" }).catch(
      () => {}
    );

  try {
    throwIfAborted();

    // File the recording first so it shows up in the right folder the moment
    // the dashboard refreshes, instead of appearing unfiled for a beat.
    if (folderId) {
      const res = await fetch(`/api/recordings/${start.recordingId}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
        signal,
      });
      if (!res.ok) throw new Error(`Could not file into folder (${res.status})`);
    }

    const coordinator = createUploadCoordinator(
      [{ kind: "composite", key: composite.key, uploadId: composite.uploadId }],
      async (track, partNumber) => {
        throwIfAborted();
        const data = await postJson<{ url: string }>(
          `/api/recordings/${start.recordingId}/part-url`,
          { track, partNumber },
          signal
        );
        return data.url;
      },
      { signal }
    );
    const unsubscribe = coordinator.onProgress(onProgress);

    // A File is a Blob; the coordinator slices it lazily into equal parts
    // without reading the whole thing into memory.
    coordinator.pushChunk("composite", file);
    try {
      await coordinator.finalize("composite");
    } finally {
      unsubscribe();
    }
    throwIfAborted();

    const parts: CompletedPart[] = coordinator.getCompletedParts().composite ?? [];
    const done = await postJson<{ slug: string }>(
      `/api/recordings/${start.recordingId}/complete`,
      { tracks: { composite: parts }, durationSeconds },
      signal
    );
    return { recordingId: start.recordingId, slug: done.slug };
  } catch (err) {
    await abortServerSide();
    if (signal.aborted) throw new UploadAbortedError();
    throw err;
  }
}
