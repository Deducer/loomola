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
