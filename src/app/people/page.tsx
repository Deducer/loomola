import { notFound } from "next/navigation";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { listPeople } from "@/db/queries/people";
import { TopNav } from "@/components/nav/top-nav";
import { PeopleManager } from "@/components/people/people-manager";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const user = await requireAuth();
  if (!enableGranola()) notFound();

  const people = await listPeople(user.id);
  const hasSelf = people.some((p) => p.isSelf);

  return (
    <>
      <TopNav
        userEmail={user.email ?? "unknown"}
        activePath="people"
        granolaEnabled
      />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">People</h1>
          <p className="mt-1 text-sm text-text-muted">
            Known meeting participants for speaker labeling.
          </p>
        </div>
        <PeopleManager
          initialPeople={people}
          hasSelf={hasSelf}
          authEmail={user.email ?? null}
        />
      </main>
    </>
  );
}
