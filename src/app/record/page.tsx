import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { TopNav } from "@/components/nav/top-nav";
import { RecordFlow } from "@/components/record/record-flow";
import { ExtensionStatusPill } from "@/components/record/extension-status";

export default async function RecordPage() {
  const user = await requireAuth();
  const brands = await listBrandProfiles(user.id);
  return (
    <>
      <TopNav
        userEmail={user.email ?? "unknown"}
        activePath="record"
        granolaEnabled={enableGranola()}
      />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          New recording
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Capture your screen, camera, and audio — all in the browser.
        </p>
        <div className="mt-8">
          <RecordFlow brands={brands} />
        </div>
      </main>
      <ExtensionStatusPill />
    </>
  );
}
