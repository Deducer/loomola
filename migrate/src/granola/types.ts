// Granola data shapes — the on-disk cache format and the
// reverse-engineered API responses.
//
// These mirror the Granola desktop app's internal types as observed
// in `cache-v4.json` and the WorkOS-authenticated endpoints. Field
// names follow Granola's snake_case convention.

export type GranolaTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

export type GranolaCacheDoc = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  notes_plain: string | null;
  notes_markdown: string | null;
  notes_prosemirror: unknown;
  summary: string | null;
  attendees: Array<{
    id: string;
    name: string;
    email: string | null;
  }>;
  meeting_url: string | null;
  duration_seconds: number | null;
  owner_id: string;
  trashed_at: string | null;
};

export type GranolaTranscriptSegment = {
  speaker_id: string | null;
  text: string;
  start_ms: number;
  end_ms: number;
};

export type GranolaCachedTranscript = {
  document_id: string;
  segments: GranolaTranscriptSegment[];
  full_text: string;
};

export type GranolaCacheList = {
  id: string;
  name: string;
  document_ids: string[];
};

export type GranolaCachePerson = {
  id: string;
  name: string;
  email: string | null;
};

export type GranolaCacheSnapshot = {
  self: { id: string; email: string };
  documents: GranolaCacheDoc[];
  transcriptsByDocId: Record<string, GranolaCachedTranscript>;
  documentLists: GranolaCacheList[];
  people: GranolaCachePerson[];
  cacheVersion: number;
};
