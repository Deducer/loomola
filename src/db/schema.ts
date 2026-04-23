import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

// ---------------------------------------------------------------------------
// brand_profiles — branding applied to share pages (Layer 1: accent + logo)
// ---------------------------------------------------------------------------

export const brandProfiles = pgTable("brand_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  accentColor: text("accent_color").notNull(),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
  r2ScreenKey: text("r2_screen_key"),
  r2CameraKey: text("r2_camera_key"),
  r2MicKey: text("r2_mic_key"),
  r2SystemaudioKey: text("r2_systemaudio_key"),
  compositeThumbnailKey: text("composite_thumbnail_key"),
  trimStartSec: numeric("trim_start_sec"),
  trimEndSec: numeric("trim_end_sec"),
  passwordHash: text("password_hash"),
  uploadMetadata: jsonb("upload_metadata"),
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
