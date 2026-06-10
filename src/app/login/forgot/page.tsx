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
