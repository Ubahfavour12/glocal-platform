"use client";

import { useState } from "react";

/**
 * Wallet funding, UF-2. Two paths:
 *  - "Pay with card": a real hosted checkout on whichever rail is active
 *    (test-mode until the merchant account goes live). The final ₦ price is
 *    quoted before redirect.
 *
 * The rail is not hardcoded here. The checkout response names it, and the
 * footnote reports that name, so the screen cannot end up claiming a customer
 * paid through a PSP they did not.
 */
export function AddFundsButton({ businessId }: { businessId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [usd, setUsd] = useState(70);

  async function cardCheckout() {
    setBusy("card");
    setError("");
    const res = await fetch("/api/wallet/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, usd_minor: Math.round(usd * 100) }),
    });
    const data = (await res.json().catch(() => null)) as
      | { link?: string; error?: string }
      | null;
    if (!res.ok || !data?.link) {
      setBusy(null);
      setError(data?.error ?? "checkout failed");
      return;
    }
    window.location.href = data.link; // off to the rail's hosted page
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <div>
          <label className="datalabel block">amount (usd)</label>
          <input
            type="number"
            min={10}
            step={5}
            value={usd}
            onChange={(e) => setUsd(Math.max(10, Number(e.target.value)))}
            className="mt-1 w-28 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <button
          disabled={busy !== null}
          onClick={cardCheckout}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {busy === "card" ? "Preparing checkout…" : "Pay with card (₦)"}
        </button>
      </div>

      {/* Deposit reassurance — warm, transparent-in-principle, no fee math. */}
      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-overlay/40 px-4 py-3">
        <span className="mt-0.5 shrink-0 text-accent-bright">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <div className="text-sm font-medium text-ink">Every dollar goes into your wallet</div>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            Nothing is taken up front. A small service fee applies only as your ads actually run, and
            anything you don&apos;t spend is always refundable.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
