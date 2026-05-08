import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { TopNav } from "@/components/nav/top-nav";
import { RevealTokenButton } from "./reveal-token-button";

export const dynamic = "force-dynamic";

export default async function MigrationSettingsPage() {
  if (!enableGranola()) {
    redirect("/");
  }
  const user = await requireAuth();
  const serverUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://loom.dissonance.cloud";

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav
        userEmail={user.email ?? ""}
        activePath="settings"
        granolaEnabled={true}
      />
      <main className="mx-auto max-w-2xl px-6 py-12 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-[var(--text)]">
            Migrate from Granola
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Import your Granola backlog — notes, transcripts, AI summaries,
            attendees, and lists — into your Loomola.
          </p>
        </header>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-1)] p-5 space-y-3">
          <h2 className="text-base font-medium text-[var(--text)]">
            1. Install the migrator
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Pre-built binaries are not yet released. Run from a checkout of
            the Loomola repo:
          </p>
          <pre className="rounded bg-[var(--bg-subtle)] p-3 text-xs overflow-x-auto text-[var(--text)]">
{`cd migrate
bun install
bun run src/cli.ts granola --token=<paste below>`}
          </pre>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-1)] p-5 space-y-3">
          <h2 className="text-base font-medium text-[var(--text)]">
            2. Reveal your access token
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            The migrator uses your Loomola session JWT to authenticate.
            Tokens last about an hour — if your import is interrupted,
            click <em>Reveal</em> again to get a fresh one. The CLI resumes
            where it left off automatically.
          </p>
          <RevealTokenButton />
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-1)] p-5 space-y-3">
          <h2 className="text-base font-medium text-[var(--text)]">3. Run</h2>
          <p className="text-sm text-[var(--text-muted)]">
            From the <code className="text-xs">migrate/</code> directory:
          </p>
          <pre className="rounded bg-[var(--bg-subtle)] p-3 text-xs overflow-x-auto text-[var(--text)]">
{`./loomola-migrate granola \\
  --server=${serverUrl} \\
  --token=<paste>`}
          </pre>
          <p className="text-sm text-[var(--text-muted)]">
            Granola does not record or store audio anywhere, so imported
            notes won't have an audio file. The note body, transcript,
            AI summary, attendees, and meeting metadata all import.
          </p>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-5 text-sm text-[var(--text-muted)] space-y-2">
          <p>
            <strong className="text-[var(--text)]">Heads-up.</strong> Recent
            Granola desktop builds have started encrypting the local notes
            cache. If the migrator says it can't find your data, you may
            need a Granola Business subscription (so it can hit Granola's
            official API), or an older Granola version that still wrote a
            plaintext cache. The architecture supports both.
          </p>
        </section>
      </main>
    </div>
  );
}
