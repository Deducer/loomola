# Loom Clone — Milestone 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, auth-gated Next.js 15 app at `https://loom.dissonance.cloud` using the full target stack (Supabase + Drizzle + Doppler + Docker + Coolify), so the deployment pipeline is validated before feature work begins.

**Architecture:** Next.js 15 App Router application in TypeScript, running as a Docker container deployed via Coolify to the existing Hostinger VPS behind Traefik. Supabase hosts Postgres + Auth (single creator). Doppler injects runtime secrets. Drizzle ORM is configured with an empty initial schema, ready for Milestone 2. Single E2E smoke test (Playwright) covers the golden path: visit `/`, be redirected to `/login`, authenticate, land on the dashboard placeholder.

**Tech Stack:** Next.js 15, React 19, TypeScript 5, Tailwind CSS 4, Supabase JS (`@supabase/ssr` + `@supabase/supabase-js`), Drizzle ORM + `postgres` driver, Vitest, Playwright, Doppler CLI, Docker (`node:22-alpine`), Coolify, Traefik.

---

## Roadmap (Reference)

Stage 1 of the Loom clone is built across 11 milestones, each planned separately.

- **M1: Foundation** (this plan) — deployed empty auth'd app
- **M2: Data model + brand profiles CRUD** — Drizzle migrations for all tables, brand profile management UI
- **M3: Recording capture (no upload)** — browser capture + bubble compositing, downloadable blob, 4K stress test
- **M4: R2 upload pipeline** — direct-to-R2 multipart during recording, metadata row, presigned URL endpoint
- **M5: Transcription pipeline** — Deepgram callback webhook, pg-boss job queue
- **M6: AI outputs + thumbnails** — title/summary/chapters/action items via Claude (AI SDK), ffmpeg-static thumbnail extraction
- **M7: Viewer page** — Plyr player, signed URL delivery, transcript panel, chapters on seekbar
- **M8: Password-protect + view tracking** — unlock cookies, views table + drop-off chart
- **M9: Comments (V4)** — anonymous comments with email, Resend notifications, rate limiting
- **M10: Trim editing (E2) + raw stream downloads** — trim UI + player clamping, ZIP endpoint
- **M11: Polish + smoke E2E** — production readiness, golden path E2E across the full pipeline

After M1 ships and is verified live, re-invoke `superpowers:writing-plans` targeting M2.

---

## File Structure (Milestone 1)

```
Loom_Clone/
├── package.json
├── package-lock.json
├── tsconfig.json
├── next.config.ts
├── .gitignore
├── .dockerignore
├── .env.example
├── README.md
├── Dockerfile
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── drizzle.config.ts
├── scripts/
│   └── migrate.ts
├── drizzle/
│   └── .gitkeep            # empty directory; populated in M2
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── login/
│   │   │   ├── page.tsx
│   │   │   └── actions.ts
│   │   ├── auth/
│   │   │   ├── callback/route.ts
│   │   │   └── signout/route.ts
│   │   └── api/
│   │       └── health/route.ts
│   ├── components/
│   │   └── dashboard/
│   │       └── empty-state.tsx
│   ├── lib/
│   │   └── supabase/
│   │       ├── server.ts
│   │       ├── client.ts
│   │       └── middleware.ts
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.ts
│   └── middleware.ts
├── tests/
│   ├── unit/
│   │   └── smoke.test.ts
│   └── e2e/
│       └── auth.spec.ts
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-04-22-loom-clone-design.md    # already exists
│       └── plans/
│           └── 2026-04-22-loom-clone-m1-foundation.md   # this file
└── .github/
    └── workflows/
        └── ci.yml
```

**File responsibility boundaries:**
- `src/lib/supabase/*` — Supabase client factories (server, browser, middleware). Three separate files because each has different cookie/session-handling needs and mixing them creates bugs.
- `src/app/login/actions.ts` — server action that performs sign-in. Separate from the page component so the page stays declarative.
- `src/middleware.ts` — thin wrapper that delegates to `src/lib/supabase/middleware.ts`. Only file that Next.js reads for middleware; wrapper keeps `src/middleware.ts` boring.
- `scripts/migrate.ts` — standalone entrypoint; runs at container boot before the server starts.

---

## Tasks

### Task 1: Initialize Next.js 15 project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`

- [ ] **Step 1: Initialize package.json manually**

Create `package.json`:

```json
{
  "name": "loom-clone",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 2: Install Next.js + React**

Run:
```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
npm install next@^15 react@^19 react-dom@^19
npm install --save-dev typescript@^5 @types/node @types/react @types/react-dom tsx
```
Expected: `package-lock.json` created, `node_modules/` populated, no errors.

- [ ] **Step 3: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create next.config.ts with standalone output**

Create `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
```

- [ ] **Step 5: Create .gitignore**

Create `.gitignore`:

```
node_modules/
.next/
out/
dist/
*.log
.env
.env.local
.env.*.local
.DS_Store
coverage/
playwright-report/
test-results/
.vercel
next-env.d.ts
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: exits 0 with no output. (`next-env.d.ts` will be auto-generated on first `next build` / `next dev`; safe to ignore its absence now.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts .gitignore
git commit -m "chore: initialize Next.js 15 + TypeScript scaffolding"
```

---

### Task 2: Set up Tailwind CSS 4

**Files:**
- Create: `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css`

- [ ] **Step 1: Install Tailwind CSS 4**

```bash
npm install --save-dev tailwindcss@^4 @tailwindcss/postcss postcss
```

- [ ] **Step 2: Create postcss.config.mjs**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 3: Create tailwind.config.ts**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: Create src/app/globals.css**

```css
@import "tailwindcss";

:root {
  --background: #0a0a0a;
  --foreground: #ededed;
}

html,
body {
  background: var(--background);
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
}
```

- [ ] **Step 5: Commit**

```bash
git add postcss.config.mjs tailwind.config.ts src/app/globals.css package.json package-lock.json
git commit -m "chore: configure Tailwind CSS 4"
```

---

### Task 3: Set up Vitest and write a smoke unit test

**Files:**
- Create: `vitest.config.ts`, `tests/unit/smoke.test.ts`

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest @vitest/ui
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `tests/unit/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/unit/smoke.test.ts package.json package-lock.json
git commit -m "test: set up Vitest with smoke test"
```

---

### Task 4: Create Supabase project (USER ACTION REQUIRED)

**This task cannot be automated. The user must perform these UI steps in their Supabase dashboard before proceeding to Task 5.**

- [ ] **Step 1: Create a new Supabase project**

1. Go to https://supabase.com/dashboard
2. Click **New project**
3. Organization: existing personal organization (or create one)
4. Project name: `loom-clone`
5. Database password: generate strong, save in password manager
6. Region: `us-east-1` (closest to Hostinger VPS if it's in North America; choose appropriate region otherwise)
7. Pricing plan: Free tier
8. Click **Create new project** and wait ~2 minutes for provisioning

- [ ] **Step 2: Capture project credentials**

Once the project is provisioned, record these values (Project Settings → API):
- **Project URL** (e.g., `https://abcdefghij.supabase.co`) → `SUPABASE_URL`
- **anon public key** → `SUPABASE_ANON_KEY`
- **service_role key** (secret!) → `SUPABASE_SERVICE_ROLE_KEY`

Also (Project Settings → Database → Connection string → `Transaction pooler` URI):
- **Connection string** (e.g., `postgresql://postgres.abcdefghij:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`) → `DATABASE_URL`
  - Replace `[PASSWORD]` with the database password from Step 1.

- [ ] **Step 3: Configure Auth settings**

Project Settings → Authentication:
1. **Site URL:** `https://loom.dissonance.cloud`
2. **Redirect URLs:** add `http://localhost:3000/auth/callback` and `https://loom.dissonance.cloud/auth/callback`
3. **Email Auth:** ensure **Enable email signups** is **disabled** (single-user tool; we create the user manually in the next step)
4. **Email Auth:** ensure **Confirm email** is disabled for simplicity

- [ ] **Step 4: Create the single creator user**

Authentication → Users → **Add user** → **Create new user**:
- Email: your email
- Password: strong password (save to password manager)
- Auto-confirm user: **yes**

- [ ] **Step 5: Hold credentials for Task 6 and Task 14**

Keep the four values (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) in your password manager — they will be added to Doppler in Task 14.

For local development (Task 5 onward), create `.env.local` with these values. (`.env.local` is gitignored.)

---

### Task 5: Configure Drizzle ORM with empty initial schema

**Files:**
- Create: `drizzle.config.ts`, `src/db/index.ts`, `src/db/schema.ts`, `scripts/migrate.ts`, `drizzle/.gitkeep`

- [ ] **Step 1: Install Drizzle + postgres driver**

```bash
npm install drizzle-orm postgres
npm install --save-dev drizzle-kit
```

- [ ] **Step 2: Create drizzle.config.ts**

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

- [ ] **Step 3: Create empty schema**

Create `src/db/schema.ts`:

```typescript
// Milestone 1: no tables yet beyond Supabase's auth.users.
// Tables for media_objects, brand_profiles, etc. arrive in M2.
export {};
```

- [ ] **Step 4: Create db client factory**

Create `src/db/index.ts`:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client);
```

- [ ] **Step 5: Create migration runner script**

Create `scripts/migrate.ts`:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
```

- [ ] **Step 6: Create empty drizzle folder**

```bash
mkdir -p drizzle
touch drizzle/.gitkeep
```

- [ ] **Step 7: Verify migration runner compiles**

Run: `npm run typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 8: Commit**

```bash
git add drizzle.config.ts src/db/index.ts src/db/schema.ts scripts/migrate.ts drizzle/.gitkeep package.json package-lock.json
git commit -m "chore: configure Drizzle ORM with empty schema"
```

---

### Task 6: Implement Supabase client factories (server, browser, middleware)

**Files:**
- Create: `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Install Supabase packages**

```bash
npm install @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: Create server client**

Create `src/lib/supabase/server.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from Server Component; middleware refreshes session
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Create browser client**

Create `src/lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 4: Create middleware client**

Create `src/lib/supabase/middleware.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const isAuthRoute = url.pathname.startsWith("/login") ||
                      url.pathname.startsWith("/auth");
  const isApiHealth = url.pathname === "/api/health";

  if (!user && !isAuthRoute && !isApiHealth) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && url.pathname === "/login") {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/ package.json package-lock.json
git commit -m "feat: add Supabase client factories for server, browser, middleware"
```

---

### Task 7: Wire up Next.js middleware

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create middleware.ts**

```typescript
import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: wire up Next.js auth middleware"
```

---

### Task 8: Implement root layout and dashboard placeholder page

**Files:**
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/dashboard/empty-state.tsx`

- [ ] **Step 1: Create root layout**

Create `src/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loom Clone",
  description: "Self-hosted screen recording",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Create empty-state component**

Create `src/components/dashboard/empty-state.tsx`:

```typescript
export function EmptyState({ userEmail }: { userEmail: string }) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">Loom Clone</h1>
      <p className="mt-2 text-sm opacity-70">
        Signed in as <code className="rounded bg-white/10 px-1">{userEmail}</code>.
      </p>
      <div className="mt-8 rounded-lg border border-white/10 p-6">
        <h2 className="text-lg font-medium">Milestone 1: Foundation</h2>
        <p className="mt-2 text-sm opacity-80">
          The deployment pipeline is working. Recording, sharing, and AI features
          arrive in Milestones 2–11.
        </p>
      </div>
      <form action="/auth/signout" method="post" className="mt-6">
        <button
          type="submit"
          className="rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/5"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create home page (protected)**

Create `src/app/page.tsx`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <EmptyState userEmail={user.email ?? "unknown"} />;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx src/components/dashboard/empty-state.tsx
git commit -m "feat: add root layout and dashboard placeholder page"
```

---

### Task 9: Implement login page and server action

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/actions.ts`

- [ ] **Step 1: Create server action for sign-in**

Create `src/app/login/actions.ts`:

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return redirect("/login?error=missing_credentials");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  return redirect("/");
}
```

- [ ] **Step 2: Create login page**

Create `src/app/login/page.tsx`:

```typescript
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-4 rounded-lg border border-white/10 p-6"
      >
        <h1 className="text-2xl font-semibold">Sign in</h1>
        {params.error && (
          <p className="rounded bg-red-500/20 p-2 text-sm text-red-200">
            {params.error}
          </p>
        )}
        <div>
          <label htmlFor="email" className="block text-sm">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-white/90 py-2 text-sm font-medium text-black hover:bg-white"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/
git commit -m "feat: add login page and sign-in server action"
```

---

### Task 10: Implement auth callback and sign-out routes

**Files:**
- Create: `src/app/auth/callback/route.ts`, `src/app/auth/signout/route.ts`

- [ ] **Step 1: Create auth callback handler**

Create `src/app/auth/callback/route.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
```

- [ ] **Step 2: Create sign-out handler**

Create `src/app/auth/signout/route.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/auth/
git commit -m "feat: add auth callback and sign-out routes"
```

---

### Task 11: Implement health check route

**Files:**
- Create: `src/app/api/health/route.ts`

- [ ] **Step 1: Create health route**

Create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/health/
git commit -m "feat: add /api/health route for uptime checks"
```

---

### Task 12: Verify local app works end-to-end

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create .env.example**

```
# Supabase
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# Database (direct postgres connection for Drizzle migrations)
DATABASE_URL=postgresql://postgres.xxxxxxxxxxxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 2: Populate .env.local from Task 4 Step 2 values**

Create `.env.local` (already gitignored) by copying `.env.example` and filling in the real values captured during Task 4. Set `NEXT_PUBLIC_SUPABASE_URL` = `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `SUPABASE_ANON_KEY`.

- [ ] **Step 3: Start the dev server**

```bash
npm run dev
```

Expected: server starts on http://localhost:3000.

- [ ] **Step 4: Verify redirect and login flow manually**

1. Open http://localhost:3000 — should redirect to `/login`.
2. Submit with wrong password — should show error on `/login`.
3. Submit with the real creator email + password from Task 4 Step 4 — should redirect to `/` and show the dashboard placeholder.
4. Click "Sign out" — should redirect back to `/login`.
5. Visit http://localhost:3000/api/health — should return `{"status":"ok","ts":"..."}`.

- [ ] **Step 5: Stop the dev server and commit**

```bash
# Ctrl-C the dev server
git add .env.example
git commit -m "docs: add .env.example"
```

---

### Task 13: Write E2E smoke test (Playwright)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create playwright.config.ts**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Write the failing E2E test**

Create `tests/e2e/auth.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("auth golden path", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test("unauthenticated visit redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("sign in, land on dashboard, sign out", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Loom Clone" })).toBeVisible();
    await expect(page.getByText(TEST_EMAIL!)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 4: Run the E2E test**

Ensure `.env.local` has `TEST_CREATOR_EMAIL` and `TEST_CREATOR_PASSWORD` set to the user created in Task 4 Step 4.

```bash
TEST_CREATOR_EMAIL="<your-email>" TEST_CREATOR_PASSWORD="<your-password>" npm run test:e2e
```

Expected: 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/ package.json package-lock.json
git commit -m "test: add Playwright E2E for auth golden path"
```

---

### Task 14: Set up Doppler for runtime secrets (USER ACTION + CLI)

**This task requires Doppler CLI installed locally and browser UI steps.**

- [ ] **Step 1: Install Doppler CLI (one-time)**

If not already installed:

```bash
brew install dopplerhq/cli/doppler
```

- [ ] **Step 2: Log in to Doppler**

```bash
doppler login
```

Opens a browser for auth. Complete it.

- [ ] **Step 3: Create Doppler project and configs**

In the Doppler web UI (https://dashboard.doppler.com):
1. Create a new project: `loom-clone`
2. Project comes with default `dev`, `stg`, `prd` configs. We'll use `prd` for production.

- [ ] **Step 4: Add secrets to `prd` config**

In the `prd` config, add these secrets (values from Task 4 Step 2):

```
SUPABASE_URL=<from Task 4>
SUPABASE_ANON_KEY=<from Task 4>
SUPABASE_SERVICE_ROLE_KEY=<from Task 4>
NEXT_PUBLIC_SUPABASE_URL=<same as SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same as SUPABASE_ANON_KEY>
DATABASE_URL=<from Task 4>
NEXT_PUBLIC_APP_URL=https://loom.dissonance.cloud
NODE_ENV=production
```

- [ ] **Step 5: Create a service token for the `prd` config**

Project settings → Access → Service Tokens → **Generate**:
- Name: `coolify-prd`
- Config: `prd`
- Access: Read

Copy the generated token. This is the one secret that goes into Coolify as `DOPPLER_TOKEN`.

- [ ] **Step 6: Link local dev to Doppler (optional but recommended)**

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
doppler setup
# Select project: loom-clone
# Select config: dev (not prd — prd is for production only)
```

You can now run `doppler run -- npm run dev` locally and your secrets come from Doppler's `dev` config instead of `.env.local`. (Still fine to keep `.env.local` for tests; `.env.local` wins over Doppler for `npm run dev` without the wrapper.)

- [ ] **Step 7: Nothing to commit**

Doppler secrets live in Doppler; no repo changes from this task.

---

### Task 15: Write Dockerfile

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules
.next
.git
.env
.env.*.local
.env.local
playwright-report
test-results
coverage
tests
docs
*.md
.DS_Store
.github
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

############
# Base
############
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat curl bash
WORKDIR /app

############
# Deps
############
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

############
# Build
############
FROM base AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

############
# Runtime
############
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install Doppler CLI
RUN curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh

# Copy standalone Next.js output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Copy migration script + drizzle folder + scripts + tsx for running ts directly
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/postgres ./node_modules/postgres
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

EXPOSE 3000

ENTRYPOINT ["doppler", "run", "--"]
CMD ["sh", "-c", "node ./node_modules/tsx/dist/cli.mjs ./scripts/migrate.ts && node ./server.js"]
```

- [ ] **Step 3: Build the image locally to verify it works**

```bash
docker build -t loom-clone:test \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="<value>" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="<value>" \
  --build-arg NEXT_PUBLIC_APP_URL="http://localhost:3000" \
  .
```

Expected: build completes without errors. Image size should be ~200-300MB.

- [ ] **Step 4: Run the image locally with Doppler token**

```bash
docker run --rm -p 3000:3000 \
  -e DOPPLER_TOKEN="<your dev-config service token>" \
  loom-clone:test
```

Expected: container starts, migrations run (no-op since empty schema), Next.js server starts on port 3000. `curl http://localhost:3000/api/health` returns `{"status":"ok",...}`.

- [ ] **Step 5: Stop container and commit**

```bash
# Ctrl-C to stop
git add Dockerfile .dockerignore
git commit -m "chore: add Dockerfile with Doppler + Drizzle migration runner"
```

---

### Task 16: Add GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test
```

E2E tests are excluded from CI because they require real Supabase credentials; they run manually (Task 13 Step 4) and as part of the Milestone 11 smoke E2E pipeline.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore: add GitHub Actions CI for typecheck + unit tests"
```

---

### Task 17: Create GitHub repo and push

**USER ACTION REQUIRED:**

- [ ] **Step 1: Create private GitHub repo**

1. Go to https://github.com/new
2. Owner: your account
3. Repository name: `loom-clone`
4. Visibility: **Private**
5. Do NOT initialize with README/license/gitignore (we already have those)
6. Click **Create repository**

- [ ] **Step 2: Add remote and push**

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
git remote add origin git@github.com:<your-username>/loom-clone.git
git branch -M main
git push -u origin main
```

Expected: push succeeds, GitHub shows all commits.

- [ ] **Step 3: Verify CI runs**

Visit the Actions tab in the GitHub repo. Expected: the CI workflow runs automatically on the push and passes (typecheck + unit tests).

---

### Task 18: Deploy to Coolify

**USER ACTION REQUIRED — uses Coolify UI.**

- [ ] **Step 1: Create new Application in Coolify**

1. Go to https://coolify.dissonance.cloud
2. New Resource → **Application**
3. Source: **Private repository (with GitHub App)**
4. Repository: `loom-clone`
5. Branch: `main`
6. Build pack: **Dockerfile**
7. Base directory: `/`
8. Dockerfile location: `/Dockerfile`

- [ ] **Step 2: Configure build args**

In Application → **Environment variables → Build Variables**, add:

- `NEXT_PUBLIC_SUPABASE_URL` = value from Task 4 Step 2
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = value from Task 4 Step 2
- `NEXT_PUBLIC_APP_URL` = `https://loom.dissonance.cloud`

(These are needed at build-time because Next.js inlines `NEXT_PUBLIC_*` env vars into the client bundle during `next build`.)

- [ ] **Step 3: Configure runtime env**

In Application → **Environment variables → Runtime Variables**, add:

- `DOPPLER_TOKEN` = service token from Task 14 Step 5
- `PORT` = `3000`

- [ ] **Step 4: Configure domain + port**

1. Domain: `https://loom.dissonance.cloud`
2. Port: `3000`
3. Enable "Force HTTPS"

- [ ] **Step 5: Deploy**

Click **Deploy**. Watch the build log. Expected: build succeeds in ~3-5 minutes, container starts, Traefik serves the site.

- [ ] **Step 6: Verify Traefik labels (per VPS CLAUDE.md SOP)**

SSH into the VPS:

```bash
ssh vps
docker ps | grep loom-clone
docker inspect <container-id> | grep "traefik.http.routers" | grep "rule"
```

Expected rule pattern: ``Host(`loom.dissonance.cloud`) && PathPrefix(`/`)``

Red flags: empty Host(), domain in PathPrefix, missing rule. If any, refer to `/Users/iancross/Development/05Dissonance_Cloud_VPS/CLAUDE.md` section 16 for recovery.

- [ ] **Step 7: Verify live app**

In your browser:

1. Visit `https://loom.dissonance.cloud` — should redirect to `/login`
2. Sign in with your creator credentials — should redirect to `/` and show "Milestone 1: Foundation"
3. Sign out — should redirect to `/login`
4. `curl https://loom.dissonance.cloud/api/health` — should return `{"status":"ok",...}`

- [ ] **Step 8: Update VPS documentation**

Add an entry to `/Users/iancross/Development/05Dissonance_Cloud_VPS/STATE.md` in the services table:

```
| **Loom Clone** | 3000 | ✅ Active | `https://loom.dissonance.cloud` | M1 foundation live |
```

Log the deployment in `/Users/iancross/Development/05Dissonance_Cloud_VPS/LOGS.md` per the SOP pattern (problem/steps/learnings not relevant for green-field deploy; just milestone entry).

Commit and push that VPS monorepo:

```bash
cd /Users/iancross/Development/05Dissonance_Cloud_VPS
git add STATE.md LOGS.md
git commit -m "docs: add Loom Clone M1 to services"
git push
```

---

## Milestone 1 Complete

At this point you should have:

- A private `loom-clone` GitHub repo with main branch containing all M1 code
- CI passing on every push (typecheck + unit tests)
- `https://loom.dissonance.cloud` serving a working auth-gated hello-world
- Supabase project with single creator user and auth redirect URLs configured
- Doppler project `loom-clone` with `prd` config + service token in Coolify
- R2 credentials NOT yet needed (arrive in M4)
- Deepgram / Claude / Resend credentials NOT yet needed (arrive in M5, M6, M9)

Re-invoke `superpowers:writing-plans` with "M2: Data model + brand profiles CRUD" to continue.

---

## Self-Review

**Spec coverage (Milestone 1 only — other milestones are out of scope for this plan):**
- Next.js 15 on Coolify/VPS → Task 18 ✓
- Supabase DB + Auth → Tasks 4, 6, 7, 9, 10 ✓
- Drizzle migrations configured → Task 5 ✓
- Doppler secrets management → Tasks 14, 15, 18 ✓
- Traefik + wildcard DNS → Task 18 ✓
- Node 22 LTS (avoiding Node 24 ArrayBuffer bug) → Task 15 ✓
- Post-deploy label verification → Task 18 Step 6 ✓
- Empty initial schema, polymorphic tables deferred to M2 → Task 5 Step 3 ✓
- E2E smoke test for auth golden path → Task 13 ✓

**Placeholder scan:** no `TBD` / `TODO` / "implement later" / "similar to Task N" in the plan. Every step either contains complete code, exact commands, or explicit external-UI instructions.

**Type/name consistency:**
- `createClient()` is used in both `src/lib/supabase/server.ts` and `src/lib/supabase/client.ts` — different functions in different files, imported by path. Tasks 6, 8, 9, 10 use them consistently (`createClient` imported from `@/lib/supabase/server` in server components; from `@/lib/supabase/client` in client components — though M1 has no client components yet).
- `updateSession` in middleware.ts imported from `@/lib/supabase/middleware` — consistent (Task 6, Task 7).
- `EmptyState` component props (`userEmail: string`) match usage in `HomePage` (`user.email ?? "unknown"`). ✓
- `signIn` server action signature (`formData: FormData`) matches form `action={signIn}` usage. ✓
- `.env.example` variable names match what `src/lib/supabase/*` and `scripts/migrate.ts` actually read (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, plus `NEXT_PUBLIC_*` counterparts). ✓

No issues found.
