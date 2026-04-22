export function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div>
        <h1 className="text-2xl font-semibold">Recordings</h1>
        <p className="mt-1 text-sm opacity-60">
          Recording, sharing, and AI features arrive in Milestones 3–11. Set up
          your brand profiles now so they&apos;re ready when recordings ship.
        </p>
      </div>
      <div className="mt-8 rounded-lg border border-white/10 p-6">
        <h2 className="text-sm font-medium">Current milestone</h2>
        <p className="mt-1 text-sm opacity-80">
          M2: Data model + brand profiles CRUD
        </p>
      </div>
    </div>
  );
}
