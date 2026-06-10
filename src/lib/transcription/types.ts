/**
 * Provider-agnostic transcript shape. Structurally identical to
 * WordTimestamp in src/db/queries/transcripts.ts — duplicated here (5
 * lines) so pure normalization modules and their unit tests never import
 * a module that constructs a db client.
 */
export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
};

export type NormalizedTranscript = {
  fullText: string;
  language: string;
  wordTimestamps: TranscriptWord[];
};
