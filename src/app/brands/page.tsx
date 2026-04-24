import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { BrandCard } from "@/components/brand/brand-card";
import { TopNav } from "@/components/nav/top-nav";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function BrandsPage() {
  const user = await requireAuth();
  const brands = await listBrandProfiles(user.id);

  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="brands" />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              Brands
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              Profiles applied to share pages — accent color + logo.
            </p>
          </div>
          <Link href="/brands/new">
            <Button>
              <Plus className="h-4 w-4" />
              New brand
            </Button>
          </Link>
        </div>

        {brands.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
            <p className="text-sm text-text-muted">No brand profiles yet.</p>
            <Link href="/brands/new" className="mt-4 inline-block">
              <Button variant="outline" size="sm">
                Create your first one
              </Button>
            </Link>
          </div>
        ) : (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {brands.map((brand) => (
              <li key={brand.id}>
                <BrandCard brand={brand} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
