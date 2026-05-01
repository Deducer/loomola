import { PgBoss } from "pg-boss";
import { TRANSCRIBE_JOB, runTranscribeJob, type TranscribeJobData } from "./jobs/transcribe";
import {
  TITLE_SUMMARY_JOB,
  runTitleSummaryJob,
  type TitleSummaryJobData,
} from "./jobs/generate-title-summary";
import {
  CHAPTERS_JOB,
  runChaptersJob,
  type ChaptersJobData,
} from "./jobs/generate-chapters";
import {
  ACTION_ITEMS_JOB,
  runActionItemsJob,
  type ActionItemsJobData,
} from "./jobs/extract-action-items";
import {
  THUMBNAIL_JOB,
  runThumbnailJob,
  type ThumbnailJobData,
} from "./jobs/generate-thumbnail";
import {
  PREVIEW_SPRITE_JOB,
  runPreviewSpriteJob,
  type PreviewSpriteJobData,
} from "./jobs/generate-preview-sprite";
import {
  TRANSCODE_PLAYBACK_JOB,
  runTranscodePlaybackJob,
  type TranscodePlaybackJobData,
} from "./jobs/transcode-playback";
import {
  MIX_AUDIO_JOB,
  runMixAudioJob,
  type MixAudioJobData,
} from "./jobs/mix-audio";
import {
  AUDIO_WAVEFORM_JOB,
  runAudioWaveformJob,
  type AudioWaveformJobData,
} from "./jobs/audio-waveform";
import { enableGranola } from "@/lib/feature-flags";

let cached: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function init(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const boss = new PgBoss({
    connectionString,
    max: 8,
  });

  boss.on("error", (err: unknown) => {
    console.error("[pg-boss] error:", err);
  });

  await boss.start();
  const granolaEnabled = enableGranola();

  // pg-boss v10+ requires queues to exist before send()/work() — no auto-create.
  // Idempotent: safe to call on every boot.
  await boss.createQueue(TRANSCRIBE_JOB);
  await boss.createQueue(TITLE_SUMMARY_JOB);
  await boss.createQueue(CHAPTERS_JOB);
  await boss.createQueue(ACTION_ITEMS_JOB);
  await boss.createQueue(THUMBNAIL_JOB);
  await boss.createQueue(PREVIEW_SPRITE_JOB);
  await boss.createQueue(TRANSCODE_PLAYBACK_JOB);
  if (granolaEnabled) {
    await boss.createQueue(MIX_AUDIO_JOB);
    await boss.createQueue(AUDIO_WAVEFORM_JOB);
  }

  await boss.work<TranscribeJobData>(TRANSCRIBE_JOB, async (jobs) => {
    for (const job of jobs) await runTranscribeJob(job.data);
  });
  await boss.work<TitleSummaryJobData>(TITLE_SUMMARY_JOB, async (jobs) => {
    for (const job of jobs) await runTitleSummaryJob(job.data);
  });
  await boss.work<ChaptersJobData>(CHAPTERS_JOB, async (jobs) => {
    for (const job of jobs) await runChaptersJob(job.data);
  });
  await boss.work<ActionItemsJobData>(ACTION_ITEMS_JOB, async (jobs) => {
    for (const job of jobs) await runActionItemsJob(job.data);
  });
  await boss.work<ThumbnailJobData>(THUMBNAIL_JOB, async (jobs) => {
    for (const job of jobs) await runThumbnailJob(job.data);
  });
  await boss.work<PreviewSpriteJobData>(PREVIEW_SPRITE_JOB, async (jobs) => {
    for (const job of jobs) await runPreviewSpriteJob(job.data);
  });
  await boss.work<TranscodePlaybackJobData>(TRANSCODE_PLAYBACK_JOB, async (jobs) => {
    for (const job of jobs) await runTranscodePlaybackJob(job.data);
  });
  if (granolaEnabled) {
    await boss.work<MixAudioJobData>(MIX_AUDIO_JOB, async (jobs) => {
      for (const job of jobs) {
        const mixedKey = await runMixAudioJob(job.data);
        await Promise.all([
          boss.send(
            TRANSCRIBE_JOB,
            { mediaObjectId: job.data.mediaObjectId, audioKey: mixedKey },
            TRANSCRIBE_JOB_OPTIONS
          ),
          boss.send(
            AUDIO_WAVEFORM_JOB,
            { mediaObjectId: job.data.mediaObjectId, audioKey: mixedKey },
            AUDIO_JOB_OPTIONS
          ),
        ]);
      }
    });
    await boss.work<AudioWaveformJobData>(AUDIO_WAVEFORM_JOB, async (jobs) => {
      for (const job of jobs) await runAudioWaveformJob(job.data);
    });
  }

  console.log(
    `[pg-boss] started and workers registered (${granolaEnabled ? 9 : 7} queues)`
  );
  return boss;
}

/** Returns a started pg-boss singleton. Safe to call concurrently. */
export async function getBoss(): Promise<PgBoss> {
  if (cached) return cached;
  if (!starting) {
    starting = init().then((b) => {
      cached = b;
      return b;
    });
  }
  return starting;
}

/** Enqueues a transcription job for the given recording. */
const TRANSCRIBE_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 3600,
};

export async function enqueueTranscription(
  data: TranscribeJobData
): Promise<void> {
  const boss = await getBoss();
  await boss.send(TRANSCRIBE_JOB, data, TRANSCRIBE_JOB_OPTIONS);
}

export async function enqueuePlaybackTranscode(
  data: TranscodePlaybackJobData
): Promise<void> {
  const boss = await getBoss();
  await boss.send(TRANSCODE_PLAYBACK_JOB, data, {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 7200,
  });
}

const COMPOSITE_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 1800,
};

/** Thumbnail + preview-sprite only need the composite key, not the
 * transcript — they're enqueued at upload-complete time alongside the
 * Deepgram request and the playback transcode, instead of waiting for
 * the Deepgram webhook to fan out. Saves the Deepgram round-trip on
 * the dashboard-card thumbnail's critical path. */
export async function enqueueThumbnail(data: ThumbnailJobData): Promise<void> {
  const boss = await getBoss();
  await boss.send(THUMBNAIL_JOB, data, COMPOSITE_JOB_OPTIONS);
}

export async function enqueuePreviewSprite(
  data: PreviewSpriteJobData
): Promise<void> {
  const boss = await getBoss();
  await boss.send(PREVIEW_SPRITE_JOB, data, COMPOSITE_JOB_OPTIONS);
}

const AUDIO_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 3600,
};

export async function enqueueMixAudio(data: MixAudioJobData): Promise<void> {
  if (!enableGranola()) throw new Error("Granola is disabled");
  const boss = await getBoss();
  await boss.send(MIX_AUDIO_JOB, data, AUDIO_JOB_OPTIONS);
}

export async function enqueueAudioWaveform(
  data: AudioWaveformJobData
): Promise<void> {
  if (!enableGranola()) throw new Error("Granola is disabled");
  const boss = await getBoss();
  await boss.send(AUDIO_WAVEFORM_JOB, data, AUDIO_JOB_OPTIONS);
}
