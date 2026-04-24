import Link from "next/link";

export default function RecordingNotFound() {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-xl font-semibold text-text">Recording not found</h1>
      <p className="mt-2 text-sm text-text-muted">
        This link is broken or the recording has been deleted.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm text-accent hover:underline">
        Back home
      </Link>
    </div>
  );
}
