// TypeScript's lib.dom.d.ts is missing the WebCodecs Insertable-Streams
// APIs we use for the worker compositor (MediaStreamTrackProcessor's
// `track` init field is on lib.webworker but not lib.dom; the entire
// MediaStreamTrackGenerator type is absent everywhere). These are
// stable in Chrome 94+ — declared here for typecheck only.

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

declare class MediaStreamTrackProcessor {
  constructor(init: MediaStreamTrackProcessorInit);
  readonly readable: ReadableStream<VideoFrame>;
}

interface MediaStreamTrackGeneratorInit {
  kind: "video" | "audio";
}

interface MediaStreamTrackGeneratorBase extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>;
}

declare class MediaStreamTrackGenerator implements MediaStreamTrackGeneratorBase {
  constructor(init: MediaStreamTrackGeneratorInit);
  readonly writable: WritableStream<VideoFrame>;
  // MediaStreamTrack interface members are inherited.
  readonly contentHint: string;
  readonly enabled: boolean;
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly muted: boolean;
  readonly readyState: MediaStreamTrackState;
  onended: ((this: MediaStreamTrack, ev: Event) => unknown) | null;
  onmute: ((this: MediaStreamTrack, ev: Event) => unknown) | null;
  onunmute: ((this: MediaStreamTrack, ev: Event) => unknown) | null;
  applyConstraints(constraints?: MediaTrackConstraints): Promise<void>;
  clone(): MediaStreamTrack;
  getCapabilities(): MediaTrackCapabilities;
  getConstraints(): MediaTrackConstraints;
  getSettings(): MediaTrackSettings;
  stop(): void;
  addEventListener<K extends keyof MediaStreamTrackEventMap>(
    type: K,
    listener: (this: MediaStreamTrack, ev: MediaStreamTrackEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof MediaStreamTrackEventMap>(
    type: K,
    listener: (this: MediaStreamTrack, ev: MediaStreamTrackEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
  dispatchEvent(event: Event): boolean;
}
