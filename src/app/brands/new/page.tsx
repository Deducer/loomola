import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { BrandForm } from "@/components/brand/brand-form";
import { createBrandProfileAction } from "../actions";
import { TopNav } from "@/components/nav/top-nav";

export default async function NewBrandPage() {
  const user = await requireAuth();
  return (
    <>
      <TopNav
        userEmail={user.email ?? "unknown"}
        activePath="brands"
        granolaEnabled={enableGranola()}
      />
      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          New brand profile
        </h1>
        <div className="mt-8">
          <BrandForm action={createBrandProfileAction} submitLabel="Create brand" />
        </div>
      </main>
    </>
  );
}
