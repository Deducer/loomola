import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { BrandCard } from "@/components/brand/brand-card";
import { TopNav } from "@/components/nav/top-nav";
import Link from "next/link";

export default async function BrandsPage() {
  const user = await requireAuth();
  const brands = await listBrandProfiles(user.id);

  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="brands" />
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Brands</h1>
            <p className="mt-1 text-sm opacity-60">
              Profiles applied to share pages — accent color + logo.
            </p>
          </div>
          <Link
            href="/brands/new"
            className="rounded bg-white/90 px-3 py-2 text-sm font-medium text-black hover:bg-white"
          >
            New brand
          </Link>
        </div>

        {brands.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-white/15 p-10 text-center">
            <p className="text-sm opacity-70">No brand profiles yet.</p>
            <Link
              href="/brands/new"
              className="mt-3 inline-block text-sm underline"
            >
              Create your first one
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {brands.map((brand) => (
              <li key={brand.id}>
                <BrandCard brand={brand} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
