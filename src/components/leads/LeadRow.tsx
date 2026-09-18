"use client";

import { useState } from "react";

export interface Lead {
  id: string;
  label: string | null;
  status: "new" | "contacted" | "qualified" | "won" | "lost";
  source: string;
  created_at: string;
  value_usd_minor: number | null;
}

/**
 * One lead, and the tap that settles it.
 *
 * The person this is built for already does this in their head — a social
 * media manager running real budgets described tracking leads through to a
 * close as "I wouldn't call it tracking, I'd call it follow up." So this is
 * not a CRM row with fields. It is a name and the two answers that matter.
 *
 * Won asks for the amount, because without it cost-per-won-deal silently
 * treats the deal as worth nothing, which is worse than refusing. Lost asks
 * for a reason, optionally, because those reasons are what will eventually
 * teach the agent which angles attract people who were never going to buy.
 */
export function LeadRow({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const [mode, setMode] = useState<"idle" | "won" | "lost">("idle");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(status: Lead["status"], extra?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, status, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save that.");
      return;
    }
    onDone();
  }

  const settled = lead.status === "won" || lead.status === "lost";

  return (
    <li className="rounded-lg border border-line bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="block text-sm font-medium text-ink">{lead.label ?? "Lead"}</span>
          <span className="block text-xs text-ink-faint">
            {new Date(lead.created_at).toLocaleDateString()} · {lead.source.replace("_", " ")}
          </span>
        </div>
        {settled ? (
          <span
            className={`shrink-0 text-xs font-medium ${
              lead.status === "won" ? "text-positive" : "text-ink-faint"
            }`}
          >
            {lead.status === "won"
              ? `won · $${((lead.value_usd_minor ?? 0) / 100).toFixed(2)}`
              : "lost"}
          </span>
        ) : null}
      </div>

      {settled ? null : mode === "idle" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {lead.status === "new" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => move("contacted")}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-accent"
            >
              Contacted
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("won")}
            className="rounded-lg border border-positive px-3 py-1.5 text-xs text-positive hover:bg-surface-overlay"
          >
            Turned into business
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("lost")}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-accent"
          >
            Did not
          </button>
        </div>
      ) : mode === "won" ? (
        <div className="mt-3">
          <label className="block text-xs text-ink-muted" htmlFor={`amt-${lead.id}`}>
            How much was it worth?
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id={`amt-${lead.id}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-32 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={busy || amount.trim() === "" || !Number.isFinite(Number(amount))}
              onClick={() => move("won", { valueUsdMinor: Math.round(Number(amount) * 100) })}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <label className="block text-xs text-ink-muted" htmlFor={`why-${lead.id}`}>
            Why not? Optional — this is what teaches the agent.
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id={`why-${lead.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="price, wrong location, never replied…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => move("lost", { note: note.trim() || null })}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-accent"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="mt-2 text-xs text-negative" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
