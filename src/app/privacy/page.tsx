import type { Metadata } from "next";
import {
  LAST_UPDATED,
  contactSentence,
  operatorLine,
} from "@/lib/legal/entity";

export const metadata: Metadata = {
  title: "Privacy Policy, Glocal",
  description:
    "What Glocal collects, who else handles it, where it is processed and how long it is kept.",
};

/**
 * Privacy policy v2.
 *
 * v1 was a pre-launch draft and had three problems worth naming, because the
 * fixes are the whole point of this rewrite:
 *
 *   1. It named a domain we do not own and published a personal email address.
 *      Both now come from `@/lib/legal/entity`, where they are empty.
 *   2. Its list of third parties named two of the eleven services that
 *      actually receive data. Under-disclosing processors is worse than
 *      listing none, because the list invites the reader to trust it.
 *   3. It said data is kept "as long as needed", which says nothing, and it
 *      leaned on European data-protection law in a product that serves
 *      Nigerian businesses from a Nigerian company. The governing regime is
 *      the NDPA 2023, and a test now fails if either page says otherwise.
 *
 * Every period and every promise below was checked against the code, not
 * written from intent. Where the two disagreed the code was fixed: the
 * ninety-day limit on click events existed as `prune_click_events` in
 * migration 0032 and nothing ever called it, so the reconcile job now does.
 * A policy that promises a purge nobody runs is not a policy.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="datalabel">privacy policy</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Who we are</h2>
          <p>
            Glocal is an AI marketing platform operated by {operatorLine()}, a
            company registered in Nigeria. It helps businesses create, publish
            and advertise content across social and advertising platforms. For
            the data described here, that company is the data controller under
            the Nigeria Data Protection Act 2023, and answers to the Nigeria
            Data Protection Commission. {contactSentence()}
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
            <strong className="text-ink">Payment records:</strong> your wallet
            balance, top-ups, charges and refunds. Card details are not among
            them — see below.{" "}
            <strong className="text-ink">Click events:</strong> when someone clicks an
            ad link we operate, we record anonymous technical data (click
            identifiers, device type, coarse location) to measure campaign
            results. We do not build profiles of ad viewers.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            Your own customers&apos; data
          </h2>
          <p>
            If you connect a store or a WhatsApp number, we receive order and
            message data that belongs to your customers, so we can tell which
            ads actually produced sales. For that data you are the controller
            and we act on your instructions: we use it to attribute your
            results and for nothing else, and it is deleted with your account.
            Telling your own customers how you use their data remains your
            responsibility, not ours.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">How we use your data</h2>
          <p>
            Everything you give us is used for one purpose: to run your own
            advertising better. Your category tells us which ads to study and
            which safety rules apply; your goal, photos, area, and budget shape
            what we make, where it runs, and how much we test; your sales and
            performance data teach the agent what works for you. The longer you
            use Glocal, the smarter your own agent gets. <strong className="text-ink">What
            we never do:</strong> we never sell your data, never use one
            business&apos;s data to help another, and never train a shared model
            that a competitor could benefit from. Your data serves your business
            alone.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">What we never hold</h2>
          <p>
            Card and bank details go directly to our payment providers and never
            touch our servers. We keep a ledger of balances and transactions,
            not payment instruments.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            Who else handles your data
          </h2>
          <p>
            To deliver the service we share data with the following, each
            receiving only what its job requires:
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>
              <strong className="text-ink">Meta, TikTok and Google</strong> — running
              your advertising, and reporting how it performed.
            </li>
            <li>
              <strong className="text-ink">Metricool</strong> — publishing your posts
              to your social accounts.
            </li>
            <li>
              <strong className="text-ink">fal and Higgsfield</strong> — generating
              your images and videos from the prompts and photos we send.
            </li>
            <li>
              <strong className="text-ink">Anthropic</strong> — writing your ad copy
              and analysing your market. Your prompts are not used to train
              their models.
            </li>
            <li>
              <strong className="text-ink">Paystack, Monnify and Flutterwave</strong> —
              taking payment and holding the card details we never see.
            </li>
            <li>
              <strong className="text-ink">Shopify and WhatsApp</strong> — only where
              you have connected them, to read the orders and enquiries your
              ads produced.
            </li>
            <li>
              <strong className="text-ink">Supabase and Vercel</strong> — hosting the
              database and the application itself.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            Where your data is processed
          </h2>
          <p>
            Our database and application are hosted outside Nigeria, and the
            advertising, rendering and AI services above operate internationally.
            Your data therefore crosses borders. The NDPA permits this where the
            recipient is bound by adequate protections, and each of these
            providers is engaged under terms that require them to protect your
            data and to use it only for the service they provide to us.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">How long we keep it</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>
              <strong className="text-ink">Account, business and creative data</strong> —
              while your account is open. Erased immediately when you close it.
            </li>
            <li>
              <strong className="text-ink">Campaign and performance data</strong> —
              while your account is open; it is what the agent learns from.
            </li>
            <li>
              <strong className="text-ink">Click events</strong> — 90 days, except the
              few linked to a recorded sale, which are kept as the evidence for
              that sale.
            </li>
            <li>
              <strong className="text-ink">Financial records</strong> — six years, as
              Nigerian company law requires of accounting records. These survive
              account closure, unlinked from you.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Your rights</h2>
          <p>
            Under the NDPA you may ask for a copy of your data, have it
            corrected, or have it erased. Erasure you can carry out yourself:
            your account settings close the account and destroy its data at
            once, and the page tells you what survives before you confirm it.
            Unspent wallet balances are refundable — withdraw before you close,
            because an erased account can no longer be identified as yours. What
            we keep is the financial record described above, which the law
            requires us to hold and which is detached from your identity when
            you leave. You may also complain to the Nigeria Data Protection
            Commission.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Security</h2>
          <p>
            Data is encrypted in transit, access is scoped per customer at the
            database level so one business cannot read another&apos;s rows, and
            every automated action the agent takes is recorded in an audit log.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">Changes</h2>
          <p>
            We will update this policy as the product evolves and change the
            date above when we do. Material changes will be announced in the
            app.
          </p>
        </section>
      </div>
    </div>
  );
}
