"use client";

import { useState } from "react";

/**
 * Mark-as-sold, riding the evening approval card (design locked 2026-07-21):
 * one optional ten-second question inside the existing daily habit — never a
 * separate screen, never a nag. Skipping keeps the duel on chat-counting;
 * steady logging upgrades it to real-revenue judging.
 */
export function SalesCheckIn({ businessId }: { businessId: string }) {
  const [mode, setMode] = useState<"ask" | "form" | "done" | "dismissed">("ask");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logged, setLogged] = useState(0);

  async function submit() {
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      setError("Enter the order total, e.g. 45");
      return;
    }
    setBusy(true);
    setError("");
    const trimmed = code.trim();
    const res = await fetch("/api/sales/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        code_source: trimmed ? "message" : "none",
        code: trimmed || null,
        value_usd_minor: Math.round(usd * 100),
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
    setCode("");
    setMode("done");
  }

  if (mode === "dismissed") return null;

  return (
    <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">yesterday&apos;s sales</div>

      {mode === "ask" && (
        <>
          <p className="mt-2 text-sm text-ink">
            Did any of yesterday&apos;s chats become sales?
          </p>
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
            Optional — but when you log sales steadily, I optimise for money instead of chats.
          </p>
        </>
      )}

      {mode === "form" && (
        <div className="mt-3 grid gap-2">
          <label className="text-xs text-ink-muted">
            Order total (USD) — the whole order, every item
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
          <label className="text-xs text-ink-muted">
            Ad code from the buyer&apos;s first message (leave empty for walk-in / repeat customer)
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. GL-7K4"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <div className="mt-1 flex gap-2">
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
            Saved — {logged} sale{logged === 1 ? "" : "s"} logged. Every one makes tomorrow&apos;s
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
