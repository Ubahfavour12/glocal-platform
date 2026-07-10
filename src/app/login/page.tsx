import Link from "next/link";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm">
        <div className="datalabel">sign in</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Welcome back</h1>

        {supabaseConfigured ? (
          <form className="mt-8 flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="you@business.com"
              className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
            >
              Send magic link
            </button>
          </form>
        ) : (
          <div className="mt-8 rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">setup pending</div>
            <p className="mt-2 text-sm text-ink-muted">
              Authentication activates once the Supabase project is connected
              (see <span className="font-mono text-xs">.env.example</span>).
              Until then you can walk through onboarding in demo mode.
            </p>
            <Link
              href="/onboarding"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
            >
              Continue in demo mode
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
