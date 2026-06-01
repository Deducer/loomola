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
import {
  EMBED_TRANSCRIPT_JOB,
  runEmbedTranscriptJob,
  type EmbedTranscriptJobData,
} from "./jobs/embed-transcript";
import {
  EMBED_SUMMARY_JOB,
  runEmbedSummaryJob,
  type EmbedSummaryJobData,
} from "./jobs/embed-summary";
import {
  SUGGEST_FOLDER_JOB,
  runSuggestFolderJob,
  type SuggestFolderJobData,
} from "./jobs/suggest-folder";
import {
  SUGGEST_SPEAKERS_JOB,
  runSuggestSpeakersJob,
  type SuggestSpeakersJobData,
} from "./jobs/suggest-speakers";
import {
  APPEND_CLIP_JOB,
  runAppendClipJob,
  type AppendClipJobData,
} from "./jobs/append-clip";
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
  await boss.createQueue(SUGGEST_FOLDER_JOB);
  await boss.createQueue(SUGGEST_SPEAKERS_JOB);
  await boss.createQueue(APPEND_CLIP_JOB);
  if (granolaEnabled) {
    await boss.createQueue(MIX_AUDIO_JOB);
    await boss.createQueue(AUDIO_WAVEFORM_JOB);
    await boss.createQueue(EMBED_TRANSCRIPT_JOB);
    await boss.createQueue(EMBED_SUMMARY_JOB);
  }

  await boss.work<TranscribeJobData>(TRANSCRIBE_JOB, async (jobs) => {
    for (const job of jobs) await runTranscribeJob(job.data);
  });
  await boss.work<TitleSummaryJobData>(TITLE_SUMMARY_JOB, async (jobs) => {
    for (const job of jobs) {
      await runTitleSummaryJob(job.data);
      if (granolaEnabled) {
        try {
          await boss.send(
            EMBED_SUMMARY_JOB,
            { mediaObjectId: job.data.mediaObjectId },
            EMBEDDING_JOB_OPTIONS
          );
        } catch (err) {
          console.error(
            `[pg-boss] failed to enqueue summary embedding for ${job.data.mediaObjectId}:`,
            err
          );
        }
      }
      // Best-effort enqueue of folder suggestion — never blocks the
      // user-visible title/summary write.
      try {
        await boss.send(
          SUGGEST_FOLDER_JOB,
          { mediaObjectId: job.data.mediaObjectId },
          SUGGEST_FOLDER_JOB_OPTIONS
        );
      } catch (err) {
        console.error(
          `[pg-boss] failed to enqueue folder suggestion for ${job.data.mediaObjectId}:`,
          err
        );
      }
      // Best-effort enqueue of speaker suggestion — same shape.
      try {
        await boss.send(
          SUGGEST_SPEAKERS_JOB,
          { mediaObjectId: job.data.mediaObjectId },
          SUGGEST_SPEAKERS_JOB_OPTIONS
        );
      } catch (err) {
        console.error(
          `[pg-boss] failed to enqueue speaker suggestion for ${job.data.mediaObjectId}:`,
          err
        );
      }
    }
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
  await boss.work<AppendClipJobData>(APPEND_CLIP_JOB, async (jobs) => {
    for (const job of jobs) {
      const result = await runAppendClipJob(job.data);
      try {
        await Promise.all([
          boss.send(
            TRANSCRIBE_JOB,
            { mediaObjectId: result.mediaObjectId, audioKey: result.compositeKey },
            TRANSCRIBE_JOB_OPTIONS
          ),
          boss.send(
            TRANSCODE_PLAYBACK_JOB,
            {
              mediaObjectId: result.mediaObjectId,
              compositeKey: result.compositeKey,
            },
            PLAYBACK_JOB_OPTIONS
          ),
          boss.send(
            THUMBNAIL_JOB,
            {
              mediaObjectId: result.mediaObjectId,
              compositeKey: result.compositeKey,
            },
            COMPOSITE_JOB_OPTIONS
          ),
          boss.send(
            PREVIEW_SPRITE_JOB,
            {
              mediaObjectId: result.mediaObjectId,
              compositeKey: result.compositeKey,
            },
            COMPOSITE_JOB_OPTIONS
          ),
        ]);
      } catch (err) {
        console.error(
          `[append-clip] failed to enqueue follow-up jobs for ${result.mediaObjectId}:`,
          err
        );
      }
    }
  });
  await boss.work<SuggestFolderJobData>(SUGGEST_FOLDER_JOB, async (jobs) => {
    for (const job of jobs) {
      try {
        await runSuggestFolderJob(job.data);
      } catch (err) {
        // Never throw — a classifier failure shouldn't poison the queue.
        console.error(
          `[suggest-folder] job ${job.data.mediaObjectId} failed:`,
          err
        );
      }
    }
  });
  await boss.work<SuggestSpeakersJobData>(SUGGEST_SPEAKERS_JOB, async (jobs) => {
    for (const job of jobs) {
      try {
        await runSuggestSpeakersJob(job.data);
      } catch (err) {
        console.error(
          `[suggest-speakers] job ${job.data.mediaObjectId} failed:`,
          err
        );
      }
    }
  });
  if (granolaEnabled) {
    await boss.work<MixAudioJobData>(MIX_AUDIO_JOB, async (jobs) => {
      for (const job of jobs) {
        const { mixedKey, transcriptKey } = await runMixAudioJob(job.data);
        await Promise.all([
          boss.send(
            TRANSCRIBE_JOB,
            {
              mediaObjectId: job.data.mediaObjectId,
              audioKey: transcriptKey,
              multichannel: true,
            },
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
    await boss.work<EmbedTranscriptJobData>(EMBED_TRANSCRIPT_JOB, async (jobs) => {
      for (const job of jobs) await runEmbedTranscriptJob(job.data);
    });
    await boss.work<EmbedSummaryJobData>(EMBED_SUMMARY_JOB, async (jobs) => {
      for (const job of jobs) await runEmbedSummaryJob(job.data);
    });
  }

  console.log(
    `[pg-boss] started and workers registered (${granolaEnabled ? 12 : 8} queues)`
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
  await boss.send(TRANSCODE_PLAYBACK_JOB, data, PLAYBACK_JOB_OPTIONS);
}

const PLAYBACK_JOB_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 7200,
};

const APPEND_CLIP_JOB_OPTIONS = {
  retryLimit: 1,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 7200,
};

export async function enqueueAppendClip(data: AppendClipJobData): Promise<void> {
  const boss = await getBoss();
  await boss.send(APPEND_CLIP_JOB, data, APPEND_CLIP_JOB_OPTIONS);
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

const EMBEDDING_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 3600,
};

const SUGGEST_FOLDER_JOB_OPTIONS = {
  retryLimit: 1,
  retryDelay: 30,
  retryBackoff: false,
  expireInSeconds: 600,
};

const SUGGEST_SPEAKERS_JOB_OPTIONS = {
  retryLimit: 1,
  retryDelay: 30,
  retryBackoff: false,
  expireInSeconds: 300,
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

export async function enqueueTranscriptEmbedding(
  data: EmbedTranscriptJobData
): Promise<void> {
  if (!enableGranola()) throw new Error("Granola is disabled");
  const boss = await getBoss();
  await boss.send(EMBED_TRANSCRIPT_JOB, data, EMBEDDING_JOB_OPTIONS);
}

export async function enqueueSummaryEmbedding(
  data: EmbedSummaryJobData
): Promise<void> {
  if (!enableGranola()) throw new Error("Granola is disabled");
  const boss = await getBoss();
  await boss.send(EMBED_SUMMARY_JOB, data, EMBEDDING_JOB_OPTIONS);
}
