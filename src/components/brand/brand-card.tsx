import type { BrandProfile } from "@/db/queries/brand-profiles";
import Link from "next/link";

export function BrandCard({ brand }: { brand: BrandProfile }) {
  return (
    <Link
      href={`/brands/${brand.id}`}
      className="group flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-4 transition-colors hover:border-border-strong"
      style={{ borderLeftColor: brand.accentColor, borderLeftWidth: 4 }}
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded-md"
        style={{ background: brand.accentColor }}
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-text">{brand.name}</h3>
        <p className="mt-0.5 truncate font-mono text-xs text-text-subtle">
          {brand.accentColor}
        </p>
      </div>
      {brand.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logoUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded bg-bg-elevated object-contain p-1"
        />
      )}
    </Link>
  );
}
