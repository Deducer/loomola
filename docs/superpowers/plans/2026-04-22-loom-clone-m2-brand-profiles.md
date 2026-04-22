# Loom Clone — Milestone 2: Data Model + Brand Profiles CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full database schema from the Stage 1 design document, and ship a working brand profiles CRUD feature so Vayu Labs / Project Win / Personal are real records the rest of the app can reference.

**Architecture:** Drizzle defines the schema for all six tables in one initial migration; RLS policies are added via a companion custom migration file and enforce `owner_id = auth.uid()` across the board. Server actions handle create/update/delete of brand profiles with Zod input validation, Drizzle queries manually filter by owner, and three simple pages (`/brands`, `/brands/new`, `/brands/[id]`) wrap everything in UI. The dashboard gets a minimal top nav. Logo = URL text input for now; file upload deferred to a later milestone when R2 is wired up in M3/M4.

**Tech Stack:** Drizzle ORM, Drizzle Kit, PostgreSQL (Supabase), Zod (input validation), React Server Components, Next.js Server Actions, Vitest, Playwright.

---

## File Structure (Milestone 2)

**New files:**

```
src/
├── db/
│   ├── schema.ts                         # MODIFY — replace `export {};` with all 6 tables
│   └── queries/
│       └── brand-profiles.ts             # CREATE — typed CRUD + ownership-scoped selects
├── lib/
│   └── validation/
│       └── brand-profile.ts              # CREATE — Zod schemas for form input
├── app/
│   ├── layout.tsx                        # MODIFY — add top nav
│   ├── brands/
│   │   ├── page.tsx                      # CREATE — list view
│   │   ├── actions.ts                    # CREATE — create/update/delete server actions
│   │   ├── new/
│   │   │   └── page.tsx                  # CREATE — create form
│   │   └── [id]/
│   │       ├── page.tsx                  # CREATE — edit form
│   │       └── not-found.tsx             # CREATE — 404 for non-existent brand IDs
│   └── (dashboard)/
│       └── ...                           # NO CHANGES — dashboard stays placeholder
├── components/
│   ├── brand/
│   │   ├── brand-card.tsx                # CREATE — grid card
│   │   ├── brand-form.tsx                # CREATE — shared create/edit form
│   │   └── color-swatch.tsx              # CREATE — live preview swatch + hex input
│   └── nav/
│       └── top-nav.tsx                   # CREATE — app top navigation
├── components/
│   └── dashboard/
│       └── empty-state.tsx               # MODIFY — render inside new layout with top nav
├── lib/
│   └── require-auth.ts                   # CREATE — server helper that redirects if not logged in
└── ...

drizzle/
├── 0000_initial_schema.sql               # GENERATED — tables, enums, indexes
├── 0001_rls_policies.sql                 # CREATE — RLS + FK to auth.users
└── meta/
    ├── _journal.json                     # GENERATED
    └── 0000_snapshot.json                # GENERATED

tests/
├── unit/
│   └── brand-profile-validation.test.ts  # CREATE — Zod schema tests
└── e2e/
    └── brands.spec.ts                    # CREATE — brand profile CRUD golden path
```

**File responsibility boundaries:**

- `src/db/schema.ts` — the ONE source of truth for table definitions. All queries import table references from here.
- `src/db/queries/brand-profiles.ts` — contains `listBrandProfiles(ownerId)`, `getBrandProfile(id, ownerId)`, `createBrandProfile(...)`, `updateBrandProfile(...)`, `deleteBrandProfile(...)`. Every function takes `ownerId` explicitly — no implicit auth inside query functions.
- `src/app/brands/actions.ts` — server actions that call queries. This is where `auth.uid()` is read from the Supabase client and passed into query functions. **Ownership enforcement lives here, not in queries.**
- `src/lib/validation/brand-profile.ts` — Zod schemas: `brandProfileInputSchema` for form submission.
- `src/lib/require-auth.ts` — one small helper to DRY the "get user or redirect to /login" pattern used by every authenticated server page/action.
- `src/components/brand/brand-form.tsx` — ONE shared form used by both `/brands/new` and `/brands/[id]` pages. Pass `initialValues` + `action` props.

---

## Tasks

### Task 1: Install Zod

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install Zod**

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
npm install zod
```
Expected: adds `zod` to dependencies.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add zod for input validation"
```

---

### Task 2: Define the full Drizzle schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Replace the empty schema with all six tables**

Overwrite `src/db/schema.ts` with:

```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
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

export const views = pgTable("views", {
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
});

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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): define full schema per Stage 1 design"
```

---

### Task 3: Generate the initial migration

**Files:**
- Create: `drizzle/0000_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`

- [ ] **Step 1: Generate migration**

```bash
set -a && source .env.local && set +a
npm run db:generate
```
Expected: prints summary of tables + enums created, writes `drizzle/0000_<random_name>.sql` plus the `meta/_journal.json` and `meta/0000_snapshot.json` files.

- [ ] **Step 2: Verify the generated SQL looks right**

```bash
ls -la drizzle/
cat drizzle/0000_*.sql | head -40
```
Expected: SQL with `CREATE TYPE "public"."media_object_type" AS ENUM ('video', 'audio')`, `CREATE TABLE "brand_profiles"`, etc.

- [ ] **Step 3: Commit**

```bash
git add drizzle/
git commit -m "feat(db): generate initial migration for full schema"
```

---

### Task 4: Write custom RLS + auth.users FK migration

**Files:**
- Create: `drizzle/0001_rls_and_auth_fk.sql`

This file is NOT auto-generated by drizzle-kit (drizzle-kit doesn't know about RLS or about the Supabase-managed `auth.users` table). We write it by hand and add it to the journal so drizzle's migrator applies it.

- [ ] **Step 1: Create the custom migration SQL**

Create `drizzle/0001_rls_and_auth_fk.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Foreign keys to auth.users (Supabase-managed table)
-- ---------------------------------------------------------------------------

ALTER TABLE "brand_profiles"
  ADD CONSTRAINT "brand_profiles_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES auth.users("id")
  ON DELETE CASCADE;

ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES auth.users("id")
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security — defense-in-depth
--
-- The app uses Drizzle via the postgres pooler, which connects as the
-- `postgres` role and BYPASSES RLS. Ownership is enforced in server action
-- code. These policies are insurance against any future code path that
-- queries via the anon JWT (e.g. direct Supabase client usage).
-- ---------------------------------------------------------------------------

ALTER TABLE "brand_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transcripts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_outputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;

-- Owner-scoped full access on the owned tables
CREATE POLICY "brand_profiles_owner_all" ON "brand_profiles"
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "media_objects_owner_all" ON "media_objects"
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Join-scoped access on child tables (only if you own the parent media_object)
CREATE POLICY "transcripts_owner_select" ON "transcripts"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = transcripts.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

CREATE POLICY "ai_outputs_owner_select" ON "ai_outputs"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = ai_outputs.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

CREATE POLICY "views_owner_select" ON "views"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = views.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

CREATE POLICY "comments_owner_select" ON "comments"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = comments.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

-- Public INSERT policies for views + comments will be added in later
-- milestones (M8: view tracking, M9: comments). For now, all writes to
-- these tables require being the owner.
```

- [ ] **Step 2: Add the migration to the drizzle journal**

Drizzle tracks migrations via `drizzle/meta/_journal.json`. Append an entry for `0001_rls_and_auth_fk`:

```bash
cat drizzle/meta/_journal.json
```

You'll see something like:
```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1745360000000,
      "tag": "0000_something",
      "breakpoints": true
    }
  ]
}
```

Append an entry for our custom migration. The `tag` must match the filename without `.sql`. Use `jq` for safety:

```bash
NOW=$(date +%s000)
jq --arg tag "0001_rls_and_auth_fk" --arg when "$NOW" '
  .entries += [{
    idx: (.entries | length),
    version: "7",
    when: ($when | tonumber),
    tag: $tag,
    breakpoints: true
  }]
' drizzle/meta/_journal.json > drizzle/meta/_journal.json.tmp && mv drizzle/meta/_journal.json.tmp drizzle/meta/_journal.json
cat drizzle/meta/_journal.json
```
Expected: two entries in the `entries` array.

- [ ] **Step 3: Commit**

```bash
git add drizzle/0001_rls_and_auth_fk.sql drizzle/meta/_journal.json
git commit -m "feat(db): add RLS policies and auth.users foreign keys"
```

---

### Task 5: Apply migrations to the database

**Files:** none modified

- [ ] **Step 1: Run migrations against the dev/prod Supabase DB**

```bash
set -a && source .env.local && set +a
npm run db:migrate
```
Expected output:
```
migrations applied
```

- [ ] **Step 2: Verify tables exist in Supabase**

Open https://supabase.com/dashboard/project/eghwhnxuvbguoayzdlof/editor in a browser, or run this SQL check:

```bash
set -a && source .env.local && set +a
npx tsx -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const tables = await sql\`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
\`;
console.log(tables.map(t => t.table_name));
await sql.end();
"
```
Expected: `[ 'ai_outputs', 'brand_profiles', 'comments', 'media_objects', 'transcripts', 'views' ]` (plus Drizzle's own `__drizzle_migrations__`).

- [ ] **Step 3: Verify RLS is enabled**

```bash
set -a && source .env.local && set +a
npx tsx -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await sql\`
  SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname = 'public' AND tablename IN (
    'brand_profiles','media_objects','transcripts','ai_outputs','views','comments'
  )
\`;
console.log(rows);
await sql.end();
"
```
Expected: all six tables with `rowsecurity: true`.

(No commit — nothing changed in git.)

---

### Task 6: Zod validation for brand profile input

**Files:**
- Create: `src/lib/validation/brand-profile.ts`

- [ ] **Step 1: Create validation module**

```typescript
import { z } from "zod";

// Accept 3 or 6-digit hex with the leading #
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const brandProfileInputSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(60, "Name must be 60 characters or fewer")
    .trim(),
  accentColor: z
    .string()
    .regex(HEX_COLOR, "Accent color must be a hex code like #FF6B35"),
  logoUrl: z
    .string()
    .url("Logo URL must be a valid URL")
    .max(2048, "Logo URL too long")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validation/brand-profile.ts
git commit -m "feat(validation): add Zod schema for brand profile input"
```

---

### Task 7: Unit tests for brand profile validation

**Files:**
- Create: `tests/unit/brand-profile-validation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { brandProfileInputSchema } from "@/lib/validation/brand-profile";

describe("brandProfileInputSchema", () => {
  it("accepts a valid profile", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "#FF6B35",
      logoUrl: "https://vayulabs.com/logo.png",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid profile without a logo URL", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Personal",
      accentColor: "#4F46E5",
    });
    expect(result.success).toBe(true);
  });

  it("treats an empty string logoUrl as undefined", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Personal",
      accentColor: "#4F46E5",
      logoUrl: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logoUrl).toBeUndefined();
    }
  });

  it("rejects an empty name", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "",
      accentColor: "#FF6B35",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid hex color", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "orange",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hex color missing the #", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "FF6B35",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed logo URL", () => {
    const result = brandProfileInputSchema.safeParse({
      name: "Vayu Labs",
      accentColor: "#FF6B35",
      logoUrl: "not a url",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
npm run test
```
Expected: 1 (smoke) + 7 (brand profile) = 8 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/brand-profile-validation.test.ts
git commit -m "test: add unit tests for brand profile Zod schema"
```

---

### Task 8: Brand profile query module

**Files:**
- Create: `src/db/queries/brand-profiles.ts`

- [ ] **Step 1: Create query module**

```typescript
import { db } from "@/db";
import { brandProfiles } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { BrandProfileInput } from "@/lib/validation/brand-profile";

export type BrandProfile = typeof brandProfiles.$inferSelect;

export async function listBrandProfiles(ownerId: string): Promise<BrandProfile[]> {
  return db
    .select()
    .from(brandProfiles)
    .where(eq(brandProfiles.ownerId, ownerId))
    .orderBy(desc(brandProfiles.createdAt));
}

export async function getBrandProfile(
  id: string,
  ownerId: string
): Promise<BrandProfile | null> {
  const [row] = await db
    .select()
    .from(brandProfiles)
    .where(and(eq(brandProfiles.id, id), eq(brandProfiles.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function createBrandProfile(
  ownerId: string,
  input: BrandProfileInput
): Promise<BrandProfile> {
  const [row] = await db
    .insert(brandProfiles)
    .values({
      ownerId,
      name: input.name,
      accentColor: input.accentColor,
      logoUrl: input.logoUrl ?? null,
    })
    .returning();
  return row;
}

export async function updateBrandProfile(
  id: string,
  ownerId: string,
  input: BrandProfileInput
): Promise<BrandProfile | null> {
  const [row] = await db
    .update(brandProfiles)
    .set({
      name: input.name,
      accentColor: input.accentColor,
      logoUrl: input.logoUrl ?? null,
    })
    .where(and(eq(brandProfiles.id, id), eq(brandProfiles.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteBrandProfile(
  id: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .delete(brandProfiles)
    .where(and(eq(brandProfiles.id, id), eq(brandProfiles.ownerId, ownerId)))
    .returning({ id: brandProfiles.id });
  return result.length > 0;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/brand-profiles.ts
git commit -m "feat(db): add brand profile CRUD query module"
```

---

### Task 9: Auth helper for server code

**Files:**
- Create: `src/lib/require-auth.ts`

- [ ] **Step 1: Create the helper**

```typescript
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

/**
 * Retrieves the currently authenticated user, or redirects to /login.
 * Use in server pages and server actions that require auth.
 */
export async function requireAuth(): Promise<User> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/require-auth.ts
git commit -m "feat(auth): add requireAuth server helper"
```

---

### Task 10: Brand profile server actions

**Files:**
- Create: `src/app/brands/actions.ts`

- [ ] **Step 1: Create server actions**

```typescript
"use server";

import { requireAuth } from "@/lib/require-auth";
import {
  brandProfileInputSchema,
  type BrandProfileInput,
} from "@/lib/validation/brand-profile";
import {
  createBrandProfile,
  updateBrandProfile,
  deleteBrandProfile,
} from "@/db/queries/brand-profiles";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors: Partial<Record<keyof BrandProfileInput, string>> };

function parseFormData(formData: FormData) {
  return brandProfileInputSchema.safeParse({
    name: formData.get("name"),
    accentColor: formData.get("accentColor"),
    logoUrl: formData.get("logoUrl") ?? "",
  });
}

function formatErrors(
  errors: ReturnType<typeof brandProfileInputSchema.safeParse> extends { success: false; error: infer E } ? E : never
): Partial<Record<keyof BrandProfileInput, string>> {
  const fieldErrors: Partial<Record<keyof BrandProfileInput, string>> = {};
  for (const issue of errors.issues) {
    const key = issue.path[0] as keyof BrandProfileInput | undefined;
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function createBrandProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatErrors(parsed.error) };
  }
  await createBrandProfile(user.id, parsed.data);
  revalidatePath("/brands");
  redirect("/brands");
}

export async function updateBrandProfileAction(
  id: string,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatErrors(parsed.error) };
  }
  const updated = await updateBrandProfile(id, user.id, parsed.data);
  if (!updated) {
    return {
      ok: false,
      fieldErrors: { name: "Brand profile not found or access denied" },
    };
  }
  revalidatePath("/brands");
  revalidatePath(`/brands/${id}`);
  redirect("/brands");
}

export async function deleteBrandProfileAction(id: string): Promise<void> {
  const user = await requireAuth();
  await deleteBrandProfile(id, user.id);
  revalidatePath("/brands");
  redirect("/brands");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/brands/actions.ts
git commit -m "feat(brands): add server actions for create/update/delete"
```

---

### Task 11: Color swatch component

**Files:**
- Create: `src/components/brand/color-swatch.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState } from "react";

type Props = {
  name: string;
  defaultValue?: string;
  error?: string;
};

export function ColorSwatch({ name, defaultValue = "#4F46E5", error }: Props) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div>
      <label htmlFor={name} className="block text-sm">
        Accent color
      </label>
      <div className="mt-1 flex items-center gap-2">
        <div
          aria-hidden="true"
          className="h-10 w-10 shrink-0 rounded border border-white/20"
          style={{ background: value }}
        />
        <input
          id={name}
          name={name}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="#FF6B35"
          className="flex-1 rounded border border-white/20 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-white/40"
        />
        <input
          type="color"
          aria-label="Pick color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#4F46E5"}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/color-swatch.tsx
git commit -m "feat(brands): add color swatch input component"
```

---

### Task 12: Shared brand form component

**Files:**
- Create: `src/components/brand/brand-form.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useActionState } from "react";
import { ColorSwatch } from "./color-swatch";
import type { BrandProfile } from "@/db/queries/brand-profiles";

type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string> };

type Props = {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  initialValues?: Partial<BrandProfile>;
  submitLabel: string;
};

export function BrandForm({ action, initialValues, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action,
    null
  );

  const errors = state && !state.ok ? state.fieldErrors : {};

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="name" className="block text-sm">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initialValues?.name ?? ""}
          maxLength={60}
          placeholder="Vayu Labs"
          className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
        />
        {errors.name && <p className="mt-1 text-xs text-red-300">{errors.name}</p>}
      </div>

      <ColorSwatch
        name="accentColor"
        defaultValue={initialValues?.accentColor ?? "#4F46E5"}
        error={errors.accentColor}
      />

      <div>
        <label htmlFor="logoUrl" className="block text-sm">
          Logo URL <span className="opacity-60">(optional)</span>
        </label>
        <input
          id="logoUrl"
          name="logoUrl"
          type="url"
          defaultValue={initialValues?.logoUrl ?? ""}
          placeholder="https://vayulabs.com/logo.png"
          className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
        />
        {errors.logoUrl && <p className="mt-1 text-xs text-red-300">{errors.logoUrl}</p>}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <a
          href="/brands"
          className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/brand/brand-form.tsx
git commit -m "feat(brands): add shared create/edit form component"
```

---

### Task 13: Brand card component

**Files:**
- Create: `src/components/brand/brand-card.tsx`

- [ ] **Step 1: Create the component**

```typescript
import type { BrandProfile } from "@/db/queries/brand-profiles";
import Link from "next/link";

export function BrandCard({ brand }: { brand: BrandProfile }) {
  return (
    <Link
      href={`/brands/${brand.id}`}
      className="group flex items-center gap-3 rounded-lg border border-white/10 p-4 hover:border-white/30"
      style={{ borderLeftColor: brand.accentColor, borderLeftWidth: 4 }}
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded"
        style={{ background: brand.accentColor }}
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium">{brand.name}</h3>
        <p className="mt-0.5 truncate font-mono text-xs opacity-60">
          {brand.accentColor}
        </p>
      </div>
      {brand.logoUrl && (
        <img
          src={brand.logoUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded bg-white/5 object-contain p-1"
        />
      )}
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/brand-card.tsx
git commit -m "feat(brands): add brand card component"
```

---

### Task 14: Top nav component

**Files:**
- Create: `src/components/nav/top-nav.tsx`

- [ ] **Step 1: Create the component**

```typescript
import Link from "next/link";

type Props = {
  userEmail: string;
  activePath: "recordings" | "brands";
};

export function TopNav({ userEmail, activePath }: Props) {
  const items = [
    { href: "/", label: "Recordings", key: "recordings" as const },
    { href: "/brands", label: "Brands", key: "brands" as const },
  ];

  return (
    <nav className="flex items-center justify-between border-b border-white/10 px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-sm font-semibold">
          Loom Clone
        </Link>
        <ul className="flex items-center gap-4">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className={
                  item.key === activePath
                    ? "text-sm font-medium"
                    : "text-sm opacity-60 hover:opacity-100"
                }
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs opacity-60">{userEmail}</span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded border border-white/20 px-2.5 py-1 text-xs hover:bg-white/5"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/top-nav.tsx
git commit -m "feat(nav): add top navigation component"
```

---

### Task 15: Brands list page

**Files:**
- Create: `src/app/brands/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { BrandCard } from "@/components/brand/brand-card";
import { TopNav } from "@/components/nav/top-nav";
import Link from "next/link";

export default async function BrandsPage() {
  const user = await requireAuth();
  const brands = await listBrandProfiles(user.id);

  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="brands" />
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Brands</h1>
            <p className="mt-1 text-sm opacity-60">
              Profiles applied to share pages — accent color + logo.
            </p>
          </div>
          <Link
            href="/brands/new"
            className="rounded bg-white/90 px-3 py-2 text-sm font-medium text-black hover:bg-white"
          >
            New brand
          </Link>
        </div>

        {brands.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-white/15 p-10 text-center">
            <p className="text-sm opacity-70">No brand profiles yet.</p>
            <Link
              href="/brands/new"
              className="mt-3 inline-block text-sm underline"
            >
              Create your first one
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {brands.map((brand) => (
              <li key={brand.id}>
                <BrandCard brand={brand} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/brands/page.tsx
git commit -m "feat(brands): add /brands list page"
```

---

### Task 16: Brand create page

**Files:**
- Create: `src/app/brands/new/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
import { requireAuth } from "@/lib/require-auth";
import { BrandForm } from "@/components/brand/brand-form";
import { createBrandProfileAction } from "../actions";
import { TopNav } from "@/components/nav/top-nav";

export default async function NewBrandPage() {
  const user = await requireAuth();
  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="brands" />
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold">New brand profile</h1>
        <div className="mt-6">
          <BrandForm action={createBrandProfileAction} submitLabel="Create brand" />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/brands/new/page.tsx
git commit -m "feat(brands): add /brands/new create page"
```

---

### Task 17: Brand edit page + delete

**Files:**
- Create: `src/app/brands/[id]/page.tsx`, `src/app/brands/[id]/not-found.tsx`

- [ ] **Step 1: Create the not-found page**

```typescript
import Link from "next/link";

export default function BrandNotFound() {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-xl font-semibold">Brand not found</h1>
      <p className="mt-2 text-sm opacity-60">
        This brand profile doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link
        href="/brands"
        className="mt-6 inline-block text-sm underline"
      >
        Back to brands
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Create the edit page**

```typescript
import { requireAuth } from "@/lib/require-auth";
import { getBrandProfile } from "@/db/queries/brand-profiles";
import { BrandForm } from "@/components/brand/brand-form";
import {
  updateBrandProfileAction,
  deleteBrandProfileAction,
} from "../actions";
import { TopNav } from "@/components/nav/top-nav";
import { notFound } from "next/navigation";

export default async function EditBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await params;
  const brand = await getBrandProfile(id, user.id);
  if (!brand) notFound();

  const boundUpdate = updateBrandProfileAction.bind(null, brand.id);
  const boundDelete = deleteBrandProfileAction.bind(null, brand.id);

  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="brands" />
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold">Edit brand profile</h1>
        <div className="mt-6">
          <BrandForm
            action={boundUpdate}
            initialValues={brand}
            submitLabel="Save changes"
          />
        </div>

        <form action={boundDelete} className="mt-10 border-t border-white/10 pt-6">
          <h2 className="text-sm font-medium text-red-300">Danger zone</h2>
          <p className="mt-1 text-xs opacity-60">
            Deleting a brand unlinks it from any recordings that use it. Recordings
            themselves aren&apos;t deleted.
          </p>
          <button
            type="submit"
            className="mt-3 rounded border border-red-400/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10"
          >
            Delete brand profile
          </button>
        </form>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/brands/[id]/
git commit -m "feat(brands): add /brands/[id] edit page with delete"
```

---

### Task 18: Wire top nav into dashboard placeholder

**Files:**
- Modify: `src/app/page.tsx`, `src/components/dashboard/empty-state.tsx`

- [ ] **Step 1: Update the empty-state component to stop rendering its own signout button (nav owns it now)**

Overwrite `src/components/dashboard/empty-state.tsx`:

```typescript
export function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div>
        <h1 className="text-2xl font-semibold">Recordings</h1>
        <p className="mt-1 text-sm opacity-60">
          Recording, sharing, and AI features arrive in Milestones 3–11. Set up
          your brand profiles now so they&apos;re ready when recordings ship.
        </p>
      </div>
      <div className="mt-8 rounded-lg border border-white/10 p-6">
        <h2 className="text-sm font-medium">Current milestone</h2>
        <p className="mt-1 text-sm opacity-80">
          M2: Data model + brand profiles CRUD
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the home page to render the nav**

Overwrite `src/app/page.tsx`:

```typescript
import { requireAuth } from "@/lib/require-auth";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TopNav } from "@/components/nav/top-nav";

export default async function HomePage() {
  const user = await requireAuth();
  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <EmptyState />
    </>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/dashboard/empty-state.tsx
git commit -m "feat(nav): render top nav on dashboard; use requireAuth helper"
```

---

### Task 19: E2E golden path for brand CRUD

**Files:**
- Create: `tests/e2e/brands.spec.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("brand profiles CRUD", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
  });

  test("create, edit, and delete a brand profile", async ({ page }) => {
    const uniqueName = `E2E Brand ${Date.now()}`;

    // Navigate to brands list
    await page.getByRole("link", { name: "Brands" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByRole("heading", { name: "Brands" })).toBeVisible();

    // Create
    await page.getByRole("link", { name: "New brand" }).click();
    await expect(page).toHaveURL("/brands/new");
    await page.getByLabel("Name").fill(uniqueName);
    await page.getByLabel("Accent color").fill("#FF6B35");
    await page.getByRole("button", { name: "Create brand" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByText(uniqueName)).toBeVisible();

    // Edit
    await page.getByText(uniqueName).click();
    await expect(page.url()).toMatch(/\/brands\/[0-9a-f-]+$/);
    const editedName = `${uniqueName} edited`;
    await page.getByLabel("Name").fill(editedName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByText(editedName)).toBeVisible();

    // Delete
    await page.getByText(editedName).click();
    await page.getByRole("button", { name: "Delete brand profile" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByText(editedName)).not.toBeVisible();
  });

  test("rejects invalid accent color", async ({ page }) => {
    await page.goto("/brands/new");
    await page.getByLabel("Name").fill("Invalid color test");
    await page.getByLabel("Accent color").fill("orange");
    await page.getByRole("button", { name: "Create brand" }).click();
    // Stays on the form with an error shown
    await expect(page).toHaveURL("/brands/new");
    await expect(
      page.getByText(/Accent color must be a hex code/)
    ).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E tests against local dev**

```bash
set -a && source .env.local && set +a
npm run test:e2e
```
Expected: 2 existing auth tests + 2 new brand tests = 4 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/brands.spec.ts
git commit -m "test(e2e): add brand profile CRUD golden path"
```

---

### Task 20: Push and deploy

**Files:** none modified

- [ ] **Step 1: Push to main**

```bash
git push
```
Expected: Coolify auto-deploy triggers on push.

- [ ] **Step 2: Wait for Coolify deployment to complete**

Watch the Deployments tab at https://coolify.dissonance.cloud until status shows "Running". Typically takes 2-3 minutes for the rebuild.

- [ ] **Step 3: Verify live app**

1. Visit https://loom.dissonance.cloud — should show the dashboard with a top nav.
2. Click "Brands" — should land on an empty `/brands` page.
3. Click "New brand" — should show the create form.
4. Create a brand named "Vayu Labs" with color `#FF6B35` — should redirect to `/brands` with the card visible.
5. Click the card — should open the edit page, allow editing, and save.
6. Click "Delete brand profile" — should remove it from the list.

- [ ] **Step 4: Verify CI runs**

```bash
gh run list --repo Deducer/loom-clone --limit 3
```
Expected: most recent run shows `completed success` for the push.

- [ ] **Step 5: Update project CLAUDE.md**

Mark M2 complete by editing the `CLAUDE.md` roadmap section:

```bash
sed -i '' 's/- \[ \] M2: Data model + brand profiles CRUD/- [x] **M2: Data model + brand profiles CRUD** — full schema + brand profile UI/' CLAUDE.md
git add CLAUDE.md
git commit -m "docs: mark M2 complete in roadmap"
git push
```

---

## Milestone 2 Complete

At this point you should have:

- All six tables in the Supabase database, RLS enabled, FKs to `auth.users` in place
- Working brand profiles CRUD at `/brands` with create, edit, and delete flows
- Top nav across the app with Recordings (placeholder) + Brands links
- Zod validation on brand input
- 4 Playwright tests passing (2 auth + 2 brand CRUD)
- 8 Vitest unit tests passing (1 smoke + 7 brand profile validation)
- Live at https://loom.dissonance.cloud

Re-invoke `/superpowers:writing-plans` with "M3: Recording capture" when ready. M3 is a big one — browser MediaRecorder, camera bubble compositing, 4K stress testing, raw track handling. No upload yet, just getting capture working end-to-end.

---

## Self-Review

**Spec coverage:**

- `brand_profiles` table matches spec (id, owner_id, name, accent_color, logo_url, created_at) → Task 2 ✓
- `media_objects` table matches spec including all R2 keys, trim fields, password hash, deleted_at → Task 2 ✓
- `transcripts`, `ai_outputs`, `views`, `comments` tables match spec → Task 2 ✓
- Polymorphic `type` enum (`video` | `audio`) enables future audio products → Task 2 ✓
- RLS policies scoped to owner → Task 4 ✓
- FK `brand_profile_id` on media_objects uses `ON DELETE SET NULL` (spec: "deleting a brand unlinks it from recordings") → Task 2 ✓
- FK `media_object_id` on child tables uses `ON DELETE CASCADE` (spec: "ON DELETE CASCADE") → Task 2 ✓
- Brand profile CRUD for Layer 1 (name + accent_color + logo_url) → Tasks 6-17 ✓
- Logo = URL text input with Zod URL validation (spec open question resolved: URL paste for M2) → Tasks 6, 12 ✓
- Top nav on dashboard with Brands link → Tasks 14, 18 ✓

**Gaps found and filled:**
- Needed a `requireAuth` helper so every authenticated page/action doesn't duplicate the `getUser → redirect` pattern → Task 9 added.
- Needed a color picker component that handles both hex-text input and native `<input type="color">` — neither existed in M1 → Task 11 added.

**Placeholder scan:** no "TBD", "TODO", "similar to Task N", or incomplete steps. Every step has complete code or explicit commands.

**Type/name consistency:**
- `BrandProfile` type inferred from schema via `typeof brandProfiles.$inferSelect` (Task 8), consumed correctly in Task 13 (`BrandCard`) and Task 12 (`BrandForm` props use `Partial<BrandProfile>`).
- `BrandProfileInput` from Zod schema (Task 6), consumed in Task 8 (`createBrandProfile`, `updateBrandProfile`) and Task 10 (server actions).
- `ActionResult` type defined locally in Task 10 and Task 12. Task 12's form prop type matches what Task 10 actions return. ✓
- `requireAuth()` signature (Task 9): returns `User` object from `@supabase/supabase-js`. Consumed in Tasks 10, 15, 16, 17, 18. ✓
- Server action signatures: `createBrandProfileAction(_prev, formData)` and `updateBrandProfileAction.bind(null, id)` produce `(_prev, formData) => ...` which matches `useActionState` expectations in Task 12. ✓
- Query function signatures match between Task 8 (module) and Tasks 10, 15, 17 (call sites): `listBrandProfiles(ownerId)`, `getBrandProfile(id, ownerId)`, `createBrandProfile(ownerId, input)`, `updateBrandProfile(id, ownerId, input)`, `deleteBrandProfile(id, ownerId)`. ✓

No inconsistencies found.
