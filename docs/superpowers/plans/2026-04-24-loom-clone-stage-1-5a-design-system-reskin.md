# Stage 1.5a — Design System + Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Install design tokens, dark/light theming, primitive components, and reskin every existing surface in the Linear/v0 lane.

**Architecture:** CSS-variable tokens in `globals.css` via Tailwind v4's `@theme` block. Dark by default; light via `next-themes` flipping `class="light"`. Primitive components in `src/components/ui/` built with `cva` + `tailwind-merge`. Surfaces rethemed by swapping raw Tailwind color classes for token classes and ad-hoc buttons for `<Button>`.

**Tech Stack:** Tailwind v4, `next-themes`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-tooltip`, `sonner`, `geist` font.

**Reference:** [Stage 1.5 design spec](../specs/2026-04-24-loom-clone-stage-1-5-premium-ux-design.md)

---

## Task 1: Install dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run:
```bash
npm install next-themes lucide-react class-variance-authority clsx tailwind-merge @radix-ui/react-tooltip sonner geist
```

- [ ] **Step 2: Verify**

Run:
```bash
node -e 'for (const p of ["next-themes","lucide-react","class-variance-authority","clsx","tailwind-merge","@radix-ui/react-tooltip","sonner","geist"]) console.log(p, "->", require.resolve(p))'
```

Expected: all 8 packages resolve.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(stage-1.5a): install design system deps"
```

---

## Task 2: `cn` utility + fonts + globals tokens

**Files:**
- Create: `src/lib/cn.ts`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`

- [ ] **Step 1: Create `cn` utility**

Create `src/lib/cn.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Replace globals.css with token set**

Overwrite `src/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  --radius-sm: 4px;
  --radius: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --color-bg: var(--bg);
  --color-bg-subtle: var(--bg-subtle);
  --color-bg-elevated: var(--bg-elevated);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-text-subtle: var(--text-subtle);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-destructive: var(--destructive);
  --color-destructive-fg: var(--destructive-fg);
}

:root {
  /* Dark theme (default) */
  --bg: #09090b;
  --bg-subtle: #18181b;
  --bg-elevated: #27272a;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --text: #fafafa;
  --text-muted: #a1a1aa;
  --text-subtle: #71717a;
  --accent: #8b5cf6;
  --accent-hover: #7c3aed;
  --accent-fg: #ffffff;
  --success: #10b981;
  --warning: #f59e0b;
  --destructive: #ef4444;
  --destructive-fg: #ffffff;
}

:root.light {
  --bg: #ffffff;
  --bg-subtle: #fafafa;
  --bg-elevated: #f4f4f5;
  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.14);
  --text: #09090b;
  --text-muted: #52525b;
  --text-subtle: #71717a;
  --accent: #7c3aed;
  --accent-hover: #6d28d9;
  --accent-fg: #ffffff;
  --success: #059669;
  --warning: #d97706;
  --destructive: #dc2626;
  --destructive-fg: #ffffff;
}

html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif);
  -webkit-font-smoothing: antialiased;
}

/* Focus ring using the accent color */
:where(button, input, textarea, select, a, [tabindex]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius);
}
```

- [ ] **Step 3: Update layout.tsx for fonts + ThemeProvider**

Overwrite `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster theme="dark" position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Build to verify tokens parse**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -10
```

Expected: successful compile.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cn.ts src/app/globals.css src/app/layout.tsx
git commit -m "feat(stage-1.5a): CSS-var tokens + Geist fonts + next-themes provider"
```

---

## Task 3: Button primitive

**Files:** Create `src/components/ui/button.tsx`

- [ ] **Step 1: Implement**

Create `src/components/ui/button.tsx`:
```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-fg hover:bg-accent-hover",
        secondary:
          "bg-bg-elevated text-text hover:bg-border-strong",
        outline:
          "border border-border-strong bg-transparent text-text hover:bg-bg-subtle",
        ghost:
          "bg-transparent text-text-muted hover:bg-bg-subtle hover:text-text",
        destructive:
          "bg-destructive text-destructive-fg hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-10 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | grep button | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat(ui): Button primitive with 5 variants + 4 sizes"
```

---

## Task 4: Input / Textarea / Select primitives

**Files:** Create `src/components/ui/input.tsx`, `textarea.tsx`, `select.tsx`

- [ ] **Step 1: Input**

Create `src/components/ui/input.tsx`:
```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md border border-border-strong bg-bg-subtle px-3 py-1 text-sm text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";
```

- [ ] **Step 2: Textarea**

Create `src/components/ui/textarea.tsx`:
```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-md border border-border-strong bg-bg-subtle px-3 py-2 text-sm text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
```

- [ ] **Step 3: Select**

Create `src/components/ui/select.tsx`:
```tsx
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-border-strong bg-bg-subtle pl-3 pr-9 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
  </div>
));
Select.displayName = "Select";
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5
git add src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/select.tsx
git commit -m "feat(ui): Input, Textarea, Select primitives"
```

---

## Task 5: Card / Badge / Avatar primitives

**Files:** Create `src/components/ui/card.tsx`, `badge.tsx`, `avatar.tsx`

- [ ] **Step 1: Card**

Create `src/components/ui/card.tsx`:
```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border border-border bg-bg-subtle",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-4 pt-4", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-4", className)} {...props} />
));
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-4 pb-4", className)} {...props} />
));
CardFooter.displayName = "CardFooter";
```

- [ ] **Step 2: Badge**

Create `src/components/ui/badge.tsx`:
```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
  {
    variants: {
      variant: {
        neutral: "bg-bg-elevated text-text-muted",
        ready: "bg-emerald-500/15 text-emerald-400",
        processing: "bg-amber-500/15 text-amber-400",
        transcribing: "bg-amber-500/15 text-amber-400",
        uploading: "bg-blue-500/15 text-blue-400",
        failed: "bg-red-500/15 text-red-400",
        accent: "bg-accent/15 text-accent",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

- [ ] **Step 3: Avatar**

Create `src/components/ui/avatar.tsx`:
```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

function initialsFrom(str: string): string {
  const parts = str.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-accent/20 font-medium text-accent",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsFrom(name)}
    </div>
  );
}
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5
git add src/components/ui/card.tsx src/components/ui/badge.tsx src/components/ui/avatar.tsx
git commit -m "feat(ui): Card, Badge, Avatar primitives"
```

---

## Task 6: Tooltip + ThemeToggle

**Files:** Create `src/components/ui/tooltip.tsx`, `src/components/ui/theme-toggle.tsx`

- [ ] **Step 1: Tooltip**

Create `src/components/ui/tooltip.tsx`:
```tsx
"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-xs text-text shadow-sm",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <TooltipRoot>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: ThemeToggle**

Create `src/components/ui/theme-toggle.tsx`:
```tsx
"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn("h-8 w-[84px]", className)} aria-hidden />;
  }

  const Option = ({
    value,
    Icon,
    label,
  }: {
    value: "light" | "dark" | "system";
    Icon: React.ComponentType<{ className?: string }>;
    label: string;
  }) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={theme === value}
      onClick={() => setTheme(value)}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
        theme === value
          ? "bg-bg-elevated text-text"
          : "text-text-subtle hover:text-text-muted"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-0.5 rounded-md border border-border p-0.5",
        className
      )}
    >
      <Option value="light" Icon={Sun} label="Light" />
      <Option value="system" Icon={Monitor} label="System" />
      <Option value="dark" Icon={Moon} label="Dark" />
    </div>
  );
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | tail -5
git add src/components/ui/tooltip.tsx src/components/ui/theme-toggle.tsx
git commit -m "feat(ui): Tooltip + ThemeToggle segmented control"
```

---

## Task 7: Retheme top nav

**Files:** Modify `src/components/nav/top-nav.tsx`

- [ ] **Step 1: Read current top-nav**

Run:
```bash
cat src/components/nav/top-nav.tsx
```

Capture the current structure and prop list.

- [ ] **Step 2: Rewrite with tokens + ThemeToggle + Avatar**

Overwrite `src/components/nav/top-nav.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Video } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";

export function TopNav({
  userEmail,
  activePath,
}: {
  userEmail: string;
  activePath?: "recordings" | "brands";
}) {
  const router = useRouter();

  async function signOut() {
    await fetch("/auth/signout", { method: "POST" });
    router.push("/login");
  }

  const linkClass = (active: boolean) =>
    cn(
      "text-sm transition-colors",
      active ? "text-text" : "text-text-muted hover:text-text"
    );

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <Video className="h-4 w-4 text-accent" />
          <span>Loom Clone</span>
        </Link>
        <div className="flex items-center gap-5 text-sm">
          <Link
            href="/"
            className={linkClass(activePath === "recordings")}
          >
            Recordings
          </Link>
          <Link
            href="/brands"
            className={linkClass(activePath === "brands")}
          >
            Brands
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Avatar name={userEmail} size={24} />
            <span className="hidden sm:inline">{userEmail}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/top-nav.tsx
git commit -m "feat(nav): retheme top nav with tokens, ThemeToggle, Avatar, Lucide icons"
```

---

## Task 8: Retheme dashboard + recording card

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/dashboard/recording-list.tsx`
- Modify: `src/components/dashboard/recording-card.tsx`

- [ ] **Step 1: Retheme `/` page wrapper**

Open `src/app/page.tsx`. Replace the page chrome (title + empty-state styling) to use tokens. Keep the existing server-side data fetching. The returned JSX should be:
```tsx
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="recordings" />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Recordings</h1>
            <p className="mt-1 text-sm text-text-muted">
              {recordings.length === 0
                ? "Browser-based recording; branded share pages."
                : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Link href="/record">
            <Button>
              <Plus className="h-4 w-4" />
              New recording
            </Button>
          </Link>
        </div>
        <div className="mt-8">
          <RecordingList recordings={recordings} thumbnailUrls={thumbnailUrls} />
        </div>
      </main>
    </>
```

Add these imports at the top:
```ts
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
```

Remove the old `className="rounded bg-red-500/90 ..."` anchor markup entirely.

- [ ] **Step 2: Retheme RecordingList empty state**

Open `src/components/dashboard/recording-list.tsx`. Replace it with:
```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { RecordingWithBrand } from "@/db/queries/recordings";
import { RecordingCard } from "./recording-card";

export function RecordingList({
  recordings,
  thumbnailUrls,
}: {
  recordings: RecordingWithBrand[];
  thumbnailUrls: Record<string, string>;
}) {
  if (recordings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
        <p className="text-sm text-text-muted">No recordings yet.</p>
        <Link href="/record" className="mt-4 inline-block">
          <Button>Start a recording</Button>
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recordings.map((r) => (
        <li key={r.id}>
          <RecordingCard rec={r} thumbnailUrl={thumbnailUrls[r.id] ?? null} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Retheme RecordingCard (thumbnail-forward)**

Overwrite `src/components/dashboard/recording-card.tsx`:
```tsx
import Link from "next/link";
import { Film } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RecordingWithBrand } from "@/db/queries/recordings";

function formatDuration(seconds: string | number | null): string {
  if (seconds === null) return "—";
  const n = typeof seconds === "string" ? parseFloat(seconds) : seconds;
  if (!isFinite(n)) return "—";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function RecordingCard({
  rec,
  thumbnailUrl,
}: {
  rec: RecordingWithBrand;
  thumbnailUrl: string | null;
}) {
  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const accent = rec.brand?.accentColor;
  const statusVariant =
    rec.status === "ready" ? "ready"
    : rec.status === "uploading" ? "uploading"
    : rec.status === "failed" ? "failed"
    : "processing";

  return (
    <Link
      href={`/v/${rec.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-subtle transition-colors hover:border-border-strong"
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
        <div className="absolute right-2 top-2">
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
          <span>{formatRelative(new Date(rec.createdAt))}</span>
          {rec.viewCount > 0 && (
            <>
              <span>·</span>
              <span>{rec.viewCount} view{rec.viewCount === 1 ? "" : "s"}</span>
            </>
          )}
          {rec.brand && (
            <>
              <span>·</span>
              <span>{rec.brand.name}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Build + commit**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -10
git add src/app/page.tsx src/components/dashboard/recording-list.tsx src/components/dashboard/recording-card.tsx
git commit -m "feat(dashboard): thumbnail-forward card + token-based styling"
```

---

## Task 9: Retheme share page shell + owner toolbar + password gate

**Files:**
- Modify: `src/app/v/[slug]/page.tsx` (JSX chrome only)
- Modify: `src/components/viewer/owner-toolbar.tsx`
- Modify: `src/components/viewer/password-gate.tsx`

- [ ] **Step 1: Retheme `/v/[slug]` page chrome**

Edit `src/app/v/[slug]/page.tsx`. Replace these class strings in the returned JSX (keep all logic):

- Header `className="flex items-center justify-between border-b border-white/10 px-6 py-3"` → `"flex h-14 items-center justify-between border-b border-border px-6"`. Remove the `style={{ borderBottomColor: accent }}` — move accent to a thin colored bar BELOW the header.
- Immediately after `</header>`, when `accent !== undefined`, render an accent strip:
  ```tsx
  <div className="h-[2px] w-full" style={{ backgroundColor: accent }} />
  ```
- Main content wrapper `className="mx-auto max-w-3xl p-6"` → `"mx-auto max-w-3xl px-6 py-10"`.
- Title `"text-2xl font-semibold"` → `"text-2xl font-semibold tracking-tight"`.
- Meta `"mt-1 text-sm opacity-60"` → `"mt-2 text-sm text-text-muted"`.
- AI summary paragraph `"mt-4 text-sm leading-relaxed opacity-80"` → `"mt-6 text-[15px] leading-7 text-text-muted"`.
- Not-ready card `"mt-6 rounded-lg border border-white/10 p-8 text-center"` → `"mt-8 rounded-xl border border-border bg-bg-subtle p-10 text-center"` and inside `"text-lg"` → `"text-base font-medium text-text"`, `"mt-2 text-sm opacity-60"` → `"mt-2 text-sm text-text-subtle"`.
- Share URL row `"mt-6 flex items-center gap-3 rounded-lg border border-white/10 p-4"` → `"mt-10 flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-3"`.
- Share URL code `"flex-1 truncate rounded bg-white/5 px-3 py-2 text-sm"` → `"flex-1 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted"`.

"Back to dashboard" link: replace `<Link ... className="text-xs opacity-60 hover:opacity-100">Back to dashboard</Link>` with:
```tsx
<Link
  href="/"
  className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
>
  <ArrowLeft className="h-3.5 w-3.5" />
  Dashboard
</Link>
```
And add `import { ArrowLeft } from "lucide-react";` at the top.

- [ ] **Step 2: Retheme OwnerToolbar**

Overwrite `src/components/viewer/owner-toolbar.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrimEditor } from "./trim-editor";
import { DownloadsList, type DownloadLink } from "./downloads-list";

export function OwnerToolbar({
  recordingId,
  hasPassword,
  durationSec,
  trimStartSec,
  trimEndSec,
  downloads,
}: {
  recordingId: string;
  hasPassword: boolean;
  durationSec: number | null;
  trimStartSec: number | null;
  trimEndSec: number | null;
  downloads: DownloadLink[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePassword() {
    if (password.length < 4) {
      setError("Use at least 4 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/password`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setPassword("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removePassword() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/password`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Remove failed (${res.status}).`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
        <div className="flex items-center gap-3">
          {hasPassword ? (
            <Lock className="h-4 w-4 text-emerald-400" />
          ) : (
            <LockOpen className="h-4 w-4 text-text-subtle" />
          )}
          <span className="text-text-muted">Password</span>
          <span className={hasPassword ? "text-emerald-400" : "text-text-subtle"}>
            {hasPassword ? "on" : "off"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(!open);
                setError(null);
              }}
            >
              {hasPassword ? "Change" : "Add password"}
            </Button>
            {hasPassword && (
              <Button
                variant="ghost"
                size="icon"
                onClick={removePassword}
                disabled={busy}
                aria-label="Remove password"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        </div>
        {open && (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? "New password" : "Password"}
              className="flex-1"
            />
            <Button size="sm" onClick={savePassword} disabled={busy}>
              Save
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
      <TrimEditor
        recordingId={recordingId}
        durationSec={durationSec}
        initialStart={trimStartSec}
        initialEnd={trimEndSec}
      />
      <DownloadsList links={downloads} />
    </div>
  );
}
```

- [ ] **Step 3: Retheme PasswordGate**

Overwrite `src/components/viewer/password-gate.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordGate({ slug }: { slug: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/v/${slug}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("Incorrect password.");
        return;
      }
      if (!res.ok) {
        setError(`Unexpected error (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border border-border bg-bg-subtle p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-text">Password required</h2>
          <p className="text-xs text-text-muted">Enter the password to continue.</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          placeholder="Password"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          type="submit"
          disabled={submitting || password.length === 0}
          className="w-full"
        >
          {submitting ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add 'src/app/v/[slug]/page.tsx' src/components/viewer/owner-toolbar.tsx src/components/viewer/password-gate.tsx
git commit -m "feat(viewer): retheme share page chrome + owner toolbar + password gate"
```

---

## Task 10: Retheme viewer shell — transcript, chapters, action items

**Files:**
- Modify: `src/components/viewer/transcript-panel.tsx`
- Modify: `src/components/viewer/chapters-list.tsx`
- Modify: `src/components/viewer/action-items-list.tsx`
- Modify: `src/components/viewer/dropoff-chart.tsx`

- [ ] **Step 1: TranscriptPanel**

In `src/components/viewer/transcript-panel.tsx`, replace the rendered classes:
- Outer wrapper: `"mt-8"` → `"mt-10"`
- Heading `"text-sm font-medium"` → `"text-xs font-semibold uppercase tracking-wider text-text-muted"`
- Container `"mt-3 max-h-96 overflow-y-auto rounded-lg border border-white/10 p-2"` → `"mt-3 max-h-96 overflow-y-auto rounded-xl border border-border bg-bg-subtle p-2"`
- Active paragraph button class — `"bg-white/10"` → `"bg-accent/10 text-text"`; inactive `"opacity-70 hover:bg-white/5 hover:opacity-100"` → `"text-text-muted hover:bg-bg-elevated hover:text-text"`
- Fallback single-paragraph `"mt-3 rounded-lg border border-white/10 p-4 text-sm leading-relaxed opacity-80"` → `"mt-3 rounded-xl border border-border bg-bg-subtle p-4 text-sm leading-7 text-text-muted"`

- [ ] **Step 2: ChaptersList**

Rewrite `src/components/viewer/chapters-list.tsx`:
```tsx
"use client";

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

type Chapter = { start_sec: number; title: string };

export function ChaptersList({
  chapters,
  onSeek,
}: {
  chapters: Chapter[];
  onSeek: (sec: number) => void;
}) {
  if (chapters.length === 0) return null;
  return (
    <div className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Chapters
      </h2>
      <ul className="mt-3 space-y-1">
        {chapters.map((c, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSeek(c.start_sec)}
              className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
            >
              <code className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                {formatTs(c.start_sec)}
              </code>
              <span>{c.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: ActionItemsList**

Rewrite `src/components/viewer/action-items-list.tsx`:
```tsx
"use client";

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

type ActionItem = { timestamp_sec: number; text: string };

export function ActionItemsList({
  actionItems,
  onSeek,
}: {
  actionItems: ActionItem[];
  onSeek: (sec: number) => void;
}) {
  if (actionItems.length === 0) return null;
  return (
    <div className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Action items
      </h2>
      <ul className="mt-3 space-y-1">
        {actionItems.map((a, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSeek(a.timestamp_sec)}
              className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
            >
              <code className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                {formatTs(a.timestamp_sec)}
              </code>
              <span>{a.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: DropoffChart**

Update `src/components/viewer/dropoff-chart.tsx`: heading class → `"text-xs font-semibold uppercase tracking-wider text-text-muted"`; wrapper `"mt-3 flex h-20 items-end gap-1 rounded border border-white/10 p-2"` → `"mt-3 flex h-20 items-end gap-1 rounded-lg border border-border bg-bg-subtle p-2"`; bars `"bg-emerald-400/60"` → `"bg-accent/70"`; caption classes tokenized.

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/transcript-panel.tsx src/components/viewer/chapters-list.tsx src/components/viewer/action-items-list.tsx src/components/viewer/dropoff-chart.tsx
git commit -m "feat(viewer): retheme transcript, chapters, action items, dropoff chart"
```

---

## Task 11: Retheme comments + trim editor + downloads list

**Files:**
- Modify: `src/components/viewer/comments-section.tsx`
- Modify: `src/components/viewer/comment-list.tsx`
- Modify: `src/components/viewer/comment-item.tsx`
- Modify: `src/components/viewer/comment-form.tsx`
- Modify: `src/components/viewer/trim-editor.tsx`
- Modify: `src/components/viewer/downloads-list.tsx`

- [ ] **Step 1: CommentsSection heading**

In `src/components/viewer/comments-section.tsx`: heading class `"text-sm font-medium"` → `"text-xs font-semibold uppercase tracking-wider text-text-muted"`. Wrapper `"mt-8"` → `"mt-10"`.

- [ ] **Step 2: CommentList empty state**

In `src/components/viewer/comment-list.tsx`: empty-state paragraph `"mt-3 text-sm opacity-60"` → `"mt-3 text-sm text-text-subtle"`.

- [ ] **Step 3: CommentItem**

Rewrite `src/components/viewer/comment-item.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

type Props = {
  id: string;
  name: string;
  body: string;
  timestampSec: number;
  createdAt: Date;
  isOwner: boolean;
  onSeek: (sec: number) => void;
};

export function CommentItem({
  id,
  name,
  body,
  timestampSec,
  createdAt,
  isOwner,
  onSeek,
}: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert(`Delete failed (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="group flex gap-3 rounded-lg border border-border bg-bg-subtle p-3 text-sm">
      <button
        type="button"
        onClick={() => onSeek(timestampSec)}
        className="shrink-0 self-start rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted hover:text-text"
      >
        {formatTs(timestampSec)}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-text">{name}</span>
          <span className="shrink-0 text-xs text-text-subtle">
            {formatRelative(createdAt)}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-text-muted">{body}</p>
      </div>
      {isOwner && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          disabled={deleting}
          aria-label="Delete comment"
          className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </li>
  );
}
```

- [ ] **Step 4: CommentForm**

Rewrite `src/components/viewer/comment-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  slug: string;
  getCurrentTime: () => number;
};

export function CommentForm({ slug, getCurrentTime }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !body.trim()) {
      setError("All fields are required.");
      return;
    }
    setSubmitting(true);
    try {
      const timestampSec = Math.max(0, getCurrentTime());
      const res = await fetch(`/api/v/${slug}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, body, timestampSec }),
      });
      if (res.status === 429) {
        const data = (await res.json()) as { retryAfterSec?: number };
        setError(`Slow down — try again in ${data.retryAfterSec ?? 60}s.`);
        return;
      }
      if (res.status === 403) {
        setError("This recording is locked. Unlock it first.");
        return;
      }
      if (res.status === 400) {
        const data = (await res.json()) as { error?: string };
        setError(
          data.error === "bad_email"
            ? "That email looks invalid."
            : data.error === "body_too_long"
              ? "Comment too long (max 2000 chars)."
              : "Please fill in all fields."
        );
        return;
      }
      if (!res.ok) {
        setError(`Unexpected error (${res.status}).`);
        return;
      }
      setName("");
      setEmail("");
      setBody("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 space-y-3 rounded-xl border border-border bg-bg-subtle p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
        />
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (not shown publicly)"
          required
        />
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment at this timestamp…"
        rows={3}
        required
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-3 text-xs text-text-subtle">
        <span>Your email is only used to notify the creator.</span>
        <Button type="submit" disabled={submitting} size="sm">
          {submitting ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: TrimEditor**

Open `src/components/viewer/trim-editor.tsx`. Replace outer card `"mt-4 rounded-lg border border-white/10 p-3 text-sm"` → `"rounded-xl border border-border bg-bg-subtle p-3 text-sm"` (drop the `mt-4` — parent owns spacing). Replace `<button>` CSS for Edit/Reset/Save/Cancel with `<Button>` from primitives (variant=`ghost` for Edit/Cancel, `secondary` for Save, `destructive` for Reset). Replace the raw `<input type="password">` with the new `<Input>`. Replace the range-sliders' container spacing to `space-y-3` and ensure `accent-color: var(--accent)` on inputs via inline style.

Concretely, the full updated file:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateTrim, type TrimError } from "@/lib/viewer/trim-validate";

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

const ERROR_LABELS: Record<TrimError, string> = {
  start_negative: "Start must be >= 0.",
  end_out_of_bounds: "End can't be past the recording duration.",
  start_ge_end: "Start must be less than end.",
};

export function TrimEditor({
  recordingId,
  durationSec,
  initialStart,
  initialEnd,
}: {
  recordingId: string;
  durationSec: number | null;
  initialStart: number | null;
  initialEnd: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(initialStart ?? 0);
  const [end, setEnd] = useState(initialEnd ?? durationSec ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (durationSec == null || durationSec <= 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm text-text-subtle">
        Trim unavailable — duration not yet known.
      </div>
    );
  }
  const dur = durationSec;
  const hasTrim = initialStart != null && initialEnd != null;
  const check = validateTrim({ startSec: start, endSec: end, durationSec: dur });

  async function save() {
    if (!check.ok) {
      setError(ERROR_LABELS[check.error]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/trim`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startSec: start, endSec: end }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error && data.error in ERROR_LABELS
            ? ERROR_LABELS[data.error as TrimError]
            : `Save failed (${res.status}).`
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/trim`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Reset failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setStart(0);
      setEnd(dur);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
      <div className="flex items-center gap-3">
        <Scissors className="h-4 w-4 text-text-subtle" />
        <span className="text-text-muted">Trim</span>
        <span className={hasTrim ? "text-accent" : "text-text-subtle"}>
          {hasTrim ? `${formatTs(initialStart!)}–${formatTs(initialEnd!)}` : "off"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(!open);
              setError(null);
            }}
          >
            {hasTrim ? "Edit" : "Set trim"}
          </Button>
          {hasTrim && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10"
            >
              Reset
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Start: {formatTs(start)}</span>
            <span>End: {formatTs(end)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={dur}
            step={0.5}
            value={start}
            onChange={(e) => setStart(parseFloat(e.target.value))}
            className="w-full"
            style={{ accentColor: "var(--accent)" }}
          />
          <input
            type="range"
            min={0}
            max={dur}
            step={0.5}
            value={end}
            onChange={(e) => setEnd(parseFloat(e.target.value))}
            className="w-full"
            style={{ accentColor: "var(--accent)" }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
                setStart(initialStart ?? 0);
                setEnd(initialEnd ?? dur);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={busy || !check.ok}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: DownloadsList**

Rewrite `src/components/viewer/downloads-list.tsx`:
```tsx
"use client";

import { Download } from "lucide-react";

export type DownloadLink = { kind: string; href: string };

export function DownloadsList({ links }: { links: DownloadLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3 text-sm">
      <div className="flex items-center gap-2 text-text-muted">
        <Download className="h-4 w-4 text-text-subtle" />
        <span>Downloads</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.kind}>
            <a
              href={l.href}
              download
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {l.kind}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/viewer/comments-section.tsx src/components/viewer/comment-list.tsx src/components/viewer/comment-item.tsx src/components/viewer/comment-form.tsx src/components/viewer/trim-editor.tsx src/components/viewer/downloads-list.tsx
git commit -m "feat(viewer): retheme comments, trim editor, downloads list"
```

---

## Task 12: Retheme record flow

**Files:** Modify every file under `src/app/record/` and `src/components/recording/**/*.tsx` that has ad-hoc color classes.

- [ ] **Step 1: Audit record-flow surfaces**

Run:
```bash
grep -rn "bg-white\|bg-black\|border-white\|text-white/\|bg-red-500/" src/app/record src/components/recording 2>/dev/null | head -50
```

Note the files with hits.

- [ ] **Step 2: Replace class strings in every record-flow file**

Apply these universal swaps across the noted files (search-and-replace-style, but carefully — preserve non-styling classes):

| Old                                  | New                                      |
|--------------------------------------|------------------------------------------|
| `bg-white/5`                         | `bg-bg-subtle`                           |
| `bg-white/10`                        | `bg-bg-elevated`                         |
| `bg-white/20`                        | `bg-border-strong`                       |
| `border-white/10`                    | `border-border`                          |
| `border-white/15`                    | `border-border`                          |
| `border-white/20`                    | `border-border-strong`                   |
| `text-white/60` / `opacity-60`       | `text-text-muted`                        |
| `text-white/50` / `opacity-50`       | `text-text-subtle`                       |
| `text-white/40` / `opacity-40`       | `text-text-subtle`                       |
| `bg-red-500/90` or `bg-red-500`      | `bg-destructive`                         |
| `hover:bg-red-500`                   | `hover:opacity-90`                       |
| `bg-black` (for video bg)            | keep `bg-black` (player needs black)     |

Replace any raw `<button>` that looks like a primary CTA (e.g., "Start recording", "Stop", "Upload") with the `<Button>` primitive, variant `default` (primary) or `destructive` for Stop/Discard, `secondary` for "Cancel" / "Discard".

- [ ] **Step 3: Build**

Run:
```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/app/record src/components/recording
git commit -m "feat(record): retheme record flow with tokens + Button primitive"
```

---

## Task 13: Retheme brands + login

**Files:** Modify `src/app/brands/page.tsx`, `src/app/brands/new/page.tsx`, `src/app/brands/[id]/page.tsx`, `src/app/login/page.tsx`.

- [ ] **Step 1: Audit**

Run:
```bash
grep -rn "bg-white\|bg-black\|border-white\|text-white/\|opacity-[0-9]" src/app/brands src/app/login 2>/dev/null | head -40
```

- [ ] **Step 2: Apply the same token swaps from Task 12** to the brand + login pages. Additionally:

- Brand list: wrap each brand row in `<Card>`.
- Brand forms: use `<Input>`, `<Textarea>`, `<Button>` primitives. Accent-color picker stays as-is but its swatch preview gets `rounded-md border border-border` for frame.
- Login: center the form in a `<Card>` at `max-w-sm`. Title + sign-in button using primitives.

- [ ] **Step 3: Build + commit**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run build 2>&1 | tail -10
git add src/app/brands src/app/login
git commit -m "feat(pages): retheme brands + login with tokens + primitives"
```

---

## Task 14: Final theme audit

**Files:** any remaining files with ad-hoc color classes.

- [ ] **Step 1: Global audit**

Run:
```bash
grep -rn "bg-white\|border-white\|text-white/" src/ --include="*.tsx" --include="*.ts" | grep -v node_modules | head -60
```

- [ ] **Step 2: Resolve each hit**

For each result: either apply the token swap (preferred) OR add a justifying comment (e.g., the Plyr video container's inner `bg-black`). The target is zero unrelated `bg-white` / `border-white` / `text-white/` matches.

- [ ] **Step 3: Check light mode visually**

Start dev server if needed, click the ThemeToggle sun icon on every page, confirm nothing is unreadable. Dev server may be flaky locally (see earlier M7 note about middleware EvalError); if so, push to prod and verify via Coolify deploy.

- [ ] **Step 4: Commit any last sweeps**

```bash
git status -s
# If anything changed:
git add src/
git commit -m "chore(ui): sweep residual ad-hoc colors → tokens"
```

---

## Task 15: Ship + live verify

**Files:** none.

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Wait for deploy**

```bash
until ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Status}}" | grep -q "Up [0-9]\+ seconds"'; do sleep 15; done
ssh vps 'docker ps --filter "name=yc1k629dxxsnmyg027wt5hag" --format "{{.Names}} {{.Status}}"'
```

- [ ] **Step 3: Smoke run**

```bash
npm run smoke
```

Expected: all 9 steps ✓ — confirms nothing broke in the reskin.

- [ ] **Step 4: Browser tour**

Open these surfaces in live browser (both dark + light):
- `/` (dashboard)
- `/record`
- `/v/<known-slug>` as owner
- `/v/<known-slug>` as incognito
- `/brands`
- `/brands/new`
- `/login` (sign out first)

Visually confirm consistency. Nothing needs to be perfect — this is Phase 1.5a; 1.5b will add the sidebar/folders/search on top.

- [ ] **Step 5: Report back to user**

Send a summary message including:
- One-line confirmation of 1.5a shipped + smoke green
- Any visual regressions or TODOs caught during the tour
- Invitation to eyeball the live site and flag anything before Phase 1.5b starts

---

## Self-Review Notes

- Spec coverage:
  - Tokens + dark/light → Tasks 2.
  - Geist fonts → Task 2.
  - next-themes + ThemeToggle → Tasks 2, 6.
  - Primitive components → Tasks 3–6.
  - Top nav retheme → Task 7.
  - Dashboard retheme → Task 8.
  - Share page retheme → Tasks 9, 10, 11.
  - Record flow retheme → Task 12.
  - Brands + login retheme → Task 13.
  - Sweep residuals → Task 14.
  - Deploy + smoke → Task 15.

- Types consistent: `Button` / `Input` / `Textarea` / `Select` / `Card` / `Badge` / `Avatar` / `Tooltip` / `ThemeToggle` — all exported named, imports consistent.

- Risk mitigations:
  - Theme flash → `suppressHydrationWarning` + next-themes script (Task 2).
  - Token inversion gaps → Task 14 audit.
  - Post-reskin regression → smoke run (Task 15 Step 3).
