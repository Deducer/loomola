import type { BrandProfile } from "@/db/queries/brand-profiles";
import Link from "next/link";

export function BrandCard({ brand }: { brand: BrandProfile }) {
  return (
    <Link
      href={`/brands/${brand.id}`}
      className="group flex items-center gap-3 rounded-lg border border-white/10 p-4 hover:border-white/30"
      style={{ borderLeftColor: brand.accentColor, borderLeftWidth: 4 }}
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded"
        style={{ background: brand.accentColor }}
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium">{brand.name}</h3>
        <p className="mt-0.5 truncate font-mono text-xs opacity-60">
          {brand.accentColor}
        </p>
      </div>
      {brand.logoUrl && (
        <img
          src={brand.logoUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded bg-white/5 object-contain p-1"
        />
      )}
    </Link>
  );
}
