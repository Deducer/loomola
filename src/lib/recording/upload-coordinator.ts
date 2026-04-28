import type { TrackKind } from "./types";

const TARGET_PART_SIZE = 8 * 1024 * 1024; // 8MB per part; S3 requires >=5MB except last

/**
 * Slice an ordered list of Blobs into two groups: the first contains exactly
 * `target` bytes (splitting a Blob if needed), the second contains the rest.
 * Used so multipart uploads emit uniformly-sized parts despite the source
 * MediaRecorder chunks being arbitrarily sized.
 */
export function takeExactBytes(
  blobs: Blob[],
  target: number
): { taken: Blob[]; remaining: Blob[]; takenSize: number } {
  const taken: Blob[] = [];
  const remaining: Blob[] = [];
  let need = target;
  for (const b of blobs) {
    if (need <= 0) {
      remaining.push(b);
      continue;
    }
    if (b.size <= need) {
      taken.push(b);
      need -= b.size;
      continue;
    }
    taken.push(b.slice(0, need));
    remaining.push(b.slice(need));
    need = 0;
  }
  return { taken, remaining, takenSize: target - need };
}

export type TrackUploadInit = {
  kind: TrackKind;
  key: string;
  uploadId: string;
};

export type CompletedPart = { PartNumber: number; ETag: string };

export type UploadCoordinator = {
  /** Call whenever MediaRecorder.ondataavailable fires with a new Blob */
  pushChunk(kind: TrackKind, blob: Blob): void;
  /** Call when MediaRecorder.onstop fires — flushes remaining buffer */
  finalize(kind: TrackKind): Promise<void>;
  /** After all finalize() promises resolve, returns the assembled parts */
  getCompletedParts(): Partial<Record<TrackKind, CompletedPart[]>>;
  /** Overall progress across all tracks, 0-1 */
  onProgress(listener: (progress: number) => void): () => void;
};

export type PartUrlFetcher = (
  track: TrackKind,
  partNumber: number
) => Promise<string>;

type TrackState = {
  key: string;
  uploadId: string;
  buffer: Blob[];
  bufferSize: number;
  nextPartNumber: number;
  completedParts: CompletedPart[];
  inFlight: Promise<void>[];
  totalBytes: number;
  uploadedBytes: number;
};

export function createUploadCoordinator(
  inits: TrackUploadInit[],
  getPartUrl: PartUrlFetcher
): UploadCoordinator {
  const tracks = new Map<TrackKind, TrackState>();
  for (const init of inits) {
    tracks.set(init.kind, {
      key: init.key,
      uploadId: init.uploadId,
      buffer: [],
      bufferSize: 0,
      nextPartNumber: 1,
      completedParts: [],
      inFlight: [],
      totalBytes: 0,
      uploadedBytes: 0,
    });
  }

  const progressListeners = new Set<(progress: number) => void>();

  function reportProgress() {
    let total = 0;
    let uploaded = 0;
    for (const t of tracks.values()) {
      total += t.totalBytes;
      uploaded += t.uploadedBytes;
    }
    const ratio = total === 0 ? 0 : uploaded / total;
    for (const l of progressListeners) l(ratio);
  }

  async function uploadPart(
    kind: TrackKind,
    state: TrackState,
    partNumber: number,
    body: Blob
  ): Promise<void> {
    const url = await getPartUrl(kind, partNumber);
    const res = await fetch(url, { method: "PUT", body });
    if (!res.ok) {
      throw new Error(`Part ${partNumber} of ${kind} failed: ${res.status}`);
    }
    const etag = res.headers.get("ETag");
    if (!etag) {
      throw new Error(`Part ${partNumber} of ${kind} returned no ETag`);
    }
    state.completedParts.push({ PartNumber: partNumber, ETag: etag });
    state.uploadedBytes += body.size;
    reportProgress();
  }

  function flushBuffer(kind: TrackKind, state: TrackState, isFinal: boolean) {
    // R2 (and many S3 implementations) require every non-trailing part of a
    // multipart upload to have the SAME exact length. MediaRecorder hands us
    // arbitrarily-sized blobs, so we accumulate and slice off exactly
    // TARGET_PART_SIZE bytes per part, leaving the remainder in the buffer.
    // Only the very last part (isFinal && bufferSize > 0) may be smaller.
    while (true) {
      if (state.bufferSize === 0) return;
      const isLastPart = isFinal && state.bufferSize <= TARGET_PART_SIZE;
      if (!isLastPart && state.bufferSize < TARGET_PART_SIZE) return;

      const target = isLastPart ? state.bufferSize : TARGET_PART_SIZE;
      const { taken, remaining, takenSize } = takeExactBytes(state.buffer, target);
      state.buffer = remaining;
      state.bufferSize -= takenSize;

      const body = new Blob(taken);
      const partNumber = state.nextPartNumber++;
      state.totalBytes += body.size;
      const promise = uploadPart(kind, state, partNumber, body);
      state.inFlight.push(promise);

      if (isLastPart) return;
    }
  }

  return {
    pushChunk(kind, blob) {
      const state = tracks.get(kind);
      if (!state) return;
      state.buffer.push(blob);
      state.bufferSize += blob.size;
      flushBuffer(kind, state, false);
    },

    async finalize(kind) {
      const state = tracks.get(kind);
      if (!state) return;
      flushBuffer(kind, state, true);
      await Promise.all(state.inFlight);
      state.completedParts.sort((a, b) => a.PartNumber - b.PartNumber);
    },

    getCompletedParts() {
      const out: Partial<Record<TrackKind, CompletedPart[]>> = {};
      for (const [kind, state] of tracks.entries()) {
        out[kind] = state.completedParts.slice();
      }
      return out;
    },

    onProgress(listener) {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
  };
}
