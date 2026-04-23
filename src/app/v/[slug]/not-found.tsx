import Link from "next/link";

export default function RecordingNotFound() {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-xl font-semibold">Recording not found</h1>
      <p className="mt-2 text-sm opacity-60">
        This link is broken or the recording has been deleted.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm underline">
        Back home
      </Link>
    </div>
  );
}
