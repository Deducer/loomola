import { notFound } from "next/navigation";
import { listDictionaryTerms } from "@/db/queries/dictionary-terms";
import { DictionaryManager } from "@/components/dictionary/dictionary-manager";
import { TopNav } from "@/components/nav/top-nav";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export default async function DictionaryPage() {
  const user = await requireAuth();
  if (!enableGranola()) notFound();

  const terms = await listDictionaryTerms(user.id);

  return (
    <>
      <TopNav
        userEmail={user.email ?? "unknown"}
        activePath="dictionary"
        granolaEnabled
      />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Dictionary
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Teach Loomola the names, companies, and phrases your meetings actually use.
          </p>
        </div>
        <DictionaryManager initialTerms={terms} />
      </main>
    </>
  );
}
