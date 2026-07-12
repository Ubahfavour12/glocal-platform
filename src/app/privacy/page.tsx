export const metadata = {
  title: "Privacy Policy — Platform",
};

/**
 * Privacy policy v1 — working draft for the pre-launch period (required by
 * ad-platform app review). Replaced by counsel-reviewed policy before public
 * launch (Dev Plan launch checklist).
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="datalabel">privacy policy</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: 11 July 2026</p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Who we are</h2>
          <p>
            We provide an AI-assisted marketing platform (working title; final
            trading name to be announced) that helps businesses create,
            publish, and advertise content across social and advertising
            platforms. This policy explains what we collect and why. Contact:
            ubahfavour15@gmail.com.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">What we collect</h2>
          <p>
            <strong className="text-ink">Account data:</strong> your email address and
            sign-in activity.{" "}
            <strong className="text-ink">Business data:</strong> the business details,
            product photos and videos, goals, and budgets you provide.{" "}
            <strong className="text-ink">Campaign data:</strong> performance metrics
            returned by advertising platforms (impressions, clicks, spend).{" "}
            <strong className="text-ink">Click events:</strong> when someone clicks an
            ad link we operate, we record anonymous technical data (click
            identifiers, device type) to measure campaign results. We do not
            build profiles of ad viewers.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">What we never hold</h2>
          <p>
            Card and payment details go directly to our payment providers
            (such as Stripe and Flutterwave) and never touch our servers. We
            keep a ledger of balances and transactions, not payment
            instruments.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Third-party services</h2>
          <p>
            To deliver the service we exchange data with: Meta, TikTok, and
            Google (running your advertising), Metricool (publishing your
            social content), AI providers (generating and reviewing your
            creatives), Supabase (database hosting), and Vercel (application
            hosting). Each receives only what is necessary for its function.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Your rights</h2>
          <p>
            You may request a copy of your data, correct it, or delete your
            account and its data at any time by contacting us. Unspent wallet
            balances are refunded on account closure. We retain records only
            as long as needed for the service, accounting, and legal
            obligations.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Security</h2>
          <p>
            Data is encrypted in transit, access is scoped per customer at the
            database level, and every automated action is recorded in an audit
            log.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Changes</h2>
          <p>
            We will update this policy as the product evolves and note the
            date above. Material changes will be announced in the app.
          </p>
        </section>
      </div>
    </div>
  );
}
