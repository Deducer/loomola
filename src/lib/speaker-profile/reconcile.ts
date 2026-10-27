import { meSpeakerIdxs, remoteSpeakerIdxs, type SpeakerProfile } from "./profile";

/**
 * Carries speaker_assignments across a transcript replacement (speaker
 * recognition v2).
 *
 * The bug this exists for: a desktop note's LIVE transcript indexes
 * voices by capture channel (0 = mic, 1 = system audio), the batch
 * transcript that replaces it minutes later indexes them by diarization
 * order, and rows computed on the first kept pointing at whoever the
 * second numbered the same — 27 of 32 production notes, including two
 * accepted 1:1s with the names swapped.
 *
 * Rules (pure; the worker applies the plan):
 *  - Rows already on the current version: untouched.
 *  - Legacy rows (no version) count as current only when they were
 *    written after the current transcript.
 *  - Live → live (snapshot re-save): indices are still channels; restamp.
 *  - Stale pending suggestions, stale auto-applied rows, stale
 *    dismissals: deleted — the worker recomputes them.
 *  - Legacy pending rows are always deleted: they came from the v1
 *    positional / talk-time rules, which this version retires.
 *  - Stale USER decisions are never deleted or rewritten without
 *    capture evidence. Kept (restamped) when the evidence confirms them,
 *    moved when the old row was a live capture channel and the new
 *    transcript has exactly one matching voice, otherwise flagged
 *    needs_review.
 *
 * Remaps can swap two rows' indices (the swapped-1:1 case), so the
 * caller must apply them through a temporary index to respect the
 * (media_object_id, speaker_idx) unique index, after the deletes.
 */

export type ReconcileRow = {
  id: string;
  speakerIdx: number;
  personId: string | null;
  isSuggestion: boolean;
  autoApplied: boolean;
  dismissedAt: Date | null;
  needsReview: boolean;
  transcriptVersion: string | null;
  createdAt: Date;
  suggestedAt: Date | null;
};

export type ReconcilePlan = {
  deleteIds: string[];
  restampIds: string[];
  remaps: Array<{ id: string; newIdx: number }>;
  reviewIds: string[];
};

export function transcriptVersionOf(provider: string, createdAt: Date): string {
  return `${provider}:${createdAt.toISOString()}`;
}

const LIVE_PREFIX = "deepgram-live:";

export function reconcileAssignments(args: {
  rows: ReadonlyArray<ReconcileRow>;
  currentVersion: string;
  currentTranscriptCreatedAt: Date;
  profile: SpeakerProfile;
  selfPersonId: string | null;
}): ReconcilePlan {
  const plan: ReconcilePlan = { deleteIds: [], restampIds: [], remaps: [], reviewIds: [] };
  const currentIsLive = args.currentVersion.startsWith(LIVE_PREFIX);
  const me = meSpeakerIdxs(args.profile);
  const remote = remoteSpeakerIdxs(args.profile);

  const proposedRemaps: Array<{ id: string; newIdx: number }> = [];
  const keptIdxs = new Set<number>();

  for (const row of args.rows) {
    if (row.transcriptVersion === args.currentVersion) {
      keptIdxs.add(row.speakerIdx);
      continue;
    }

    const legacy = row.transcriptVersion === null;
    const wrote = row.suggestedAt ?? row.createdAt;
    const userDecision = !row.isSuggestion && !row.autoApplied && row.dismissedAt === null;

    if (legacy && row.isSuggestion) {
      plan.deleteIds.push(row.id);
      continue;
    }
    if (legacy && wrote >= args.currentTranscriptCreatedAt) {
      plan.restampIds.push(row.id);
      keptIdxs.add(row.speakerIdx);
      continue;
    }
    const oldIsLive = !legacy && row.transcriptVersion!.startsWith(LIVE_PREFIX);
    if (oldIsLive && currentIsLive) {
      plan.restampIds.push(row.id);
      keptIdxs.add(row.speakerIdx);
      continue;
    }
    if (!userDecision) {
      plan.deleteIds.push(row.id);
      continue;
    }

    const isSelf = args.selfPersonId !== null && row.personId === args.selfPersonId;
    const confirmed = isSelf
      ? me.includes(row.speakerIdx)
      : remote.length === 1 && remote[0] === row.speakerIdx;
    if (confirmed) {
      plan.restampIds.push(row.id);
      keptIdxs.add(row.speakerIdx);
      continue;
    }
    // A live row names a capture channel, so it maps onto the voice that
    // channel became — but only when exactly one voice qualifies.
    const channelTarget =
      oldIsLive && isSelf && row.speakerIdx === 0 && me.length === 1
        ? me[0]
        : oldIsLive && !isSelf && row.speakerIdx === 1 && remote.length === 1
          ? remote[0]
          : null;
    if (channelTarget !== null) {
      proposedRemaps.push({ id: row.id, newIdx: channelTarget });
      continue;
    }
    plan.reviewIds.push(row.id);
    keptIdxs.add(row.speakerIdx);
  }

  // A move may not land on a voice that keeps another row, and two rows
  // may not move onto the same voice — both become review items.
  const targetCounts = new Map<number, number>();
  for (const r of proposedRemaps) targetCounts.set(r.newIdx, (targetCounts.get(r.newIdx) ?? 0) + 1);
  for (const r of proposedRemaps) {
    if (keptIdxs.has(r.newIdx) || (targetCounts.get(r.newIdx) ?? 0) > 1) plan.reviewIds.push(r.id);
    else plan.remaps.push(r);
  }
  return plan;
}
