# Stage 1.5b — Folders + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Add single-parent folders with drag-and-drop, full-text search across title + transcript, sort/filter, and a sidebar-based dashboard layout.

**Architecture:** New `folders` table with self-ref parent FK + `media_objects.folder_id`. Postgres generated `tsvector` columns on `media_objects` / `ai_outputs` / `transcripts` with GIN indexes. Server-side search reads from all three, unions, ranks by `ts_rank`. Dashboard becomes sidebar (folder tree) + main area (search + filters + cards). URL is the source of truth for `q`/`sort`/`status`/`brand`/`folder`.

**Tech Stack:** Drizzle, Postgres FTS, Next.js App Router, HTML5 drag-and-drop (no lib).

**Reference:** [Stage 1.5 design spec](../specs/2026-04-24-loom-clone-stage-1-5-premium-ux-design.md)

---

## File Structure

**New:**
- `src/db/queries/folders.ts` — CRUD + tree helpers
- `src/db/queries/search.ts` — `searchRecordings()` with filters/sort/fts
- `src/lib/folders/cycle.ts` — pure cycle detection for folder moves
- `tests/unit/folder-cycle.test.ts`
- `src/app/api/folders/route.ts` — POST (create)
- `src/app/api/folders/[id]/route.ts` — PATCH (rename / move), DELETE
- `src/app/api/recordings/[id]/folder/route.ts` — PATCH (move recording)
- `src/app/api/recordings/[id]/route.ts` — DELETE (soft-delete recording)
- `src/components/dashboard/folder-sidebar.tsx`
- `src/components/dashboard/search-filter-bar.tsx`
- `src/components/dashboard/recording-card-menu.tsx`
- `src/components/dashboard/breadcrumbs.tsx`

**Modified:**
- `src/db/schema.ts` — add `folders` table, `mediaObjects.folderId`, tsvector columns
- `drizzle/000X_*.sql` — generated
- `src/app/page.tsx` — wire sidebar + search + filter + breadcrumbs into dashboard
- `src/components/dashboard/recording-card.tsx` — add hover ⋯ menu (draggable)
- `ROADMAP.md`, `CLAUDE.md` — mark Stage 1.5 complete

---

## Task 1: Schema + migration

**Files:** `src/db/schema.ts`, `drizzle/000X_*.sql`

- [ ] **Step 1: Add folders + folderId + tsvector columns**

At the top of `src/db/schema.ts`, make sure the imports include `customType`:
```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
```

Add a tsvector custom type below the imports (Drizzle doesn't ship one native):
```ts
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
```

Add the `folders` table near `brandProfiles`:
```ts
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
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
```

In `mediaObjects`, add `folderId` and `searchTsv`:
```ts
// inside the mediaObjects pgTable body (alongside the other columns)
  folderId: uuid("folder_id"),
  searchTsv: tsvector("search_tsv"),
```

In `aiOutputs`:
```ts
  searchTsv: tsvector("search_tsv"),
```

In `transcripts`:
```ts
  searchTsv: tsvector("search_tsv"),
```

(The `searchTsv` columns are database-generated — see migration. Drizzle just needs to know they exist for SELECT; we never write them from the app.)

- [ ] **Step 2: Generate migration scaffold**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npx drizzle-kit generate
```

This produces `drizzle/000X_*.sql`. Drizzle will create the `folders` table and add the `folder_id` / `search_tsv` columns. The `search_tsv` columns will be plain `tsvector` (not generated). We need to edit them to be generated.

- [ ] **Step 3: Edit the generated SQL to add FKs, generated-column definitions, and indexes**

Open the newly-generated `drizzle/000X_*.sql` and APPEND this block at the end (before the final blank line):

```sql
--> Convert the search_tsv columns into generated stored columns with weighted vectors.
ALTER TABLE "media_objects" DROP COLUMN IF EXISTS "search_tsv";
ALTER TABLE "media_objects" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
  ) STORED;
CREATE INDEX IF NOT EXISTS "media_objects_search_tsv_idx"
  ON "media_objects" USING GIN ("search_tsv");

ALTER TABLE "ai_outputs" DROP COLUMN IF EXISTS "search_tsv";
ALTER TABLE "ai_outputs" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title_suggested, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B')
  ) STORED;
CREATE INDEX IF NOT EXISTS "ai_outputs_search_tsv_idx"
  ON "ai_outputs" USING GIN ("search_tsv");

ALTER TABLE "transcripts" DROP COLUMN IF EXISTS "search_tsv";
ALTER TABLE "transcripts" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS "transcripts_search_tsv_idx"
  ON "transcripts" USING GIN ("search_tsv");

--> Folders: FKs (Drizzle doesn't generate self-ref or auth.users FKs automatically) and unique index.
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "folders_unique_sibling_name"
  ON "folders"("owner_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), "name");

ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "media_objects_folder_id_idx" ON "media_objects"("folder_id");
```

- [ ] **Step 4: Apply migration**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npx tsx scripts/migrate.ts
```

Expected: "migrations applied".

- [ ] **Step 5: Verify**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
(async () => {
  const cols = await sql`SELECT column_name, is_generated FROM information_schema.columns WHERE column_name = '"'"'search_tsv'"'"' ORDER BY table_name`;
  console.log("search_tsv columns:", cols);
  const idx = await sql`SELECT indexname FROM pg_indexes WHERE indexname LIKE '"'"'%search_tsv%'"'"' OR indexname LIKE '"'"'%folder%'"'"' ORDER BY indexname`;
  console.log("indexes:", idx.map(r => r.indexname).join(","));
  await sql.end();
})();
'
```

Expected: 3 rows with `is_generated=ALWAYS`; indexes include `ai_outputs_search_tsv_idx`, `folders_owner_idx`, `folders_parent_idx`, `folders_unique_sibling_name`, `media_objects_folder_id_idx`, `media_objects_search_tsv_idx`, `transcripts_search_tsv_idx`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(stage-1.5b): folders table + folder_id + FTS tsvector columns"
```

---

## Task 2: Folder cycle-check utility (TDD)

**Files:**
- Create: `src/lib/folders/cycle.ts`
- Create: `tests/unit/folder-cycle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/folder-cycle.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { wouldCreateCycle } from "@/lib/folders/cycle";

type Node = { id: string; parentId: string | null };

describe("wouldCreateCycle", () => {
  const folders: Node[] = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
  ];

  it("rejects moving a folder into itself", () => {
    expect(wouldCreateCycle(folders, "a", "a")).toBe(true);
  });

  it("rejects moving a folder into its descendant", () => {
    expect(wouldCreateCycle(folders, "a", "b")).toBe(true);
    expect(wouldCreateCycle(folders, "a", "c")).toBe(true);
  });

  it("allows moving a folder to an unrelated parent", () => {
    expect(wouldCreateCycle(folders, "c", "d")).toBe(false);
    expect(wouldCreateCycle(folders, "b", "d")).toBe(false);
  });

  it("allows moving to root (null parent)", () => {
    expect(wouldCreateCycle(folders, "c", null)).toBe(false);
  });

  it("allows moving a sibling into another sibling", () => {
    expect(wouldCreateCycle(folders, "d", "a")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run tests/unit/folder-cycle.test.ts
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement**

Create `src/lib/folders/cycle.ts`:
```ts
type Node = { id: string; parentId: string | null };

/**
 * Returns true when moving `folderId` under `newParentId` would create a
 * cycle (i.e., the new parent is the folder itself or any descendant).
 * Works on a flat list of all folders owned by one user.
 */
export function wouldCreateCycle(
  folders: Node[],
  folderId: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;

  const childrenByParent = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId) {
      const list = childrenByParent.get(f.parentId) ?? [];
      list.push(f.id);
      childrenByParent.set(f.parentId, list);
    }
  }

  // BFS down from folderId; if we reach newParentId, cycle.
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newParentId) return true;
    const kids = childrenByParent.get(current);
    if (kids) queue.push(...kids);
  }
  return false;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/unit/folder-cycle.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/folders/cycle.ts tests/unit/folder-cycle.test.ts
git commit -m "feat(folders): pure cycle detection for folder moves"
```

---

## Task 3: Folder query module

**Files:** `src/db/queries/folders.ts`

- [ ] **Step 1: Implement**

Create `src/db/queries/folders.ts`:
```ts
import { db } from "@/db";
import { folders, mediaObjects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export type Folder = typeof folders.$inferSelect;

export async function listFoldersForOwner(
  ownerId: string
): Promise<Folder[]> {
  return db
    .select()
    .from(folders)
    .where(eq(folders.ownerId, ownerId))
    .orderBy(folders.name);
}

export async function getFolderOwned(
  id: string,
  ownerId: string
): Promise<Folder | null> {
  const [row] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function createFolder(params: {
  ownerId: string;
  name: string;
  parentId: string | null;
}): Promise<Folder> {
  const [row] = await db
    .insert(folders)
    .values({
      ownerId: params.ownerId,
      name: params.name,
      parentId: params.parentId,
    })
    .returning();
  return row;
}

export async function updateFolder(params: {
  id: string;
  ownerId: string;
  name?: string;
  parentId?: string | null;
}): Promise<boolean> {
  const set: Partial<{ name: string; parentId: string | null; updatedAt: Date }> = {};
  if (params.name !== undefined) set.name = params.name;
  if (params.parentId !== undefined) set.parentId = params.parentId;
  if (Object.keys(set).length === 0) return true;
  const result = await db
    .update(folders)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(folders.id, params.id), eq(folders.ownerId, params.ownerId)))
    .returning({ id: folders.id });
  return result.length > 0;
}

export async function deleteFolderOwned(params: {
  id: string;
  ownerId: string;
}): Promise<boolean> {
  const result = await db
    .delete(folders)
    .where(and(eq(folders.id, params.id), eq(folders.ownerId, params.ownerId)))
    .returning({ id: folders.id });
  return result.length > 0;
}

export async function moveRecordingToFolder(params: {
  recordingId: string;
  ownerId: string;
  folderId: string | null;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ folderId: params.folderId })
    .where(
      and(
        eq(mediaObjects.id, params.recordingId),
        eq(mediaObjects.ownerId, params.ownerId)
      )
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/folders.ts
git commit -m "feat(folders): CRUD query module (owner-scoped)"
```

---

## Task 4: Search query module

**Files:** `src/db/queries/search.ts`

- [ ] **Step 1: Implement**

Create `src/db/queries/search.ts`:
```ts
import { db } from "@/db";
import { mediaObjects, aiOutputs, transcripts, brandProfiles, views } from "@/db/schema";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { RecordingWithBrand } from "./recordings";

export type SearchSort =
  | "date_desc"
  | "date_asc"
  | "duration_desc"
  | "duration_asc"
  | "views_desc"
  | "title_asc";

export async function searchRecordings(params: {
  ownerId: string;
  query?: string;
  folderId?: string | null;   // undefined = all folders; null = unfiled; string = that folder
  status?: string[];
  brandId?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}): Promise<RecordingWithBrand[]> {
  const hasQuery = !!params.query?.trim();
  const q = hasQuery ? params.query!.trim() : null;
  const sort: SearchSort = params.sort ?? "date_desc";
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const conditions: SQL[] = [
    eq(mediaObjects.ownerId, params.ownerId),
    isNull(mediaObjects.deletedAt),
  ];
  if (params.folderId === null) {
    conditions.push(isNull(mediaObjects.folderId));
  } else if (typeof params.folderId === "string") {
    conditions.push(eq(mediaObjects.folderId, params.folderId));
  }
  if (params.status && params.status.length > 0) {
    conditions.push(
      sql`${mediaObjects.status}::text = ANY(${params.status})`
    );
  }
  if (params.brandId) {
    conditions.push(eq(mediaObjects.brandProfileId, params.brandId));
  }

  // Build the FTS match + rank (weighted combination across media / ai / transcripts).
  const rankExpr = hasQuery
    ? sql`ts_rank(
        coalesce(${mediaObjects.searchTsv}, ''::tsvector) ||
        coalesce(${aiOutputs.searchTsv}, ''::tsvector) ||
        coalesce(${transcripts.searchTsv}, ''::tsvector),
        websearch_to_tsquery('english', ${q})
      )`
    : sql`0::float4`;

  if (hasQuery) {
    conditions.push(
      sql`(
        coalesce(${mediaObjects.searchTsv}, ''::tsvector) ||
        coalesce(${aiOutputs.searchTsv}, ''::tsvector) ||
        coalesce(${transcripts.searchTsv}, ''::tsvector)
      ) @@ websearch_to_tsquery('english', ${q})`
    );
  }

  const orderBy = hasQuery
    ? sql`rank DESC, ${mediaObjects.createdAt} DESC`
    : sort === "date_asc"
      ? sql`${mediaObjects.createdAt} ASC`
      : sort === "duration_desc"
        ? sql`${mediaObjects.durationSeconds} DESC NULLS LAST`
        : sort === "duration_asc"
          ? sql`${mediaObjects.durationSeconds} ASC NULLS LAST`
          : sort === "views_desc"
            ? sql`view_count DESC`
            : sort === "title_asc"
              ? sql`coalesce(${mediaObjects.title}, ${aiOutputs.titleSuggested}, '') ASC`
              : sql`${mediaObjects.createdAt} DESC`;

  const viewCountExpr = sql<number>`
    (SELECT count(*)::int FROM ${views}
      WHERE ${views.mediaObjectId} = ${mediaObjects.id})
  `.as("view_count");

  const rows = await db
    .select({
      rec: mediaObjects,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
      brandLogoUrl: brandProfiles.logoUrl,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
      viewCount: viewCountExpr,
      rank: rankExpr.as("rank"),
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r.rec,
    brand: r.brandId
      ? {
          id: r.brandId,
          name: r.brandName!,
          accentColor: r.brandAccent!,
          logoUrl: r.brandLogoUrl ?? null,
        }
      : null,
    aiTitle: r.aiTitle,
    aiSummary: r.aiSummary,
    aiChapters: r.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: r.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount: r.viewCount ?? 0,
  }));
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/search.ts
git commit -m "feat(search): searchRecordings with FTS rank + filter + sort"
```

---

## Task 5: Folder CRUD API routes

**Files:**
- Create: `src/app/api/folders/route.ts`
- Create: `src/app/api/folders/[id]/route.ts`

- [ ] **Step 1: POST /api/folders (create)**

Create `src/app/api/folders/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  createFolder,
  getFolderOwned,
} from "@/db/queries/folders";

export async function POST(request: Request) {
  const user = await requireAuth();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    parentId?: string | null;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }
  if (body.parentId) {
    const parent = await getFolderOwned(body.parentId, user.id);
    if (!parent) {
      return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
    }
  }
  try {
    const folder = await createFolder({
      ownerId: user.id,
      name,
      parentId: body.parentId ?? null,
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "name_in_use" }, { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 2: PATCH + DELETE /api/folders/[id]**

Create `src/app/api/folders/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  deleteFolderOwned,
  getFolderOwned,
  listFoldersForOwner,
  updateFolder,
} from "@/db/queries/folders";
import { wouldCreateCycle } from "@/lib/folders/cycle";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    parentId?: string | null;
  };

  const current = await getFolderOwned(id, user.id);
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Move validation: cycle check against full flat tree.
  if (body.parentId !== undefined && body.parentId !== current.parentId) {
    if (body.parentId !== null) {
      const parent = await getFolderOwned(body.parentId, user.id);
      if (!parent) {
        return NextResponse.json(
          { error: "parent_not_found" },
          { status: 404 }
        );
      }
    }
    const all = await listFoldersForOwner(user.id);
    if (wouldCreateCycle(all, id, body.parentId)) {
      return NextResponse.json({ error: "cycle" }, { status: 400 });
    }
  }

  const name =
    typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined) {
    if (!name) {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json({ error: "name_too_long" }, { status: 400 });
    }
  }

  try {
    const ok = await updateFolder({
      id,
      ownerId: user.id,
      name,
      parentId: body.parentId,
    });
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "name_in_use" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const ok = await deleteFolderOwned({ id, ownerId: user.id });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5
git add 'src/app/api/folders/route.ts' 'src/app/api/folders/[id]/route.ts'
git commit -m "feat(api): folders POST / PATCH / DELETE (owner-scoped, cycle-checked)"
```

---

## Task 6: Recording folder move + soft delete

**Files:**
- Create: `src/app/api/recordings/[id]/folder/route.ts`
- Create: `src/app/api/recordings/[id]/route.ts`

- [ ] **Step 1: PATCH folder (move)**

Create `src/app/api/recordings/[id]/folder/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getFolderOwned, moveRecordingToFolder } from "@/db/queries/folders";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    folderId?: string | null;
  };
  if (body.folderId !== null && typeof body.folderId !== "string" && body.folderId !== undefined) {
    return NextResponse.json({ error: "bad_folder_id" }, { status: 400 });
  }
  const target = body.folderId ?? null;
  if (target !== null) {
    const f = await getFolderOwned(target, user.id);
    if (!f) {
      return NextResponse.json({ error: "folder_not_found" }, { status: 404 });
    }
  }
  const ok = await moveRecordingToFolder({
    recordingId: id,
    ownerId: user.id,
    folderId: target,
  });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: DELETE recording (soft)**

Create `src/app/api/recordings/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { softDeleteRecording } from "@/db/queries/recordings";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const ok = await softDeleteRecording(id, user.id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5
git add 'src/app/api/recordings/[id]/folder/route.ts' 'src/app/api/recordings/[id]/route.ts'
git commit -m "feat(api): move recording to folder + soft-delete recording"
```

---

## Task 7: FolderSidebar component

**Files:** `src/components/dashboard/folder-sidebar.tsx`

- [ ] **Step 1: Implement**

Create `src/components/dashboard/folder-sidebar.tsx`:
```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { Folder as DbFolder } from "@/db/queries/folders";

type Node = DbFolder & { children: Node[] };

function buildTree(folders: DbFolder[]): Node[] {
  const byId = new Map<string, Node>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: Node[] = [];
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function goto(
  router: ReturnType<typeof useRouter>,
  params: URLSearchParams,
  patch: Record<string, string | null>
) {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  router.push("/?" + next.toString());
}

export function FolderSidebar({
  folders,
  currentFolderId,
}: {
  folders: DbFolder[];
  currentFolderId: string | null | undefined;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(
    undefined
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-border px-3 py-4 text-sm">
      <SidebarLink
        icon={<Layers className="h-4 w-4" />}
        label="All recordings"
        active={currentFolderId === undefined}
        onClick={() => goto(router, params, { folder: null })}
      />
      <SidebarLink
        icon={<Inbox className="h-4 w-4" />}
        label="Unfiled"
        active={currentFolderId === null}
        onClick={() => goto(router, params, { folder: "__unfiled" })}
      />

      <div className="mt-4 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
        Folders
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => setCreatingParentId(null)}
          aria-label="New folder at root"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-1">
        {creatingParentId === null && (
          <NewFolderRow depth={0} parentId={null} onDone={() => setCreatingParentId(undefined)} />
        )}
        {tree.map((node) => (
          <FolderNodeRow
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            toggleExpand={toggleExpand}
            currentFolderId={currentFolderId}
            creatingParentId={creatingParentId}
            setCreatingParentId={setCreatingParentId}
          />
        ))}
      </div>
    </aside>
  );
}

function SidebarLink({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-bg-elevated text-text"
          : "text-text-muted hover:bg-bg-subtle hover:text-text"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function FolderNodeRow({
  node,
  depth,
  expanded,
  toggleExpand,
  currentFolderId,
  creatingParentId,
  setCreatingParentId,
}: {
  node: Node;
  depth: number;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  currentFolderId: string | null | undefined;
  creatingParentId: string | null | undefined;
  setCreatingParentId: (v: string | null | undefined) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const active = currentFolderId === node.id;
  const [renaming, setRenaming] = useState(false);

  async function onDropRecording(e: React.DragEvent) {
    e.preventDefault();
    const recordingId = e.dataTransfer.getData("application/x-recording-id");
    if (!recordingId) return;
    await fetch(`/api/recordings/${recordingId}/folder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: node.id }),
    });
    router.refresh();
  }

  async function deleteMe() {
    if (
      !confirm(
        `Delete folder "${node.name}"? Subfolders are also deleted; recordings inside become unfiled.`
      )
    ) {
      return;
    }
    await fetch(`/api/folders/${node.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1 py-1 text-sm transition-colors",
          active
            ? "bg-bg-elevated text-text"
            : "text-text-muted hover:bg-bg-subtle hover:text-text"
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={onDropRecording}
      >
        <button
          type="button"
          onClick={() => hasChildren && toggleExpand(node.id)}
          className={cn(
            "flex h-5 w-5 items-center justify-center transition-transform",
            hasChildren ? "opacity-100" : "opacity-0",
            isOpen && "rotate-90"
          )}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <Folder className="h-4 w-4 shrink-0" />
        {renaming ? (
          <RenameInput folderId={node.id} initial={node.name} onDone={() => setRenaming(false)} />
        ) : (
          <button
            type="button"
            onClick={() => goto(router, params, { folder: node.id })}
            className="flex-1 truncate text-left"
          >
            {node.name}
          </button>
        )}
        <div className="hidden items-center gap-0.5 group-hover:flex">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setCreatingParentId(node.id)}
            aria-label="New subfolder"
          >
            <FolderPlus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setRenaming(true)}
            aria-label="Rename folder"
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={deleteMe}
            aria-label="Delete folder"
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      </div>
      {creatingParentId === node.id && (
        <NewFolderRow
          depth={depth + 1}
          parentId={node.id}
          onDone={() => setCreatingParentId(undefined)}
        />
      )}
      {isOpen &&
        node.children.map((c) => (
          <FolderNodeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggleExpand={toggleExpand}
            currentFolderId={currentFolderId}
            creatingParentId={creatingParentId}
            setCreatingParentId={setCreatingParentId}
          />
        ))}
    </>
  );
}

function NewFolderRow({
  depth,
  parentId,
  onDone,
}: {
  depth: number;
  parentId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      onDone();
      return;
    }
    await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed, parentId }),
    });
    onDone();
    router.refresh();
  }
  return (
    <div style={{ paddingLeft: 20 + depth * 12 }} className="py-1 pr-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
        }}
        onBlur={save}
        placeholder="New folder"
        className="h-7 text-xs"
      />
    </div>
  );
}

function RenameInput({
  folderId,
  initial,
  onDone,
}: {
  folderId: string;
  initial: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initial) {
      onDone();
      return;
    }
    await fetch(`/api/folders/${folderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    onDone();
    router.refresh();
  }
  return (
    <Input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") onDone();
      }}
      onBlur={save}
      className="h-6 flex-1 text-xs"
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/folder-sidebar.tsx
git commit -m "feat(dashboard): FolderSidebar with tree, DnD target, inline create/rename/delete"
```

---

## Task 8: SearchFilterBar component

**Files:** `src/components/dashboard/search-filter-bar.tsx`

- [ ] **Step 1: Implement**

Create `src/components/dashboard/search-filter-bar.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { BrandProfile } from "@/db/queries/brand-profiles";

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "transcribing", label: "Transcribing" },
  { value: "uploading", label: "Uploading" },
  { value: "failed", label: "Failed" },
];

const SORTS = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "duration_desc", label: "Longest first" },
  { value: "duration_asc", label: "Shortest first" },
  { value: "views_desc", label: "Most viewed" },
  { value: "title_asc", label: "Title A-Z" },
];

export function SearchFilterBar({ brands }: { brands: BrandProfile[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState(params.get("q") ?? "");

  // Debounced URL push on query change
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q) next.set("q", q);
      else next.delete("q");
      router.push("/?" + next.toString());
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Cmd-K / Ctrl-K focuses the search input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function patchParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.push("/?" + next.toString());
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles + transcripts…"
          className="pl-9"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border-strong bg-bg-elevated px-1.5 font-mono text-[10px] text-text-subtle sm:inline-flex">
          ⌘K
        </kbd>
      </div>
      <Select
        className="sm:w-44"
        value={params.get("sort") ?? "date_desc"}
        onChange={(e) => patchParam("sort", e.target.value)}
      >
        {SORTS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Select
        className="sm:w-40"
        value={params.get("status") ?? ""}
        onChange={(e) => patchParam("status", e.target.value)}
      >
        {STATUSES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {brands.length > 0 && (
        <Select
          className="sm:w-44"
          value={params.get("brand") ?? ""}
          onChange={(e) => patchParam("brand", e.target.value)}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/search-filter-bar.tsx
git commit -m "feat(dashboard): SearchFilterBar with debounced FTS + sort + status + brand"
```

---

## Task 9: RecordingCardMenu + draggable card

**Files:**
- Create: `src/components/dashboard/recording-card-menu.tsx`
- Modify: `src/components/dashboard/recording-card.tsx`

- [ ] **Step 1: Implement the menu**

Create `src/components/dashboard/recording-card-menu.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Trash2, FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Folder } from "@/db/queries/folders";
import { cn } from "@/lib/cn";

export function RecordingCardMenu({
  recordingId,
  folders,
}: {
  recordingId: string;
  folders: Folder[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showMove, setShowMove] = useState(false);

  async function moveTo(folderId: string | null) {
    await fetch(`/api/recordings/${recordingId}/folder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    setOpen(false);
    setShowMove(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("Delete this recording?")) return;
    await fetch(`/api/recordings/${recordingId}`, { method: "DELETE" });
    setOpen(false);
    router.refresh();
  }

  return (
    <div
      className="relative"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 bg-bg/80 backdrop-blur hover:bg-bg-elevated"
        onClick={() => setOpen(!open)}
        aria-label="Card actions"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setShowMove(false);
            }}
          />
          <div className="absolute right-0 top-8 z-50 w-48 rounded-md border border-border-strong bg-bg-elevated p-1 text-sm shadow-lg">
            {showMove ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowMove(false)}
                  className="mb-1 w-full rounded px-2 py-1.5 text-left text-text-subtle hover:bg-bg-subtle hover:text-text-muted"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => moveTo(null)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                >
                  Unfiled
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => moveTo(f.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                    )}
                  >
                    {f.name}
                  </button>
                ))}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowMove(true)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  Move to folder
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Make card draggable + mount the menu**

Open `src/components/dashboard/recording-card.tsx`. Add import at the top:
```tsx
import { RecordingCardMenu } from "./recording-card-menu";
import type { Folder } from "@/db/queries/folders";
```

Change the component signature to accept `folders`:
```tsx
export function RecordingCard({
  rec,
  thumbnailUrl,
  folders,
}: {
  rec: RecordingWithBrand;
  thumbnailUrl: string | null;
  folders: Folder[];
}) {
```

Change the outer `<Link>` to include drag handlers and a wrapper. We can't make a Next `<Link>` directly `draggable` cleanly, so replace with a div wrapper + inner Link:
```tsx
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-recording-id", rec.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group relative"
    >
      <Link
        href={`/v/${rec.slug}`}
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-bg-subtle transition-colors hover:border-border-strong"
      >
        {/* ... existing thumbnail block, badge, meta — unchanged ... */}
      </Link>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <RecordingCardMenu recordingId={rec.id} folders={folders} />
      </div>
    </div>
  );
```

Wrap the thumbnail + meta content inside the `<Link>`. Drop the `className="group ..."` from the original `<Link>` (it's on the wrapper now).

Full file for certainty:
```tsx
import Link from "next/link";
import { Film } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RecordingCardMenu } from "./recording-card-menu";
import type { RecordingWithBrand } from "@/db/queries/recordings";
import type { Folder } from "@/db/queries/folders";

function formatDuration(seconds: string | number | null): string {
  if (seconds === null) return "—";
  const n = typeof seconds === "string" ? parseFloat(seconds) : seconds;
  if (!isFinite(n)) return "—";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatShortDate(date: Date): string {
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

type BadgeVariant =
  | "ready"
  | "uploading"
  | "failed"
  | "processing"
  | "transcribing";

export function RecordingCard({
  rec,
  thumbnailUrl,
  folders,
}: {
  rec: RecordingWithBrand;
  thumbnailUrl: string | null;
  folders: Folder[];
}) {
  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const accent = rec.brand?.accentColor;
  const statusVariant: BadgeVariant =
    rec.status === "ready"
      ? "ready"
      : rec.status === "uploading"
        ? "uploading"
        : rec.status === "failed"
          ? "failed"
          : rec.status === "transcribing"
            ? "transcribing"
            : "processing";

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-recording-id", rec.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group relative"
    >
      <Link
        href={`/v/${rec.slug}`}
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-bg-subtle transition-colors hover:border-border-strong"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-bg-elevated">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-subtle">
              <Film className="h-8 w-8" />
            </div>
          )}
          <div className="absolute left-2 top-2">
            <Badge variant={statusVariant}>{rec.status}</Badge>
          </div>
          {accent && (
            <div
              className="absolute inset-x-0 bottom-0 h-[3px]"
              style={{ backgroundColor: accent }}
            />
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <h3 className="truncate text-sm font-medium text-text">{displayTitle}</h3>
          <div className="flex items-center gap-1.5 text-xs text-text-subtle">
            <span>{formatDuration(rec.durationSeconds)}</span>
            <span>·</span>
            <span>{formatShortDate(new Date(rec.createdAt))}</span>
            {rec.viewCount > 0 && (
              <>
                <span>·</span>
                <span>
                  {rec.viewCount} view{rec.viewCount === 1 ? "" : "s"}
                </span>
              </>
            )}
            {rec.brand && (
              <>
                <span>·</span>
                <span className="truncate">{rec.brand.name}</span>
              </>
            )}
          </div>
        </div>
      </Link>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <RecordingCardMenu recordingId={rec.id} folders={folders} />
      </div>
    </div>
  );
}
```

Note: I moved the status Badge to `left-2 top-2` so it doesn't collide with the menu at `right-2 top-2`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/recording-card.tsx src/components/dashboard/recording-card-menu.tsx
git commit -m "feat(dashboard): draggable card + hover context menu (move / delete)"
```

---

## Task 10: Breadcrumbs component

**Files:** `src/components/dashboard/breadcrumbs.tsx`

- [ ] **Step 1: Implement**

Create `src/components/dashboard/breadcrumbs.tsx`:
```tsx
"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Folder } from "@/db/queries/folders";

export function Breadcrumbs({
  folders,
  currentId,
}: {
  folders: Folder[];
  currentId: string;
}) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  let cursor: Folder | undefined = byId.get(currentId);
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  if (chain.length === 0) return null;
  return (
    <nav className="flex items-center gap-1 text-sm text-text-muted">
      <Link href="/" className="hover:text-text">
        All recordings
      </Link>
      {chain.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-text-subtle" />
          {i === chain.length - 1 ? (
            <span className="text-text">{f.name}</span>
          ) : (
            <Link
              href={`/?folder=${f.id}`}
              className="hover:text-text"
            >
              {f.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/breadcrumbs.tsx
git commit -m "feat(dashboard): Breadcrumbs component for folder path"
```

---

## Task 11: Dashboard layout rework

**Files:** `src/app/page.tsx`

- [ ] **Step 1: Rewrite page**

Overwrite `src/app/page.tsx`:
```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { listFoldersForOwner } from "@/db/queries/folders";
import {
  searchRecordings,
  type SearchSort,
} from "@/db/queries/search";
import { presignGet } from "@/lib/r2/presigned-get";
import { TopNav } from "@/components/nav/top-nav";
import { FolderSidebar } from "@/components/dashboard/folder-sidebar";
import { SearchFilterBar } from "@/components/dashboard/search-filter-bar";
import { Breadcrumbs } from "@/components/dashboard/breadcrumbs";
import { RecordingCard } from "@/components/dashboard/recording-card";
import { Button } from "@/components/ui/button";

const VALID_SORTS: SearchSort[] = [
  "date_desc",
  "date_asc",
  "duration_desc",
  "duration_asc",
  "views_desc",
  "title_asc",
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAuth();
  const sp = await searchParams;

  const folderParam = sp.folder ?? "";
  const folderId: string | null | undefined =
    folderParam === "" ? undefined : folderParam === "__unfiled" ? null : folderParam;

  const query = sp.q?.trim() || undefined;
  const sortParam = sp.sort as SearchSort | undefined;
  const sort: SearchSort = sortParam && VALID_SORTS.includes(sortParam) ? sortParam : "date_desc";
  const status = sp.status ? [sp.status] : undefined;
  const brandId = sp.brand || undefined;

  const [folders, brands, recordings] = await Promise.all([
    listFoldersForOwner(user.id),
    listBrandProfiles(user.id),
    searchRecordings({
      ownerId: user.id,
      query,
      folderId,
      status,
      brandId,
      sort,
      limit: 100,
    }),
  ]);

  const thumbnailUrls: Record<string, string> = {};
  await Promise.all(
    recordings.map(async (r) => {
      if (r.compositeThumbnailKey) {
        thumbnailUrls[r.id] = await presignGet(r.compositeThumbnailKey);
      }
    })
  );

  const currentFolder = typeof folderId === "string"
    ? folders.find((f) => f.id === folderId)
    : undefined;
  const title =
    folderId === null
      ? "Unfiled"
      : currentFolder
        ? currentFolder.name
        : "All recordings";

  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <div className="mx-auto flex max-w-6xl">
        <FolderSidebar folders={folders} currentFolderId={folderId} />
        <main className="min-w-0 flex-1 px-6 py-8">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              {currentFolder && (
                <Breadcrumbs folders={folders} currentId={currentFolder.id} />
              )}
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">
                {title}
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                {recordings.length === 0
                  ? query
                    ? `No matches for “${query}”.`
                    : "No recordings yet."
                  : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}${query ? ` matching “${query}”` : ""}`}
              </p>
            </div>
            <Link href="/record">
              <Button>
                <Plus className="h-4 w-4" />
                New recording
              </Button>
            </Link>
          </div>

          <div className="mt-6">
            <SearchFilterBar brands={brands} />
          </div>

          <div className="mt-8">
            {recordings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
                <p className="text-sm text-text-muted">
                  {query
                    ? `No recordings match “${query}”.`
                    : "Drop recordings here or hit New recording to get started."}
                </p>
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {recordings.map((r) => (
                  <li key={r.id}>
                    <RecordingCard
                      rec={r}
                      thumbnailUrl={thumbnailUrls[r.id] ?? null}
                      folders={folders}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Delete the now-unused RecordingList**

The old `src/components/dashboard/recording-list.tsx` is no longer referenced. Remove it:
```bash
rm src/components/dashboard/recording-list.tsx
```

- [ ] **Step 3: Build**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -15
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git rm src/components/dashboard/recording-list.tsx
git commit -m "feat(dashboard): sidebar + search + filter + folder-scoped layout"
```

---

## Task 12: Ship + live smoke + mark Stage 1.5 complete

**Files:** `ROADMAP.md`, `CLAUDE.md`

- [ ] **Step 1: Push + wait for deploy**

```bash
git push origin main
until ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Status}}" | grep -q "Up [0-9]\+ seconds"'; do sleep 20; done
ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}} {{.Status}}"'
```

- [ ] **Step 2: Verify migration ran**

```bash
ssh vps 'docker logs $(docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}}") --tail 40 2>&1' | grep -E "migrations|boot|Ready"
```

Expected: "migrations applied" line, boot summary, "Ready in NNms".

- [ ] **Step 3: Smoke**

```bash
npm run smoke
```

Expected: all 9 steps ✓. The smoke doesn't exercise folders/search directly, but it verifies no regression in the pipeline.

- [ ] **Step 4: Quick sanity test via HTTP**

```bash
# Unauth folders call should 307 redirect to /login
curl -s -o /dev/null -w "folders (unauth): %{http_code}\n" "https://loom.dissonance.cloud/api/folders" -X POST -H "content-type: application/json" -d '{"name":"x"}'
# Dashboard with search param loads (unauth redirects to /login)
curl -s -o /dev/null -w "dashboard q=: %{http_code}\n" "https://loom.dissonance.cloud/?q=test"
```

Expected: both 307.

- [ ] **Step 5: Update ROADMAP.md**

Add a new section at the very bottom of `ROADMAP.md`:
```
## Stage 1.5 — Premium UX + Organization

| Phase | What it ships |
|-------|---------------|
| 1.5a  | Design system tokens (dark + light), Geist fonts, primitive components, full retheme of every existing surface |
| 1.5b  | `folders` table with subfolders, Postgres FTS over title + transcripts, sort/filter, sidebar dashboard layout, drag-and-drop recordings between folders, card hover-menu (move / delete) |

**Status:** ✅ shipped 2026-04-24. Primary dashboard now at `/?q=...&sort=...&folder=...&status=...&brand=...`.
```

- [ ] **Step 6: Update CLAUDE.md**

Append to the milestone list in `CLAUDE.md`:
```
- [x] **Stage 1.5a: Design system + reskin** — CSS-var tokens, dark/light, Geist fonts, primitives under src/components/ui/, every surface rethemed.
- [x] **Stage 1.5b: Folders + search** — `folders` table (self-ref parent), `folder_id` + `search_tsv` generated columns with GIN; FolderSidebar + SearchFilterBar + drag-and-drop; context menu (move / delete). URL params drive dashboard state.
```

- [ ] **Step 7: Commit + push**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "chore(stage-1.5): mark premium UX + organization milestone shipped"
git push origin main
```

---

## Self-Review Notes

- Spec coverage:
  - Folders table + FK + unique index → Task 1.
  - Generated tsvector + GIN → Task 1.
  - Cycle detection (pure + tests) → Task 2.
  - Folder CRUD queries → Task 3.
  - Search query → Task 4.
  - Folder API routes → Task 5.
  - Recording move + soft-delete → Task 6.
  - Sidebar w/ tree, DnD, inline CRUD → Task 7.
  - Search bar, debounce, Cmd-K, sort, status, brand → Task 8.
  - Card context menu + draggable → Task 9.
  - Breadcrumbs → Task 10.
  - Dashboard layout → Task 11.
  - Deploy + mark shipped → Task 12.

- Types consistent: `Folder` alias consistent across files; `SearchSort` enum; `searchRecordings` signature matches the page's call; `RecordingCard` gains `folders` prop.

- Risk mitigations:
  - Cycle: explicit check at route + tests.
  - Unique name collision: HTTP 409 with Postgres 23505 sniff.
  - FTS: weighted vectors across 3 tables, unioned in query.
  - Drag-and-drop mobile: acceptable per spec.
