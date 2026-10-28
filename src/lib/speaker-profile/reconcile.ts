import { meSpeakerIdxs, soleRemoteSpeakerIdx, type SpeakerProfile } from "./profile";

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
 *  - Stale pending suggestions and stale auto-applied rows: deleted —
 *    the worker recomputes them.
 *  - Stale dismissals ("Not <name>"): kept, moved by the capture-channel
 *    rule when unambiguous. The worker won't auto-apply a kind of name
 *    the user dismissed on this note.
 *  - Legacy (pre-v2) pending rows are never deleted — the old label
 *    writer changed or confirmed a person WITHOUT clearing is_suggestion,
 *    so any of them may be a user's choice. Capture evidence confirms
 *    them (kept as an evidence-confirmed name), contradicts them
 *    (retained hidden, parked off the voice indices), or neither (kept
 *    as a suggestion). None of them needs the owner's review.
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
  /** The row's derivation (speaker_assignments.suggestion_confidence). */
  suggestionConfidence?: string | null;
};

export type ReconcilePlan = {
  deleteIds: string[];
  restampIds: string[];
  remaps: Array<{ id: string; newIdx: number }>;
  reviewIds: string[];
  /** Pre-v2 pending rows the capture evidence CONFIRMS: kept as the same
   *  name, now an evidence-confirmed name (no "?", still undoable). */
  confirms: Array<{ id: string; derivation: string }>;
  /** Pre-v2 pending rows the capture evidence CONTRADICTS (mostly the old
   *  "owner on the call-audio channel" mislabel): never deleted — retained
   *  hidden, parked off the voice indices so they block nothing. */
  supersedes: Array<{ id: string; parkIdx: number }>;
  /** Pre-v2 pending rows the evidence neither confirms nor contradicts:
   *  kept as ordinary suggestions, tagged so they're never treated as
   *  disposable v2 machine output. */
  keepPendingIds: string[];
};

/** Prefix marking a kept pre-v2 suggestion's derivation. */
export const LEGACY_DERIVATION_PREFIX = "legacy:";
/** Prefix marking a retained-but-hidden (superseded) pre-v2 suggestion. */
export const SUPERSEDED_DERIVATION_PREFIX = "superseded:";
/** Parked (superseded) rows live at or below this index. */
export const PARKED_IDX_CEILING = -1_000_000;

export function transcriptVersionOf(provider: string, createdAt: Date): string {
  return `${provider}:${createdAt.toISOString()}`;
}

const LIVE_PREFIX = "deepgram-live:";

/** Does this row's speaker_idx refer to the CURRENT transcript's voices?
 *  Rows stamped with another version — and legacy unversioned rows
 *  written before the current transcript — don't, until reconciled. */
export function isRowOnTranscript(
  row: { transcriptVersion: string | null; suggestedAt: Date | null; createdAt: Date },
  currentVersion: string,
  currentTranscriptCreatedAt: Date
): boolean {
  if (row.transcriptVersion !== null) return row.transcriptVersion === currentVersion;
  return (row.suggestedAt ?? row.createdAt) >= currentTranscriptCreatedAt;
}

export function reconcileAssignments(args: {
  rows: ReadonlyArray<ReconcileRow>;
  currentVersion: string;
  currentTranscriptCreatedAt: Date;
  profile: SpeakerProfile;
  selfPersonId: string | null;
  /** The note's attendee person ids (owner excluded), read under lock. */
  attendeePersonIds?: ReadonlyArray<string>;
}): ReconcilePlan {
  const plan: ReconcilePlan = {
    deleteIds: [], restampIds: [], remaps: [], reviewIds: [], confirms: [], supersedes: [], keepPendingIds: [],
  };
  let nextPark = Math.min(PARKED_IDX_CEILING, ...args.rows.map((r) => r.speakerIdx)) - 1;
  const currentIsLive = args.currentVersion.startsWith(LIVE_PREFIX);
  // Low-gain mic evidence only ever produces a suggestion when naming, so
  // it may not prove — or move — an accepted name here either.
  const lowGain = new Set(args.profile.entries.filter((e) => e.lowGain).map((e) => e.speakerIdx));
  const me = meSpeakerIdxs(args.profile).filter((i) => !lowGain.has(i));
  // "Remote" is defined relative to Me; when Me rests on low-gain
  // evidence, so does every remote voice — no proof either way.
  const soleRemote = lowGain.size > 0 ? null : soleRemoteSpeakerIdx(args.profile);
  const remote = soleRemote === null ? [] : [soleRemote];

  const proposedRemaps: Array<{ id: string; newIdx: number }> = [];
  const keptIdxs = new Set<number>();
  const dismissalIds = new Set<string>();

  const attendeeIdsAll = args.attendeePersonIds ?? [];
  for (const row of args.rows) {
    // Parked (superseded) rows are retained data, not voices.
    if (row.speakerIdx <= PARKED_IDX_CEILING) continue;
    if (row.transcriptVersion === args.currentVersion) {
      keptIdxs.add(row.speakerIdx);
      continue;
    }

    const legacy = row.transcriptVersion === null;
    const wrote = row.suggestedAt ?? row.createdAt;
    // A pre-v2 row the evidence once confirmed is still possibly a user's
    // choice: it keeps user-decision protection (proof or review, never a
    // silent delete) on every later transcript.
    const confirmedLegacy =
      row.autoApplied && (row.suggestionConfidence ?? "").startsWith(LEGACY_DERIVATION_PREFIX);
    const userDecision =
      !row.isSuggestion && (!row.autoApplied || confirmedLegacy) && row.dismissedAt === null;

    // A pre-v2 "pending" row (or one kept from that era): never deleted —
    // the old label writer left is_suggestion set when the user picked or
    // renamed a person, so it may be a user's choice. The capture evidence
    // decides how it's shown; it never needs the owner's supervision:
    //  - confirms it → the same name, now evidence-confirmed (no "?");
    //  - contradicts it → retained but hidden (parked), blocking nothing;
    //  - neither → stays an ordinary suggestion.
    const legacyPending =
      row.isSuggestion &&
      (legacy || (row.suggestionConfidence ?? "").startsWith(LEGACY_DERIVATION_PREFIX));
    if (legacyPending) {
      const isSelf = args.selfPersonId !== null && row.personId === args.selfPersonId;
      const confirms = isSelf
        ? me.length === 1 && me[0] === row.speakerIdx
        : // A live call-audio channel can hold several people: like the
          // naming ladder, never treat it as one confirmed person.
          args.profile.status !== "live_channels" &&
          row.personId !== null &&
          remote.length === 1 &&
          remote[0] === row.speakerIdx &&
          attendeeIdsAll.length === 1 &&
          attendeeIdsAll[0] === row.personId;
      const contradicts = isSelf
        ? me.length === 1 && me[0] !== row.speakerIdx
        : row.personId !== null && me.includes(row.speakerIdx);
      if (confirms) {
        plan.confirms.push({
          id: row.id,
          derivation: isSelf
            ? args.profile.status === "live_channels"
              ? "self_via_source_channel"
              : "self_via_mic_capture"
            : "remote_via_single_voice",
        });
        keptIdxs.add(row.speakerIdx);
      } else if (contradicts) {
        plan.supersedes.push({ id: row.id, parkIdx: nextPark-- });
      } else {
        plan.keepPendingIds.push(row.id);
        keptIdxs.add(row.speakerIdx);
      }
      continue;
    }
    // A legacy row written AFTER this transcript is very likely about it —
    // but the old client could label a stale (live) screen after the batch
    // transcript landed, so only dismissals are kept on timing alone; a
    // name still needs the identity proof below.
    if (legacy && wrote >= args.currentTranscriptCreatedAt && row.dismissedAt !== null) {
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
    if (row.dismissedAt !== null) {
      // "Not <name>" is a user decision too. Carry it onto the voice its
      // live capture channel became when exactly one qualifies; otherwise
      // keep it where it is. Never delete it: the worker reads dismissals
      // to stop re-applying that kind of name without a click.
      const target = oldIsLive
        ? row.speakerIdx === 0 && me.length === 1
          ? me[0]
          : row.speakerIdx === 1 && remote.length === 1
            ? remote[0]
            : null
        : null;
      if (target !== null && target !== row.speakerIdx) {
        dismissalIds.add(row.id);
        proposedRemaps.push({ id: row.id, newIdx: target });
      } else {
        plan.restampIds.push(row.id);
        keptIdxs.add(row.speakerIdx);
      }
      continue;
    }
    if (!userDecision) {
      plan.deleteIds.push(row.id);
      continue;
    }

    // A stale name is kept only with proof that THIS voice is THAT
    // person on the new transcript — a coincidentally equal index proves
    // nothing after re-numbering:
    //  - the owner: the mic singles out exactly one voice and it's this one;
    //  - someone else: the same evidence the worker auto-applies a 1:1
    //    name with (sole remote voice, sole attendee, and it's them);
    //  - or channel continuity: the row is STAMPED as made on a live
    //    transcript (index 0 = mic, 1 = call audio) and that channel's
    //    voice is unambiguous AND at the same index. Unversioned legacy
    //    rows have unknown provenance (live or an earlier batch), so they
    //    need identity proof or go to review.
    const isSelf = args.selfPersonId !== null && row.personId === args.selfPersonId;
    const attendeeIds = args.attendeePersonIds ?? [];
    const channelBasis = oldIsLive;
    const channelTarget = !channelBasis
      ? null
      : isSelf && row.speakerIdx === 0 && me.length === 1
        ? me[0]
        : !isSelf && row.speakerIdx === 1 && remote.length === 1
          ? remote[0]
          : null;
    const proven = isSelf
      ? me.length === 1 && me[0] === row.speakerIdx
      : remote.length === 1 &&
        remote[0] === row.speakerIdx &&
        attendeeIds.length === 1 &&
        attendeeIds[0] === row.personId;
    if (proven || channelTarget === row.speakerIdx) {
      plan.restampIds.push(row.id);
      keptIdxs.add(row.speakerIdx);
      continue;
    }
    // A live-version row maps onto the voice its channel became. Legacy
    // rows never move: those are the pre-v2 mislabels, which the owner
    // reviews rather than having them silently corrected (2026-10-27).
    if (channelTarget !== null) {
      proposedRemaps.push({ id: row.id, newIdx: channelTarget });
      continue;
    }
    plan.reviewIds.push(row.id);
    keptIdxs.add(row.speakerIdx);
  }

  // A move may not land on a voice that keeps another row, and two rows
  // may not move onto the same voice — those become review items. A
  // rejected move leaves its row where it was, which can block another
  // move onto that index (A 0→1 is invalid once B 1→2 is rejected), so
  // reject until nothing changes.
  const originalIdx = new Map(args.rows.map((r) => [r.id, r.speakerIdx]));
  const occupied = new Set(keptIdxs);
  let candidates = proposedRemaps;
  for (;;) {
    const targetCounts = new Map<number, number>();
    for (const r of candidates) targetCounts.set(r.newIdx, (targetCounts.get(r.newIdx) ?? 0) + 1);
    const rejected = candidates.filter(
      (r) => occupied.has(r.newIdx) || (targetCounts.get(r.newIdx) ?? 0) > 1
    );
    if (rejected.length === 0) break;
    for (const r of rejected) {
      // A dismissal that can't move just stays put; a name needs review.
      if (dismissalIds.has(r.id)) plan.restampIds.push(r.id);
      else plan.reviewIds.push(r.id);
      occupied.add(originalIdx.get(r.id)!);
    }
    candidates = candidates.filter((r) => !rejected.includes(r));
  }
  plan.remaps.push(...candidates);
  return plan;
}
