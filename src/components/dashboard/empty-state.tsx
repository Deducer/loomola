export function EmptyState({ userEmail }: { userEmail: string }) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">Loom Clone</h1>
      <p className="mt-2 text-sm opacity-70">
        Signed in as <code className="rounded bg-white/10 px-1">{userEmail}</code>.
      </p>
      <div className="mt-8 rounded-lg border border-white/10 p-6">
        <h2 className="text-lg font-medium">Milestone 1: Foundation</h2>
        <p className="mt-2 text-sm opacity-80">
          The deployment pipeline is working. Recording, sharing, and AI features
          arrive in Milestones 2–11.
        </p>
      </div>
      <form action="/auth/signout" method="post" className="mt-6">
        <button
          type="submit"
          className="rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/5"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
