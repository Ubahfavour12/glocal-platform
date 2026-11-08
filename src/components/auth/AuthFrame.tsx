import Link from "next/link";
import { GlocalLogo } from "@/components/brand/Logo";

/**
 * The signed-out frame for sign-in and sign-up, matching the design canvas.
 *
 * Two columns from laptop width: the product's promise on the left, the form
 * in a glass card on the right. On a phone the promise collapses to one line
 * above the form, because there the form is the only thing that matters.
 *
 * The preview card is illustration, not data: nobody is signed in yet, so it
 * shows what an evening with the agent looks like rather than any figures.
 */
const POINTS = [
  { k: "01", t: "Upload one product photo", b: "The agent writes and renders the ads from it." },
  { k: "02", t: "Approve once a day", b: "Every evening, tomorrow's plan. No tap, nothing runs." },
  { k: "03", t: "Your best ad keeps winning", b: "Two challengers take on the champion daily." },
];

export function AuthFrame({
  mode,
  children,
}: {
  mode: "signin" | "signup";
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-1 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 40% at 15% 0%, rgba(245,133,16,0.16) 0%, transparent 70%), radial-gradient(45% 40% at 95% 10%, rgba(99,102,241,0.10) 0%, transparent 70%), radial-gradient(60% 50% at 50% 110%, rgba(245,133,16,0.07) 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-12 px-5 py-10 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-16">
        <section className="hidden lg:block">
          <div>
            <GlocalLogo />
          </div>
          <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-[var(--lit-edge)] bg-accent-soft px-3 py-1">
            <span className="gl-orb h-1.5 w-1.5 rounded-full" />
            <span className="font-mono text-[10.5px] tracking-[0.08em] text-accent-bright">
              autonomous marketing for local business
            </span>
          </div>
          <h2 className="gl-title mt-5 max-w-[16ch] text-5xl font-semibold leading-[1.05] tracking-[-0.04em]">
            Ads that improve themselves while you run the shop.
          </h2>
          <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-ink-muted">
            Glocal writes your ads, tests them against each other every day, and moves
            the budget to whatever brings customers. Nothing spends without your tap.
          </p>

          <ol className="mt-10 grid max-w-lg gap-3">
            {POINTS.map((p) => (
              <li
                key={p.k}
                className="rounded-card flex items-start gap-4 border border-line bg-surface-raised px-4 py-3.5"
              >
                <span className="font-mono text-xs text-accent-bright">{p.k}</span>
                <span>
                  <span className="block text-sm font-medium text-ink">{p.t}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-muted">{p.b}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="gl-lit rounded-card mt-6 max-w-lg px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-bright" />
              <span className="datalabel text-accent-bright">agent · 18:00</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">
              Tomorrow&rsquo;s plan is ready. Challenger B took the crown at a third less
              per chat, so I have moved the budget across.
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-md">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <GlocalLogo />
            <p className="mt-3 max-w-[30ch] text-sm text-ink-muted">
              Ads that improve themselves while you run the shop.
            </p>
          </div>
          <div className="rounded-[22px] border border-line bg-surface-raised p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)] [background-image:var(--card-sheen)] sm:p-8">
            {children}
          </div>
          <p className="mt-6 text-center text-xs text-ink-faint">
            {mode === "signup" ? "Already have an account? " : "New to Glocal? "}
            <Link
              href={mode === "signup" ? "/login" : "/signup"}
              className="text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </Link>
            <span className="mx-2 text-line">·</span>
            <Link href="/privacy" className="hover:text-ink-muted">
              Privacy
            </Link>
            <span className="mx-2 text-line">·</span>
            <Link href="/terms" className="hover:text-ink-muted">
              Terms
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
