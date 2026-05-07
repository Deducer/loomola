import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  integer,
  bigserial,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const mediaObjectType = pgEnum("media_object_type", ["video", "audio"]);

export const mediaObjectStatus = pgEnum("media_object_status", [
  "uploading",
  "transcribing",
  "processing",
  "ready",
  "failed",
]);

export const generationStatus = pgEnum("generation_status", [
  "pending",
  "streaming",
  "complete",
  "failed",
]);

// ---------------------------------------------------------------------------
// brand_profiles — branding applied to share pages (Layer 1: accent + logo)
// ---------------------------------------------------------------------------

export const brandProfiles = pgTable("brand_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  accentColor: text("accent_color").notNull(),
  logoUrl: text("logo_url"),
  logoR2Key: text("logo_r2_key"),
  logoR2KeyDark: text("logo_r2_key_dark"),
  // Layer 2 — full-page theming on share pages.
  tagline: text("tagline"),
  fontFamily: text("font_family"),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  footerText: text("footer_text"),
  // 'light' | 'dark' | null. When set, the share page applies that
  // theme on a visitor's first load (no prior localStorage preference).
  // Visitor toggle on /v/<slug> still wins thereafter. CHECK
  // constraint enforces enum at the DB layer (see 0010 migration).
  defaultTheme: text("default_theme"),
  meetingNotesVaultPath: text("meeting_notes_vault_path"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// folders — hierarchical organization (one folder per recording)
// ---------------------------------------------------------------------------

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    // See media_objects.importSource above. Partial unique index in
    // migration 0022.
    importSource: text("import_source"),
    importSourceId: text("import_source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("folders_owner_idx").on(t.ownerId),
    parentIdx: index("folders_parent_idx").on(t.parentId),
  })
);

// ---------------------------------------------------------------------------
// media_folder_assignments — many-to-many between recordings and folders.
//
// Phase 1 of the multi-folder migration (spec:
// docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md).
// During the dual-write phase this table is kept in sync with the legacy
// `media_objects.folder_id` column. Reads still go through `folder_id`.
// In Phase 2 we flip reads here and in Phase 3 drop the legacy column.
// ---------------------------------------------------------------------------

export const mediaFolderAssignments = pgTable(
  "media_folder_assignments",
  {
    mediaObjectId: uuid("media_object_id").notNull(),
    folderId: uuid("folder_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({
      name: "media_folder_assignments_pkey",
      columns: [t.mediaObjectId, t.folderId],
    }),
    folderIdx: index("media_folder_assignments_folder_idx").on(
      t.folderId,
      t.createdAt
    ),
    ownerMediaIdx: index("media_folder_assignments_owner_media_idx").on(
      t.ownerId,
      t.mediaObjectId
    ),
  })
);

// ---------------------------------------------------------------------------
// media_objects — polymorphic core (video today, audio in future milestones)
// ---------------------------------------------------------------------------

export const mediaObjects = pgTable("media_objects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  type: mediaObjectType("type").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  description: text("description"),
  status: mediaObjectStatus("status").notNull(),
  brandProfileId: uuid("brand_profile_id").references(() => brandProfiles.id, {
    onDelete: "set null",
  }),
  durationSeconds: numeric("duration_seconds"),
  r2CompositeKey: text("r2_composite_key"),
  playbackMp4Key: text("playback_mp4_key"),
  r2ScreenKey: text("r2_screen_key"),
  r2CameraKey: text("r2_camera_key"),
  r2MicKey: text("r2_mic_key"),
  r2SystemaudioKey: text("r2_systemaudio_key"),
  compositeThumbnailKey: text("composite_thumbnail_key"),
  previewSpriteKey: text("preview_sprite_key"),
  trimStartSec: numeric("trim_start_sec"),
  trimEndSec: numeric("trim_end_sec"),
  passwordHash: text("password_hash"),
  uploadMetadata: jsonb("upload_metadata"),
  folderId: uuid("folder_id"),
  searchTsv: tsvector("search_tsv"),
  meetingDetectedApp: text("meeting_detected_app"),
  meetingStartedAtLocal: timestamp("meeting_started_at_local", {
    withTimezone: true,
  }),
  attendees: jsonb("attendees"),
  r2MixedKey: text("r2_mixed_key"),
  obsidianSaveRequestedAt: timestamp("obsidian_save_requested_at", {
    withTimezone: true,
  }),
  obsidianSyncedAt: timestamp("obsidian_synced_at", { withTimezone: true }),
  sourceContextHint: text("source_context_hint"),
  // AI-suggested folder. Populated by the suggest_folder pg-boss job after
  // generate_title_summary completes for any note that arrives without a
  // folderId. Cleared when the user accepts (folderId becomes set) or
  // dismisses (suggestedFolderDismissedAt is stamped).
  suggestedFolderId: uuid("suggested_folder_id"),
  suggestedFolderAt: timestamp("suggested_folder_at", { withTimezone: true }),
  suggestedFolderDismissedAt: timestamp(
    "suggested_folder_dismissed_at",
    { withTimezone: true }
  ),
  // Imported-from-elsewhere metadata. NULL for natively-recorded rows.
  // Source values constrained to ('loom', 'granola') by DB CHECK
  // constraint (migration 0022). Partial unique index on
  // (owner_id, import_source, import_source_id) is the dedup key for
  // merge-idempotent imports.
  importSource: text("import_source"),
  importSourceId: text("import_source_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// transcripts — Deepgram output
// ---------------------------------------------------------------------------

export const transcripts = pgTable("transcripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaObjectId: uuid("media_object_id")
    .notNull()
    .references(() => mediaObjects.id, { onDelete: "cascade" }),
  deepgramRequestId: text("deepgram_request_id"),
  language: text("language").default("en"),
  fullText: text("full_text").notNull(),
  wordTimestamps: jsonb("word_timestamps").notNull(),
  searchTsv: tsvector("search_tsv"),
  provider: text("provider").notNull().default("deepgram"),
  providerRequestId: text("provider_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// ai_outputs — LLM-derived title/summary/chapters/action_items
// ---------------------------------------------------------------------------

export const aiOutputs = pgTable("ai_outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaObjectId: uuid("media_object_id")
    .notNull()
    .references(() => mediaObjects.id, { onDelete: "cascade" }),
  titleSuggested: text("title_suggested"),
  summary: text("summary"),
  chapters: jsonb("chapters"),
  actionItems: jsonb("action_items"),
  llmModel: text("llm_model").notNull(),
  searchTsv: tsvector("search_tsv"),
  templateId: text("template_id").notNull().default("general-meeting"),
  generationStatusValue: generationStatus("generation_status")
    .notNull()
    .default("complete"),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// views — anonymous playback tracking (drop-off chart source)
// ---------------------------------------------------------------------------

export const views = pgTable(
  "views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    viewerIpHash: text("viewer_ip_hash").notNull(),
    viewerCountry: text("viewer_country"),
    watchedSeconds: numeric("watched_seconds").default("0"),
    maxWatchedSec: numeric("max_watched_sec").default("0"),
    userAgentSummary: text("user_agent_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqMediaVisitor: uniqueIndex("views_media_visitor_uq").on(
      t.mediaObjectId,
      t.viewerIpHash
    ),
  })
);

// ---------------------------------------------------------------------------
// comments — timestamped, anonymous (email required)
// ---------------------------------------------------------------------------

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaObjectId: uuid("media_object_id")
    .notNull()
    .references(() => mediaObjects.id, { onDelete: "cascade" }),
  commenterName: text("commenter_name").notNull(),
  commenterEmail: text("commenter_email").notNull(),
  timestampSec: numeric("timestamp_sec").notNull(),
  body: text("body").notNull(),
  readByCreatorAt: timestamp("read_by_creator_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// notes — user's hand-typed markdown notes per audio meeting
// ---------------------------------------------------------------------------

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    body: text("body").notNull().default(""),
    templateId: text("template_id").notNull().default("general-meeting"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    mediaObjectIdx: uniqueIndex("notes_media_object_idx").on(t.mediaObjectId),
    ownerIdx: index("notes_owner_idx").on(t.ownerId),
    ownerTemplateIdx: index("notes_owner_template_idx").on(
      t.ownerId,
      t.templateId
    ),
  })
);

// ---------------------------------------------------------------------------
// note_attachments — image context attached to audio notes
// ---------------------------------------------------------------------------

export const noteAttachments = pgTable(
  "note_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    kind: text("kind").notNull().default("image"),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    mediaObjectIdx: index("note_attachments_media_object_idx").on(
      t.mediaObjectId
    ),
    ownerIdx: index("note_attachments_owner_idx").on(t.ownerId),
  })
);

// ---------------------------------------------------------------------------
// people — known meeting participants
// ---------------------------------------------------------------------------

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    // Additional emails the same human is known by (work + personal,
    // multiple Granola accounts, etc.). Populated by POST /api/people/merge
    // and read by findPersonByAnyEmail. Primary canonical address stays in
    // `email` above. Migration 0024.
    emailAliases: jsonb("email_aliases").notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    // Marks the user's own Person row. Used by speaker-suggestion to pick
    // the host speaker_idx and (later, in v2 voice biometrics) seeded as
    // the user's voice fingerprint baseline. At most one is_self=true per
    // owner, enforced by partial unique index people_owner_self_unique.
    isSelf: boolean("is_self").notNull().default(false),
    // See media_objects.importSource above. Partial unique index in
    // migration 0022.
    importSource: text("import_source"),
    importSourceId: text("import_source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("people_owner_idx").on(t.ownerId),
  })
);

// ---------------------------------------------------------------------------
// speaker_assignments — per-recording speaker_idx to person mapping
// ---------------------------------------------------------------------------

export const speakerAssignments = pgTable(
  "speaker_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    speakerIdx: integer("speaker_idx").notNull(),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    displayLabelOverride: text("display_label_override"),
    // suggest_speakers job sets is_suggestion = true on auto-suggested
    // rows; UI ✓ flips it to false (confirmed) and ✗ deletes the row +
    // stamps dismissed_at on a separate marker row to suppress re-suggest.
    isSuggestion: boolean("is_suggestion").notNull().default(false),
    suggestedAt: timestamp("suggested_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    // Pre-fill payload for "create Person from meeting attendee" suggestions.
    // Shape: { displayName: string | null, email: string | null }. NULL
    // when person_id is set (no creation needed).
    suggestedNewPersonPayload: jsonb("suggested_new_person_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    mediaSpeakerIdx: uniqueIndex(
      "speaker_assignments_media_speaker_idx"
    ).on(t.mediaObjectId, t.speakerIdx),
  })
);

// ---------------------------------------------------------------------------
// dictionary_terms — shared vocabulary for transcription
// ---------------------------------------------------------------------------

export const dictionaryTerms = pgTable(
  "dictionary_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull(),
    term: text("term").notNull(),
    variantOf: uuid("variant_of"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("dictionary_terms_owner_idx").on(t.ownerId),
    ownerTermIdx: uniqueIndex("dictionary_terms_owner_term_idx").on(
      t.ownerId,
      t.term
    ),
  })
);

// ---------------------------------------------------------------------------
// transcript_chunks — chunked transcript with embeddings
// ---------------------------------------------------------------------------

export const transcriptChunks = pgTable(
  "transcript_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    embedding: vector1536("embedding").notNull(),
    modelVersion: text("model_version")
      .notNull()
      .default("openai/text-embedding-3-small"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    mediaIdx: index("transcript_chunks_media_idx").on(t.mediaObjectId),
  })
);

// ---------------------------------------------------------------------------
// summary_embeddings — one embedding per meeting summary
// ---------------------------------------------------------------------------

export const summaryEmbeddings = pgTable("summary_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaObjectId: uuid("media_object_id")
    .notNull()
    .references(() => mediaObjects.id, { onDelete: "cascade" })
    .unique(),
  embedding: vector1536("embedding").notNull(),
  modelVersion: text("model_version")
    .notNull()
    .default("openai/text-embedding-3-small"),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// rate_limit_events — generic sliding-window rate-limit storage
// ---------------------------------------------------------------------------

export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    scopeKeyOccurredAtIdx: index(
      "rate_limit_events_scope_key_occurred_at_idx"
    ).on(t.scope, t.key, t.occurredAt.desc()),
  })
);

// ---------------------------------------------------------------------------
// webhook_nonces — single-use nonces for outbound→inbound webhook callbacks
// (currently Deepgram). Verified-and-consumed atomically by the webhook
// route; replay attacks bounce off the consumed_at check.
// ---------------------------------------------------------------------------

export const webhookNonces = pgTable(
  "webhook_nonces",
  {
    nonce: text("nonce").primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    recordingIdIdx: index("webhook_nonces_recording_id_idx").on(t.recordingId),
    expiresAtIdx: index("webhook_nonces_expires_at_idx").on(t.expiresAt),
  })
);
