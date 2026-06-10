import Image from "next/image";
import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth/first-run";
import { signIn } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await hasAnyUser())) redirect("/setup");
  const params = await searchParams;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Image
        src="/branding/loomola-logo-inline.png"
        alt="loomola"
        width={180}
        height={48}
        priority
        // See top-nav.tsx — the source PNG has dark-gray text that
        // disappears on dark backgrounds. Flatten to white silhouette
        // in dark mode until a proper dark variant ships.
        className="h-12 w-auto dark:brightness-0 dark:invert"
      />
      <form
        action={signIn}
        className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-bg-subtle p-8"
      >
        <h1 className="text-base font-semibold text-text">Sign in</h1>
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
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1.5"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1.5"
          />
        </div>
        <Button type="submit" className="w-full">
          Sign in
        </Button>
        <a
          href="/login/forgot"
          className="block text-center text-xs text-text-muted hover:text-text"
        >
          Forgot password?
        </a>
      </form>
    </div>
  );
}
