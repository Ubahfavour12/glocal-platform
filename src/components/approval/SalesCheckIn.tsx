"use client";

import { useState } from "react";

/** One of the business's live ads the seller can attribute a sale to. */
export interface SellableAd {
  /** the ad's smart-link code (what record_sale validates against) */
  code: string;
  /** human label, the ad's hook, so the seller recognises it */
  label: string;
}

/**
 * Mark-as-sold, riding the evening approval card (design locked 2026-07-21):
 * one optional ten-second question inside the existing daily habit, never a
 * separate screen, never a nag.
 *
 * The seller never types a code. They confirm the order (total, and optionally
 * what was bought), then PICK which of their live ads brought the buyer, or say
 * it was a walk-in / repeat customer. Picking an ad attributes the sale to it
 * (seller_pick); a walk-in is recorded unattributed (none) and still counts for
 * totals. Skipping keeps the duel on chat-counting; steady logging upgrades it
 * to real-revenue judging.
 */
export function SalesCheckIn({
  businessId,
  ads = [],
}: {
  businessId: string;
  ads?: SellableAd[];
}) {
  const [mode, setMode] = useState<"ask" | "form" | "done" | "dismissed">("ask");
  const [amount, setAmount] = useState("");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pick, setPick] = useState<string>("none"); // an ad code, or "none" = walk-in
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logged, setLogged] = useState(0);

  async function submit() {
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      setError("Enter the order total, e.g. 45");
      return;
    }
    const attributed = pick !== "none";
    const name = productName.trim();
    let qty: number | undefined;
    let items: { name: string; qty: number }[] | undefined;
    if (name) {
      qty = Math.max(1, Math.floor(Number(quantity) || 1));
      items = [{ name, qty }];
    }

    setBusy(true);
    setError("");
    const res = await fetch("/api/sales/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        code_source: attributed ? "seller_pick" : "none",
        code: attributed ? pick : null,
        value_usd_minor: Math.round(usd * 100),
        quantity: qty,
        items,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "could not save the sale");
      return;
    }
    setLogged((n) => n + 1);
    setAmount("");
    setProductName("");
    setQuantity("");
    setPick("none");
    setMode("done");
  }

  if (mode === "dismissed") return null;

  const pickBtn = (selected: boolean) =>
    `flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
      selected
        ? "border-accent bg-accent-soft text-ink"
        : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
    }`;

  return (
    <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">yesterday&apos;s sales</div>

      {mode === "ask" && (
        <>
          <p className="mt-2 text-sm text-ink">Did any of yesterday&apos;s chats become sales?</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setMode("form")}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
            >
              Log a sale
            </button>
            <button
              onClick={() => setMode("dismissed")}
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              No sales yesterday
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Optional, but when you log sales steadily, I optimise for money instead of chats.
          </p>
        </>
      )}

      {mode === "form" && (
        <div className="mt-3 grid gap-4">
          <label className="text-xs text-ink-muted">
            Order total (USD), the whole order, every item
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="45.00"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="text-xs text-ink-muted">
              What did they buy? (optional)
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Marlango Red"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="text-xs text-ink-muted">
              Qty
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
                className="mt-1 w-20 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
          </div>

          <div>
            <div className="text-xs text-ink-muted">Which ad brought this sale?</div>
            {ads.length === 0 ? (
              <p className="mt-1.5 text-xs text-ink-faint">
                No live ads yet. We&apos;ll log this as a walk-in for now, once your ads are running
                you&apos;ll pick the one that brought each buyer.
              </p>
            ) : (
              <div className="mt-2 grid gap-1.5">
                {ads.map((a) => (
                  <button
                    key={a.code}
                    type="button"
                    onClick={() => setPick(a.code)}
                    className={pickBtn(pick === a.code)}
                  >
                    <span className="truncate">{a.label}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">{a.code}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPick("none")}
                  className={pickBtn(pick === "none")}
                >
                  <span>Not sure / walk-in / repeat customer</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={submit}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save sale"}
            </button>
            <button
              disabled={busy}
              onClick={() => setMode("ask")}
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Back
            </button>
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
        </div>
      )}

      {mode === "done" && (
        <>
          <p className="mt-2 text-sm text-ink">
            Saved, {logged} sale{logged === 1 ? "" : "s"} logged. Every one makes tomorrow&apos;s
            budget smarter.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setMode("form")}
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Log another
            </button>
            <button
              onClick={() => setMode("dismissed")}
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Done
            </button>
          </div>
        </>
      )}
    </section>
  );
}
