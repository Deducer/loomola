import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { getBrandProfile } from "@/db/queries/brand-profiles";
import { BrandForm } from "@/components/brand/brand-form";
import {
  updateBrandProfileAction,
  deleteBrandProfileAction,
} from "../actions";
import { TopNav } from "@/components/nav/top-nav";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";

export default async function EditBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await params;
  const brand = await getBrandProfile(id, user.id);
  if (!brand) notFound();

  const boundUpdate = updateBrandProfileAction.bind(null, brand.id);
  const boundDelete = deleteBrandProfileAction.bind(null, brand.id);

  return (
    <>
      <TopNav
        userEmail={user.email ?? "unknown"}
        activePath="brands"
        granolaEnabled={enableGranola()}
      />
      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Edit brand profile
        </h1>
        <div className="mt-8">
          <BrandForm
            action={boundUpdate}
            initialValues={brand}
            submitLabel="Save changes"
          />
        </div>

        <form action={boundDelete} className="mt-12 border-t border-border pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-destructive">
            Danger zone
          </h2>
          <p className="mt-2 text-sm text-text-muted">
            Deleting a brand unlinks it from any recordings that use it.
            Recordings themselves aren&apos;t deleted.
          </p>
          <Button type="submit" variant="destructive" size="sm" className="mt-3">
            Delete brand profile
          </Button>
        </form>
      </main>
    </>
  );
}
