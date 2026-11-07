import type { Metadata } from "next";
import Link from "next/link";
import { subscriptionPriceUsdMinor } from "@/lib/billing/subscribe";
import { subscriptionConfigForTier, type TierId } from "@/lib/billing/subscription";
import {
  JURISDICTION,
  LAST_UPDATED,
  contactSentence,
  operatorLine,
} from "@/lib/legal/entity";

export const metadata: Metadata = {
  title: "Terms of Service, Glocal",
  description:
    "The agreement between you and the operator of Glocal: what the agent does with your money, what it does not promise, and who is responsible for what.",
};

/**
 * Terms of service v1.
 *
 * This page did not exist, which was the larger of the two legal gaps: a
 * service whose agent spends a customer's money on its own initiative, every
 * night, with nobody having agreed to anything. The signup form now carries a
 * consent line pointing here.
 *
 * TWO RULES FOR THIS PAGE.
 *
 * 1. THE PRICES COME FROM THE BILLING CODE, not from prose. The markup is the
 *    business model and the FCCPA expects it stated plainly; a hardcoded
 *    percentage here would drift from `subscription.ts` the first time a tier
 *    was repriced, and the version a customer could point at would be the
 *    stale one. `spendMarkupBps` is the single source.
 * 2. WHERE THE PRODUCT MAKES A CLAIM, THESE TERMS MUST NOT. The marketing copy
 *    promises verified-sales tracking and better return on spend. Clause 7
 *    therefore disclaims any guarantee of advertising results in as many words,
 *    because that is the gap a disappointed customer would otherwise sue into.
 */

const ORDER: TierId[] = ["spark", "growth", "scale"];

function markupPercent(tier: TierId): string {
  // bps to percent. Integer tiers today, so one decimal only when needed.
  const pct = subscriptionConfigForTier(tier).spendMarkupBps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

function priceUsd(tier: TierId): string {
  return `$${(subscriptionPriceUsdMinor(tier) / 100).toFixed(0)}`;
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="datalabel">terms of service</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink-muted">
        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            1. Who you are agreeing with, and what you are agreeing to
          </h2>
          <p>
            These terms are between you and {operatorLine()}, a company
            registered in Nigeria, which operates Glocal. By creating an account
            you accept them. If you are agreeing on behalf of a business, you
            confirm you may bind it.
          </p>
          <p className="mt-2">
            <strong className="text-ink">Glocal acts on its own.</strong> This is
            the part to read twice. Once you set a goal and a budget, the agent
            writes ads, makes images and videos, publishes posts, starts and
            stops advertising, moves budget between ads, and spends the money in
            your wallet to do it — each night, without asking you first. That is
            the product, not a side effect of it. You can set it to ask for
            approval instead, and you can stop it at any time, but while it is
            running it is making these decisions for you.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">2. Your account</h2>
          <p>
            Keep your sign-in details to yourself. Anything done from your
            account is treated as done by you, including spending. Sign out when
            you are on a device other people use. You must be old enough to
            enter a contract and to hold the business you are advertising.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            3. Your wallet, and what we charge
          </h2>
          <p>
            Advertising is paid from a wallet you top up in advance. The wallet
            is a prepaid balance held for buying advertising on your behalf. It
            is not a deposit, it is not a bank account, and it earns no
            interest. We charge a markup on the advertising spend that passes
            through it, and the rate depends on your plan:
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {ORDER.map((tier) => (
              <li key={tier}>
                <strong className="text-ink capitalize">{tier}</strong> —{" "}
                {priceUsd(tier)} a month, {markupPercent(tier)} on ad spend.
              </li>
            ))}
            <li>
              <strong className="text-ink">Organic</strong> — free, and it buys no
              advertising, so there is no markup.
            </li>
          </ul>
          <p className="mt-2">
            The markup is shown to you before you spend and recorded against
            every charge, so you can always see what you paid us and what went
            to the advertising platform. Unspent balance is yours: withdraw it
            whenever you like, and on closing your account. Advertising already
            bought cannot be refunded, because the platform has already been
            paid. Amounts are in US dollars and converted at the rate shown at
            the time; currency movement between your top-up and your spend is
            yours, not ours.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            4. Plans and cancelling
          </h2>
          <p>
            Paid plans run monthly and renew until you cancel. Cancelling stops
            the next renewal and takes effect at the end of the period you have
            paid for — you keep the plan until then. We do not refund part of a
            month. If we change a price we will tell you before it applies to
            you, and you may cancel instead.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            5. The content you give us
          </h2>
          <p>
            You keep ownership of your photos, videos, logo and business
            information. You give us permission to use them to run your
            marketing: to generate creatives from them, publish them to the
            accounts you connect, and show them to the advertising platforms.
            You confirm you have the right to use what you upload — including
            any person appearing in a photo, and any music, brand or image you
            did not make yourself. This is the one warranty we genuinely rely
            on, because a rights complaint lands on your advertising account
            before it lands on ours.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            6. Content the AI makes
          </h2>
          <p>
            Ads, posts and images produced for you are yours to use. They are
            generated by AI from what you provided, and you are the publisher:
            you are responsible for what goes out under your business name, and
            we record which model produced each creative so that it can be
            labelled where a platform or a law requires it. AI gets things
            wrong — a price, a claim, a detail about your own business — and it
            may produce something close to what it produced for someone else. If
            you have the agent running without approvals, you are accepting that
            risk in exchange for the speed.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            7. We do not promise results
          </h2>
          <p>
            <strong className="text-ink">
              Nothing in Glocal is a guarantee that your advertising will work.
            </strong>{" "}
            The agent tests, measures and favours what performs better for you,
            and it will often beat running ads by hand — but sales, enquiries,
            reach and return on spend depend on your product, your price, your
            market and the platforms&apos; own decisions, none of which we
            control. Figures we show you are measurements and estimates, not
            commitments, and past performance of one ad does not predict the
            next. If a claim anywhere in our marketing reads like a promise of
            results, this clause is the one that governs.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            8. The advertising platforms&apos; rules apply to you
          </h2>
          <p>
            Your ads run on Meta, TikTok and Google, and your posts go to your
            own social accounts. Their policies bind you directly. We check
            creatives against the rules we know, and that check is not a
            guarantee of approval. If a platform rejects an ad, restricts your
            page or disables your advertising account, that is a decision we
            cannot overturn and cannot be held responsible for — we do not own
            those accounts, you do.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            9. What you may not do with it
          </h2>
          <p>
            Do not use Glocal to advertise anything unlawful, to make claims you
            cannot stand behind, to impersonate another business, to advertise a
            business you do not run, or for anything the platforms prohibit. Do
            not try to break, overload or reverse-engineer the service, and do
            not resell it as your own.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            10. Suspension and ending this
          </h2>
          <p>
            You may stop at any time: cancel your plan, withdraw your balance
            and close your account from your settings. We may suspend or end an
            account that breaks these terms, that a platform or a payment
            provider requires us to stop serving, or where we are obliged to by
            law. If we end it for a reason other than your breach, we refund
            your unspent balance and the unused part of your plan. Withdraw
            before you close: once an account is erased we can no longer
            identify the balance as yours.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            11. Our responsibility, and its limit
          </h2>
          <p>
            We will provide the service with reasonable care and skill. We are
            not liable for lost profits, lost sales, lost data or lost
            opportunity, for the acts of the advertising platforms and other
            providers named in our{" "}
            <Link href="/privacy" className="underline hover:text-ink">
              Privacy Policy
            </Link>
            , or for advertising that did not perform as you hoped. Where we are
            liable, our total liability is limited to the fees you paid us in
            the three months before the claim — excluding your advertising
            spend, which was money we passed to a platform on your instruction.
            Nothing here limits liability that cannot be limited by law.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            12. Your data, and changes to these terms
          </h2>
          <p>
            How we handle your data is in the{" "}
            <Link href="/privacy" className="underline hover:text-ink">
              Privacy Policy
            </Link>
            , which forms part of this agreement. We will update these terms as
            the product changes and update the date above; material changes will
            be announced in the app before they take effect, and continuing to
            use Glocal after that is how you accept them. {contactSentence()}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">13. Governing law</h2>
          <p>
            These terms are governed by the laws of the Federal Republic of
            Nigeria, and {JURISDICTION} have jurisdiction over any dispute.
          </p>
        </section>
      </div>
    </div>
  );
}
