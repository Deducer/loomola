import type { AudioNoteSegment } from "@/db/schema";
import {
  enqueueAudioWaveform,
  enqueueMixAudio,
  enqueueTranscription,
} from "@/lib/queue/boss";
import type { MixSegment } from "@/lib/queue/jobs/mix-audio";

/** The columns that describe where a note's audio lives. */
export type NoteAudioSource = {
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
  r2MixedKey: string | null;
  audioSegments: AudioNoteSegment[] | null;
};

export type NoteAudioPlan =
  | { kind: "mix"; segments: MixSegment[] }
  | { kind: "transcribe"; audioKey: string }
  | { kind: "none" };

/**
 * Every recorded segment of a note in order. Segment 1 is the pair of
 * raw-track columns (a single-track note has one of them, with r2MixedKey
 * pointing at the same file); Resume segments follow from audio_segments.
 */
export function noteAudioSegments(source: NoteAudioSource): MixSegment[] {
  const first: MixSegment = {
    micKey: source.r2MicKey,
    systemAudioKey: source.r2SystemaudioKey,
  };
  if (!first.micKey && !first.systemAudioKey) {
    if (!source.r2MixedKey) return [];
    first.micKey = source.r2MixedKey;
  }
  const extras = (source.audioSegments ?? [])
    .filter((segment) => segment.micKey || segment.systemAudioKey)
    .map((segment) => ({
      micKey: segment.micKey ?? null,
      systemAudioKey: segment.systemAudioKey ?? null,
    }));
  return [first, ...extras];
}

/**
 * Which job turns the note's audio into a transcript. One single-track
 * segment goes straight to Deepgram, as it always has; anything with two
 * tracks or more than one segment goes through mix_audio first, which
 * then enqueues transcription and the waveform itself.
 */
export function planNoteAudioJobs(source: NoteAudioSource): NoteAudioPlan {
  const segments = noteAudioSegments(source);
  if (segments.length === 0) return { kind: "none" };
  const [first] = segments;
  if (segments.length === 1 && !(first.micKey && first.systemAudioKey)) {
    return { kind: "transcribe", audioKey: first.micKey ?? first.systemAudioKey! };
  }
  return { kind: "mix", segments };
}

/** Enqueues the plan; returns what was enqueued. */
export async function enqueueNoteAudioJobs(
  mediaObjectId: string,
  source: NoteAudioSource
): Promise<NoteAudioPlan["kind"]> {
  const plan = planNoteAudioJobs(source);
  if (plan.kind === "mix") {
    await enqueueMixAudio({ mediaObjectId, segments: plan.segments });
  } else if (plan.kind === "transcribe") {
    await Promise.all([
      enqueueTranscription({ mediaObjectId, audioKey: plan.audioKey }),
      enqueueAudioWaveform({ mediaObjectId, audioKey: plan.audioKey }),
    ]);
  }
  return plan.kind;
}
