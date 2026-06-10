# OSS Readiness Phase 2 — Accounts: First-Run, Reset, Invites

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hoster never opens the Supabase dashboard to manage accounts: first boot offers an in-app "create your admin account" flow, passwords are resettable, and additional users join via admin-issued invite links. No open signup.

**Architecture:** First-run detection (`auth.users` empty) gates a `/setup` page that creates the admin via the service-role client. A `role` column on `user_preferences` (admin/member) gates an invites API + settings surface. Invite tokens are random 32-byte secrets stored as SHA-256 hashes with 7-day expiry; accepting one creates a member account. Supabase's built-in recovery flow powers password reset through the existing `/auth/callback?next=` mechanism. The MCP server's silent "first user" fallback becomes an explicit error when multiple users exist.

**Tech Stack:** Next.js 15 server actions, Supabase auth admin API, Drizzle (migrations 0026+), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-open-source-readiness-design.md` Phase 2.

**⚠️ Working-tree warning:** Unrelated uncommitted transcript-export work exists (`src/app/recordings/[id]/edit/page.tsx`, untracked `src/lib/recordings/transcript-export.ts`, `src/app/api/recordings/[id]/transcript.md/`, `transcript.srt/`, `tests/unit/recording-transcript-export.test.ts`). NEVER `git add -A`/`git add .`/`commit -a`; stage only files named per task.

**Key existing patterns to mirror (read these before coding):**
- `src/app/api/mcp/tools/owner.ts` — how raw `auth.users` SQL is executed via the db client
- `src/app/login/page.tsx` + `src/app/login/actions.ts` — page styling (CSS-var tokens, Input/Button components) and server-action redirect-with-error pattern
- `src/lib/supabase/service.ts` — `getSupabaseService()` service-role client
- `src/db/schema.ts` — table/column conventions (uuid pk defaultRandom, timestamps)
- `drizzle/0025_user_preferences.sql` + `drizzle/meta/_journal.json` — migration + journal conventions; generate new migrations with `npx drizzle-kit generate --custom --name=<name>` then fill in SQL
- `src/app/settings/migration/page.tsx` — settings page layout (TopNav + max-w main)

---

### Task 1: Schema — `role` column, `invites` table, migration with admin backfill

**Files:**
- Modify: `src/db/schema.ts` (add `role` to `userPreferences`; add `invites` table)
- Create: `drizzle/0026_roles_and_invites.sql` via `npx drizzle-kit generate --custom --name=roles_and_invites` (creates the file + journal entry; then fill in the SQL below)

- [ ] **Step 1: schema.ts changes**

In `userPreferences`, after `ownerId`, add:

```typescript
  // "admin" can invite/revoke users; "member" is everything else. The first
  // account (first-run /setup) is admin; invited accounts are members.
  role: text("role").notNull().default("member"),
```

At the end of the schema tables (near other Granola-era tables), add:

```typescript
// invites — admin-issued, single-use, expiring signup links. The raw token
// is shown/emailed once; only its SHA-256 lands in the DB.
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: uuid("created_by").notNull(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

(Check the file's actual timestamp convention first — if existing tables use plain `timestamp(...)` without timezone, match that instead, and say so in your report.)

- [ ] **Step 2: migration SQL** (into the generated empty 0026 file)

```sql
ALTER TABLE "user_preferences" ADD COLUMN "role" text NOT NULL DEFAULT 'member';
--> statement-breakpoint
-- Existing instances are single-user: every current user becomes admin.
INSERT INTO "user_preferences" ("owner_id", "role")
SELECT u.id, 'admin' FROM auth.users u
ON CONFLICT ("owner_id") DO UPDATE SET "role" = 'admin';
--> statement-breakpoint
CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_by" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "email" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App connects as postgres (bypasses RLS); policy is defense-in-depth like 0013.
CREATE POLICY "invites_owner_all" ON "invites"
  FOR ALL USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
```

Adjust column types in the INSERT/backfill if the user_preferences PK column name differs (it is `owner_id`). If the 0025 migration used a different RLS policy phrasing, mirror 0013/0025's exact style.

- [ ] **Step 3: apply + verify**

Run: `npm run db:migrate` (applies against the dev DATABASE_URL). Then verify: `npx tsx -e "import {db} from './src/db'; import {sql} from 'drizzle-orm'; db.execute(sql\`SELECT role, count(*) FROM user_preferences GROUP BY role\`).then(r => {console.log(r); process.exit(0)})"` — expect existing row(s) showing `admin`.
Run: `npm run typecheck && npm run test` — green.

**⚠️ This migrates Ian's production database** (dev DATABASE_URL points at the same Supabase project). The SQL is additive (new column with default, new table, backfill of a 1-row table) — safe. Double-check the SQL before running; do NOT run anything destructive.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/0026_roles_and_invites.sql drizzle/meta/_journal.json
git commit -m "Add user roles and invites schema"
```
(Also stage any other drizzle/meta snapshot file the generate command produced.)

---

### Task 2: Pure invite token + validation logic

**Files:**
- Create: `src/lib/invites/token.ts`
- Test: `tests/unit/invite-token.test.ts`

- [ ] **Step 1: failing test**

```typescript
// tests/unit/invite-token.test.ts
import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  validateInvite,
} from "@/lib/invites/token";

describe("invite tokens", () => {
  it("generates a 64-hex-char token whose hash matches hashInviteToken", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toBe(token);
  });

  it("two generations never collide", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });
});

describe("validateInvite", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const future = new Date("2026-06-11T12:00:00Z");
  const past = new Date("2026-06-09T12:00:00Z");

  it("rejects null (not found)", () => {
    expect(validateInvite(null, now)).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects expired", () => {
    expect(validateInvite({ expiresAt: past, acceptedAt: null }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects already accepted", () => {
    expect(
      validateInvite({ expiresAt: future, acceptedAt: past }, now)
    ).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("accepts a live invite", () => {
    expect(
      validateInvite({ expiresAt: future, acceptedAt: null }, now)
    ).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: run to fail**, then implement:

```typescript
// src/lib/invites/token.ts
import { createHash, randomBytes } from "node:crypto";

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InviteValidation =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "already_accepted" };

export function validateInvite(
  invite: { expiresAt: Date; acceptedAt: Date | null } | null,
  now: Date
): InviteValidation {
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.acceptedAt) return { ok: false, reason: "already_accepted" };
  if (invite.expiresAt.getTime() <= now.getTime())
    return { ok: false, reason: "expired" };
  return { ok: true };
}
```

- [ ] **Step 3: pass + commit**

```bash
git add src/lib/invites/token.ts tests/unit/invite-token.test.ts
git commit -m "Add invite token generation and validation logic"
```

---

### Task 3: First-run detection + /setup + middleware

**Files:**
- Create: `src/lib/auth/first-run.ts`, `src/lib/auth/roles.ts`, `src/app/setup/page.tsx`, `src/app/setup/actions.ts`
- Modify: `src/lib/supabase/middleware.ts` (allow /setup unauthed; bounce authed users off /setup), `src/app/login/page.tsx` (redirect to /setup on first run)

- [ ] **Step 1: helpers**

```typescript
// src/lib/auth/first-run.ts
import { db } from "@/db";
import { sql } from "drizzle-orm";

/** True once any account exists. Mirrors the raw auth.users access pattern
 * in src/app/api/mcp/tools/owner.ts. */
export async function hasAnyUser(): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 FROM auth.users LIMIT 1`);
  return rows.length > 0;
}
```

(Verify the `db.execute` result shape against owner.ts — if it returns `{ rows }` or similar, adapt; the unit of truth is how owner.ts reads its result.)

```typescript
// src/lib/auth/roles.ts
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";

export type UserRole = "admin" | "member";

export async function getUserRole(ownerId: string): Promise<UserRole> {
  const rows = await db
    .select({ role: userPreferences.role })
    .from(userPreferences)
    .where(eq(userPreferences.ownerId, ownerId))
    .limit(1);
  return rows[0]?.role === "admin" ? "admin" : "member";
}
```

- [ ] **Step 2: /setup action**

```typescript
// src/app/setup/actions.ts
"use server";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { hasAnyUser } from "@/lib/auth/first-run";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseService } from "@/lib/supabase/service";
import { redirect } from "next/navigation";

export async function createAdminAccount(formData: FormData) {
  // Re-check inside the action: the page-level check is advisory only.
  if (await hasAnyUser()) {
    return redirect("/login?error=Setup%20is%20already%20complete");
  }

  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const password = (formData.get("password") as string | null) ?? "";
  if (!email || !email.includes("@")) {
    return redirect("/setup?error=Enter%20a%20valid%20email");
  }
  if (password.length < 8) {
    return redirect("/setup?error=Password%20must%20be%20at%20least%208%20characters");
  }

  const service = getSupabaseService();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    return redirect(
      `/setup?error=${encodeURIComponent(error?.message ?? "Could not create account")}`
    );
  }

  await db
    .insert(userPreferences)
    .values({ ownerId: data.user.id, role: "admin" })
    .onConflictDoUpdate({
      target: userPreferences.ownerId,
      set: { role: "admin" },
    });

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  return redirect("/");
}
```

- [ ] **Step 3: /setup page** — mirror `src/app/login/page.tsx` structure exactly (same logo Image block, same form card classes, same error rendering, same Input/Button imports):

```typescript
// src/app/setup/page.tsx
import Image from "next/image";
import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth/first-run";
import { createAdminAccount } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await hasAnyUser()) redirect("/login");
  const params = await searchParams;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Image
        src="/branding/loomola-logo-inline.png"
        alt="loomola"
        width={180}
        height={48}
        priority
        className="h-12 w-auto dark:brightness-0 dark:invert"
      />
      <form
        action={createAdminAccount}
        className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-bg-subtle p-8"
      >
        <div>
          <h1 className="text-base font-semibold text-text">
            Create your admin account
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            This instance has no users yet. The account you create here owns it.
          </p>
        </div>
        {params.error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            {params.error}
          </p>
        )}
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            Email
          </label>
          <Input id="email" name="email" type="email" required autoComplete="email" className="mt-1.5" />
        </div>
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            Password
          </label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1.5" />
        </div>
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: middleware** — in `src/lib/supabase/middleware.ts`, add alongside the other predicates:

```typescript
  // First-run admin creation + invite acceptance: must be reachable signed-out.
  const isSetup = url.pathname === "/setup" || url.pathname.startsWith("/setup/accept/");
```

Add `!isSetup` to the big unauthed-redirect condition. And after the existing `user && /login` redirect, add:

```typescript
  if (user && url.pathname.startsWith("/setup")) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
```

- [ ] **Step 5: login page first-run redirect** — at the top of the `LoginPage` component body in `src/app/login/page.tsx` (it's already async), add:

```typescript
  if (!(await hasAnyUser())) redirect("/setup");
```

with imports `import { redirect } from "next/navigation";` and `import { hasAnyUser } from "@/lib/auth/first-run";`. Note: `/login` is currently a static-ish page; importing db makes it dynamic — add `export const dynamic = "force-dynamic";` if not present.

- [ ] **Step 6: verify**

`npm run typecheck && npm run test && npm run lint`. Manual: `npm run dev`, visit `/setup` while users exist → must redirect to `/login`. (The true first-run path can't be tested against the dev DB — it has users; the scratch-Supabase manual gate covers it.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/first-run.ts src/lib/auth/roles.ts src/app/setup/page.tsx src/app/setup/actions.ts src/lib/supabase/middleware.ts src/app/login/page.tsx
git commit -m "Add first-run admin setup flow"
```

---

### Task 4: Password reset

**Files:**
- Create: `src/app/login/forgot/page.tsx`, `src/app/login/forgot/actions.ts`, `src/app/auth/reset/page.tsx`, `src/app/auth/reset/reset-form.tsx`
- Modify: `src/app/login/page.tsx` (add "Forgot password?" link under the Button)

- [ ] **Step 1: forgot action + page**

```typescript
// src/app/login/forgot/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function sendResetEmail(formData: FormData) {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  if (!email) return redirect("/login/forgot?error=Enter%20your%20email");

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  // Always claim success — don't leak which emails have accounts.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/callback?next=/auth/reset`,
  });
  return redirect("/login/forgot?sent=1");
}
```

```typescript
// src/app/login/forgot/page.tsx
import Image from "next/image";
import { sendResetEmail } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Image
        src="/branding/loomola-logo-inline.png"
        alt="loomola"
        width={180}
        height={48}
        priority
        className="h-12 w-auto dark:brightness-0 dark:invert"
      />
      <form
        action={sendResetEmail}
        className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-bg-subtle p-8"
      >
        <h1 className="text-base font-semibold text-text">Reset password</h1>
        {params.sent ? (
          <p className="rounded-md border border-border bg-bg p-2.5 text-xs text-text-muted">
            If that email has an account, a reset link is on its way.
          </p>
        ) : (
          <>
            {params.error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                {params.error}
              </p>
            )}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
              >
                Email
              </label>
              <Input id="email" name="email" type="email" required autoComplete="email" className="mt-1.5" />
            </div>
            <Button type="submit" className="w-full">
              Send reset link
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 2: reset page** (after the email link, `/auth/callback` exchanges the code and lands here signed-in):

```typescript
// src/app/auth/reset/page.tsx
import { requireAuth } from "@/lib/require-auth";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  await requireAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <ResetForm />
    </div>
  );
}
```

```typescript
// src/app/auth/reset/reset-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/");
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-bg-subtle p-8"
    >
      <h1 className="text-base font-semibold text-text">Choose a new password</h1>
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </p>
      )}
      <div>
        <label
          htmlFor="password"
          className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          New password
        </label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5"
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
```

(Check `src/lib/supabase/client.ts` for the browser client's export name and mirror its existing usage elsewhere, e.g. any "use client" component that already imports it.)

- [ ] **Step 3: login page link** — under the submit Button in `src/app/login/page.tsx`:

```tsx
        <a
          href="/login/forgot"
          className="block text-center text-xs text-text-muted hover:text-text"
        >
          Forgot password?
        </a>
```

- [ ] **Step 4: verify + commit**

`npm run typecheck && npm run lint && npm run test`. Manual end-to-end needs email delivery — covered in the verification gate (Task 8).

```bash
git add src/app/login/forgot src/app/auth/reset src/app/login/page.tsx
git commit -m "Add password reset flow"
```

---

### Task 5: Invite queries + API + email

**Files:**
- Create: `src/db/queries/invites.ts`, `src/app/api/invites/route.ts`, `src/app/api/invites/[id]/route.ts`
- Test: extend `tests/unit/invite-token.test.ts` only if you add pure logic; DB/API surfaces are covered by typecheck + the manual gate.

- [ ] **Step 1: queries**

```typescript
// src/db/queries/invites.ts
import { db } from "@/db";
import { invites } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvite(params: {
  createdBy: string;
  email: string;
  tokenHash: string;
}) {
  const [row] = await db
    .insert(invites)
    .values({
      createdBy: params.createdBy,
      email: params.email,
      tokenHash: params.tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();
  return row;
}

export async function getInviteByTokenHash(tokenHash: string) {
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function markInviteAccepted(id: string) {
  await db
    .update(invites)
    .set({ acceptedAt: new Date() })
    .where(eq(invites.id, id));
}

export async function listInvites() {
  return db.select().from(invites).orderBy(desc(invites.createdAt)).limit(100);
}

export async function deleteInvite(id: string) {
  await db.delete(invites).where(eq(invites.id, id));
}
```

- [ ] **Step 2: API routes** — follow the existing route conventions (zod safeParse → 400; requireAuth(request)):

```typescript
// src/app/api/invites/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { getUserRole } from "@/lib/auth/roles";
import { generateInviteToken } from "@/lib/invites/token";
import { createInvite, listInvites } from "@/db/queries/invites";
import { isEmailConfigured, sendEmail } from "@/lib/mail/mailgun";

function acceptUrlFor(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/setup/accept/${token}`;
}

export async function GET(request: Request) {
  const user = await requireAuth(request);
  if ((await getUserRole(user.id)) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const rows = await listInvites();
  // tokenHash never leaves the server.
  return NextResponse.json({
    invites: rows.map(({ tokenHash: _tokenHash, ...rest }) => rest),
  });
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if ((await getUserRole(user.id)) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const { token, tokenHash } = generateInviteToken();
  const invite = await createInvite({
    createdBy: user.id,
    email: parsed.data.email,
    tokenHash,
  });
  const acceptUrl = acceptUrlFor(token);

  let emailed = false;
  if (isEmailConfigured()) {
    try {
      await sendEmail({
        to: parsed.data.email,
        subject: "You're invited to Loomola",
        text: `You've been invited to a Loomola instance. Accept here (link expires in 7 days): ${acceptUrl}`,
        html: `<p>You've been invited to a Loomola instance.</p><p><a href="${acceptUrl}">Accept the invite</a> (expires in 7 days).</p>`,
      });
      emailed = true;
    } catch (e) {
      console.error("[invites] email send failed", e);
    }
  }

  return NextResponse.json({
    id: invite.id,
    email: invite.email,
    expiresAt: invite.expiresAt,
    acceptUrl,
    emailed,
  });
}
```

```typescript
// src/app/api/invites/[id]/route.ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getUserRole } from "@/lib/auth/roles";
import { deleteInvite } from "@/db/queries/invites";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  if ((await getUserRole(user.id)) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const { id } = await params;
  await deleteInvite(id);
  return NextResponse.json({ ok: true });
}
```

(Match the repo's actual dynamic-params convention — check a neighboring `[id]` route for whether params is a Promise in this Next version, and mirror it.)

- [ ] **Step 3: verify + commit**

`npm run typecheck && npm run lint && npm run test`.

```bash
git add src/db/queries/invites.ts src/app/api/invites
git commit -m "Add invite creation, listing, revocation API"
```

---

### Task 6: Invite accept flow

**Files:**
- Create: `src/app/setup/accept/[token]/page.tsx`, `src/app/setup/accept/[token]/actions.ts`

- [ ] **Step 1: action**

```typescript
// src/app/setup/accept/[token]/actions.ts
"use server";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { getInviteByTokenHash, markInviteAccepted } from "@/db/queries/invites";
import { hashInviteToken, validateInvite } from "@/lib/invites/token";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseService } from "@/lib/supabase/service";
import { redirect } from "next/navigation";

export async function acceptInvite(token: string, formData: FormData) {
  const invite = await getInviteByTokenHash(hashInviteToken(token));
  const validation = validateInvite(invite, new Date());
  if (!validation.ok) {
    return redirect(`/setup/accept/${token}?error=${validation.reason}`);
  }

  const password = (formData.get("password") as string | null) ?? "";
  if (password.length < 8) {
    return redirect(
      `/setup/accept/${token}?error=Password%20must%20be%20at%20least%208%20characters`
    );
  }

  const service = getSupabaseService();
  const { data, error } = await service.auth.admin.createUser({
    email: invite!.email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    const msg = error?.message?.includes("already")
      ? "An account with this email already exists — sign in instead"
      : (error?.message ?? "Could not create account");
    return redirect(`/setup/accept/${token}?error=${encodeURIComponent(msg)}`);
  }

  await db
    .insert(userPreferences)
    .values({ ownerId: data.user.id, role: "member" })
    .onConflictDoNothing();
  await markInviteAccepted(invite!.id);

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: invite!.email, password });
  return redirect("/");
}
```

- [ ] **Step 2: page** — same card styling as /setup; server component:

```typescript
// src/app/setup/accept/[token]/page.tsx
import Image from "next/image";
import { getInviteByTokenHash } from "@/db/queries/invites";
import { hashInviteToken, validateInvite } from "@/lib/invites/token";
import { acceptInvite } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const REASON_COPY: Record<string, string> = {
  not_found: "This invite link is invalid.",
  expired: "This invite link has expired — ask for a new one.",
  already_accepted: "This invite was already used. Sign in instead.",
};

export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const invite = await getInviteByTokenHash(hashInviteToken(token));
  const validation = validateInvite(invite, new Date());

  const acceptWithToken = acceptInvite.bind(null, token);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Image
        src="/branding/loomola-logo-inline.png"
        alt="loomola"
        width={180}
        height={48}
        priority
        className="h-12 w-auto dark:brightness-0 dark:invert"
      />
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-bg-subtle p-8">
        {!validation.ok ? (
          <>
            <h1 className="text-base font-semibold text-text">Invite not valid</h1>
            <p className="text-xs text-text-muted">
              {REASON_COPY[validation.reason]}
            </p>
          </>
        ) : (
          <form action={acceptWithToken} className="space-y-5">
            <div>
              <h1 className="text-base font-semibold text-text">Join Loomola</h1>
              <p className="mt-1 text-xs text-text-muted">
                Creating an account for <span className="font-medium">{invite!.email}</span>
              </p>
            </div>
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                {REASON_COPY[error] ?? error}
              </p>
            )}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
              >
                Choose a password
              </label>
              <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1.5" />
            </div>
            <Button type="submit" className="w-full">
              Create account
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: verify + commit**

`npm run typecheck && npm run lint && npm run test`. Manual round trip happens in Task 8's gate.

```bash
git add "src/app/setup/accept"
git commit -m "Add invite accept flow"
```

---

### Task 7: Settings → Users admin surface + MCP owner fix

**Files:**
- Create: `src/app/settings/users/page.tsx`, `src/app/settings/users/users-manager.tsx`
- Modify: `src/app/api/mcp/tools/owner.ts`
- Modify (maybe): the nav component that renders settings links — inspect `src/components/nav/top-nav.tsx`; if there's a settings menu/dropdown, add a "Users" item linking to `/settings/users` visible only when the current user is admin (pass a prop from the server page like the migration page does). If TopNav has no natural slot, skip the nav change and note it.

- [ ] **Step 1: server page** — mirror `src/app/settings/migration/page.tsx` (TopNav + main column):

```typescript
// src/app/settings/users/page.tsx
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/require-auth";
import { getUserRole } from "@/lib/auth/roles";
import { listInvites } from "@/db/queries/invites";
import { getSupabaseService } from "@/lib/supabase/service";
import { enableGranola } from "@/lib/feature-flags";
import { TopNav } from "@/components/nav/top-nav";
import { UsersManager } from "./users-manager";

export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const user = await requireAuth();
  if ((await getUserRole(user.id)) !== "admin") redirect("/");

  const service = getSupabaseService();
  const [{ data: usersData }, inviteRows] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 200 }),
    listInvites(),
  ]);

  const users = (usersData?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? "",
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
  }));
  const invites = inviteRows.map(({ tokenHash: _tokenHash, ...rest }) => ({
    ...rest,
    expiresAt: rest.expiresAt.toISOString(),
    acceptedAt: rest.acceptedAt?.toISOString() ?? null,
    createdAt: rest.createdAt.toISOString(),
  }));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav
        userEmail={user.email ?? ""}
        activePath="settings"
        granolaEnabled={enableGranola()}
      />
      <main className="mx-auto max-w-2xl px-6 py-12 space-y-8">
        <header>
          <h1 className="text-xl font-semibold text-text">Users</h1>
          <p className="mt-1 text-sm text-text-muted">
            Invite people to this instance. Invites expire after 7 days.
          </p>
        </header>
        <UsersManager initialUsers={users} initialInvites={invites} />
      </main>
    </div>
  );
}
```

(Verify TopNav's actual props against the migration page and mirror exactly.)

- [ ] **Step 2: client manager** — `users-manager.tsx`, "use client". Requirements (style with existing tokens/components; mirror list/row patterns from an existing settings or dashboard client component):
  - Invite form: email Input + "Send invite" Button → `POST /api/invites`; on success: if `emailed` true, toast.success("Invite emailed"); always show the new invite in the pending list with a "Copy link" button (clipboard-writes `acceptUrl`; note the URL is only available in the POST response — keep it in client state; after a reload the link can't be re-shown, render "link shown once" placeholder).
  - Pending invites list (not accepted, not expired): email, expiry date, Copy link (only for ones created this session), Revoke button → `DELETE /api/invites/:id` then remove from list.
  - Accepted/expired invites render in a muted "history" group (no actions except Revoke for expired).
  - Users list: email, joined date, last sign-in. Read-only (no delete in v1).
  - Errors → `toast.error(message)` via `sonner` (already mounted app-wide).

- [ ] **Step 3: MCP owner fix** — in `src/app/api/mcp/tools/owner.ts`, the fallback currently selects the oldest auth.users row. Change the no-env-config branch to:

```typescript
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM auth.users ORDER BY created_at ASC LIMIT 2`
  );
  if (rows.length === 0) throw new Error("No users exist yet");
  if (rows.length > 1) {
    throw new Error(
      "Multiple users exist on this instance; set MCP_OWNER_ID or MCP_OWNER_EMAIL to pin the MCP server to one account"
    );
  }
  return rows[0].id;
```

(Adapt to the file's existing types/return shape and caching, if any — read it first. Keep the MCP_OWNER_ID / MCP_OWNER_EMAIL branches unchanged.)

- [ ] **Step 4: verify + commit**

`npm run typecheck && npm run lint && npm run test`. Manual: `npm run dev`, sign in as Ian (admin after Task 1 backfill), open `/settings/users` — users list renders, create an invite to a test email, copy link works, revoke works.

```bash
git add src/app/settings/users src/app/api/mcp/tools/owner.ts
git commit -m "Add users settings surface; require explicit MCP owner with multiple users"
```
(Plus the nav file if modified.)

---

### Task 8: Docs + verification gate

**Files:**
- Modify: `README.md`, `.env.example`, `CHANGELOG.md`

- [ ] **Step 1: README** — in "Supabase setup" (Quickstart B section), replace the bullet "Add your first user manually in **Authentication -> Users -> Add user**. Auto-confirm the user and save the email/password. Loomola is single-user today, so this is the creator account." with:

```markdown
- No manual user creation needed: the first time you open the app it walks you
  through creating your admin account in-browser.
```

In Quickstart A, after the "Open http://localhost:3000" sentence, append: "The first visit walks you through creating your admin account."

Add a short section after the quickstarts:

```markdown
### Inviting more users

Loomola supports multiple accounts on one instance. As the admin, open
**Settings → Users** (`/settings/users`) to send invite links (7-day expiry,
single use). Each user sees only their own recordings, folders, and notes.
If email isn't configured, copy the invite link from the UI and send it
yourself. Password resets are self-serve from the sign-in page.
```

Update the "What's NOT here yet" multi-tenant bullet to reflect reality (invite-based multi-user exists; team workspaces/sharing between users does not). Update the comparison table row "Active OSS, single-user today" → "Active OSS, invite-based multi-user".

- [ ] **Step 2: .env.example** — update the MCP comment block: replace "otherwise v1 uses the first user because Loomola is single-user today" with "required once the instance has more than one user; single-user instances fall back to that user automatically".

- [ ] **Step 3: CHANGELOG.md** — add a dated entry summarizing: first-run admin setup, password reset, invite-based multi-user, users settings page, MCP multi-user guard.

- [ ] **Step 4: full gate**

```bash
npm run lint && npm run typecheck && npm run test
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run build
```
All green. NOTE: the build runs page-level code — `/setup`'s `hasAnyUser()` must not execute at build time (force-dynamic prevents prerender; verify the build output doesn't fail on DB access).

- [ ] **Step 5: Commit + push**

```bash
git add README.md .env.example CHANGELOG.md
git commit -m "Document first-run setup, password reset, and invites"
git push origin main
```
Watch the Coolify deploy; verify https://loom.dissonance.cloud/api/health and that /login still signs Ian in (his row is admin via backfill).

**Manual gate (scratch Supabase project — pre-Abb, with Ian):** create a fresh free Supabase project, run the compose quickstart against it, verify: first visit → /setup → admin created → dashboard; Settings → Users → invite → accept in incognito → member dashboard is empty (isolation); forgot-password email round trip.

---

## Spec-coverage self-check

| Spec 2.x item | Task |
|---|---|
| 2.1 First-run setup | 3 |
| 2.2 Password reset | 4 |
| 2.3 Invites (table, API, accept, email-optional) | 1, 2, 5, 6 |
| 2.4 MCP fallback fix + isolation sweep | 7 (fix); isolation asserted by existing owner-scoped queries + manual gate |
| 2.5 Role column, admin-only invites | 1, 5, 7 |
| Docs truthfulness | 8 |
