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
          <h1 className="text-xl font-semibold text-[var(--text)]">Users</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Invite people to this instance. Invites expire after 7 days.
          </p>
        </header>
        <UsersManager initialUsers={users} initialInvites={invites} />
      </main>
    </div>
  );
}
