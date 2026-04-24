import Link from "next/link";

export default function BrandNotFound() {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-xl font-semibold text-text">Brand not found</h1>
      <p className="mt-2 text-sm text-text-muted">
        This brand profile doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link
        href="/brands"
        className="mt-6 inline-block text-sm text-accent hover:underline"
      >
        Back to brands
      </Link>
    </div>
  );
}
