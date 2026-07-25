import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="datalabel">autonomous marketing</div>
      <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Upload a photo. Fund a wallet.
        <br />
        <span className="text-accent-bright">Approve once a day.</span>
      </h1>
      <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted">
        An AI agent studies the most viral ads in your niche, produces premium
        creatives, posts everywhere, runs the ads, and doubles down on what
        works, every single day. No ad accounts. No pixels. No agency.
      </p>
      <div className="mt-10 flex items-center gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
        >
          Get started
        </Link>
        <Link
          href="/demo"
          className="rounded-lg border border-line px-6 py-3 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          See it in action
        </Link>
      </div>
      <p className="mt-5 text-sm text-ink-faint">
        You set the budget, from $10 a day.{" "}
        <Link href="/login" className="underline hover:text-ink-muted">
          Sign in
        </Link>
      </p>
    </div>
  );
}
