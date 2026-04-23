import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { TopNav } from "@/components/nav/top-nav";
import { RecordFlow } from "@/components/record/record-flow";

export default async function RecordPage() {
  const user = await requireAuth();
  const brands = await listBrandProfiles(user.id);
  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="record" />
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">New recording</h1>
        <p className="mt-1 text-sm opacity-60">
          Recording runs in your browser. Blobs stay local until upload ships in M4.
        </p>
        <div className="mt-6">
          <RecordFlow brands={brands} />
        </div>
      </div>
    </>
  );
}
