"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

// Extends the server-provided invite with the raw acceptUrl (only available
// right after creation; not returned by the list endpoint to keep the token
// server-side).
type InviteWithOptionalLink = InviteRow & { acceptUrl?: string };

type Props = {
  initialUsers: UserRow[];
  initialInvites: InviteRow[];
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isExpired(iso: string) {
  return new Date(iso).getTime() <= Date.now();
}

export function UsersManager({ initialUsers, initialInvites }: Props) {
  const [invites, setInvites] =
    useState<InviteWithOptionalLink[]>(initialInvites);
  const [email, setEmail] = useState("");
  const [isPending, startTransition] = useTransition();

  const pending = invites.filter(
    (inv) => !inv.acceptedAt && !isExpired(inv.expiresAt)
  );
  const history = invites.filter(
    (inv) => inv.acceptedAt || isExpired(inv.expiresAt)
  );

  function sendInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          toast.error(data.error ?? "Failed to create invite");
          return;
        }
        const data = (await res.json()) as {
          id: string;
          email: string;
          expiresAt: string;
          acceptUrl: string;
          emailed: boolean;
        };
        const newInvite: InviteWithOptionalLink = {
          id: data.id,
          email: data.email,
          expiresAt: data.expiresAt,
          acceptedAt: null,
          createdAt: new Date().toISOString(),
          acceptUrl: data.acceptUrl,
        };
        setInvites((current) => [newInvite, ...current]);
        setEmail("");
        if (data.emailed) {
          toast.success("Invite emailed to " + data.email);
        } else {
          toast.success("Invite created — copy the link below to send it");
        }
      } catch {
        toast.error("Network error — could not create invite");
      }
    });
  }

  function revokeInvite(id: string) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/invites/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          toast.error(data.error ?? "Failed to revoke invite");
          return;
        }
        setInvites((current) => current.filter((inv) => inv.id !== id));
      } catch {
        toast.error("Network error — could not revoke invite");
      }
    });
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy to clipboard")
    );
  }

  return (
    <div className="space-y-8">
      {/* Invite form */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-1)] p-5 space-y-4">
        <h2 className="text-base font-medium text-[var(--text)]">
          Send an invite
        </h2>
        <div className="flex gap-3">
          <Input
            type="email"
            placeholder="colleague@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isPending && sendInvite()}
            className="flex-1"
            disabled={isPending}
          />
          <Button
            type="button"
            onClick={sendInvite}
            disabled={isPending || !email.trim()}
          >
            Send invite
          </Button>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          If email is configured, the invite is sent automatically. Otherwise
          copy the link from the list below and send it yourself.
        </p>
      </section>

      {/* Pending invites */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-[var(--text)]">
            Pending invites
          </h2>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)]">
            {pending.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-[var(--text)]">
                    {inv.email}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    Expires {fmtDate(inv.expiresAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {inv.acceptUrl ? (
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => copyLink(inv.acceptUrl!)}
                    >
                      Copy link
                    </Button>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)] italic">
                      link shown once
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => revokeInvite(inv.id)}
                    disabled={isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-[var(--text-muted)]">
            History
          </h2>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)]">
            {history.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-[var(--text-muted)]">
                    {inv.email}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {inv.acceptedAt
                      ? `Accepted ${fmtDate(inv.acceptedAt)}`
                      : `Expired ${fmtDate(inv.expiresAt)}`}
                  </div>
                </div>
                {!inv.acceptedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => revokeInvite(inv.id)}
                    disabled={isPending}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Users list */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text)]">
          Users ({initialUsers.length})
        </h2>
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)]">
          {initialUsers.map((u) => (
            <div key={u.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-[var(--text)]">
                  {u.email}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  Joined {fmtDate(u.createdAt)}
                  {u.lastSignInAt
                    ? ` · Last sign-in ${fmtDate(u.lastSignInAt)}`
                    : ""}
                </div>
              </div>
            </div>
          ))}
          {initialUsers.length === 0 && (
            <div className="px-4 py-3 text-sm text-[var(--text-muted)]">
              No users yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
