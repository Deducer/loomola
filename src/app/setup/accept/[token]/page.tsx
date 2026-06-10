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
