import { requireAuth } from "@/lib/require-auth";
import { getBrandProfile } from "@/db/queries/brand-profiles";
import { BrandForm } from "@/components/brand/brand-form";
import {
  updateBrandProfileAction,
  deleteBrandProfileAction,
} from "../actions";
import { TopNav } from "@/components/nav/top-nav";
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
      <TopNav userEmail={user.email ?? "unknown"} activePath="brands" />
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold">Edit brand profile</h1>
        <div className="mt-6">
          <BrandForm
            action={boundUpdate}
            initialValues={brand}
            submitLabel="Save changes"
          />
        </div>

        <form action={boundDelete} className="mt-10 border-t border-white/10 pt-6">
          <h2 className="text-sm font-medium text-red-300">Danger zone</h2>
          <p className="mt-1 text-xs opacity-60">
            Deleting a brand unlinks it from any recordings that use it. Recordings
            themselves aren&apos;t deleted.
          </p>
          <button
            type="submit"
            className="mt-3 rounded border border-red-400/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10"
          >
            Delete brand profile
          </button>
        </form>
      </div>
    </>
  );
}
