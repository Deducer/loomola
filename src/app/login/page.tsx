import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-4 rounded-lg border border-white/10 p-6"
      >
        <h1 className="text-2xl font-semibold">Sign in</h1>
        {params.error && (
          <p className="rounded bg-red-500/20 p-2 text-sm text-red-200">
            {params.error}
          </p>
        )}
        <div>
          <label htmlFor="email" className="block text-sm">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-white/20 bg-transparent px-3 py-2 outline-none focus:border-white/40"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-white/90 py-2 text-sm font-medium text-black hover:bg-white"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
