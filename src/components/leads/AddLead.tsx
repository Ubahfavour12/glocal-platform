"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Log a lead that did not arrive through a form.
 *
 * Mostly WhatsApp, which is where most Nigerian SMB enquiries actually happen.
 * The owner pastes the message they received; the prefilled text carries
 * "(ref GL-XXXXXX)", so a real message attributes itself to the exact ad that
 * produced it.
 *
 * This is why there is no lead-per-click: most people who tap a wa.me link
 * never send anything, so a lead per tap would fill this list with people who
 * were never leads — and lead counts feed cost-per-won, so it would corrupt
 * the quality signal rather than improve it. A human confirms something real
 * happened; the machine does the attribution.
 */
export function AddLead() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), ref: ref.trim() || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not add that.");
      return;
    }
    setLabel("");
    setRef("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:border-accent hover:text-ink"
      >
        Add a lead
      </button>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">add a lead</div>

      <label className="mt-3 block text-sm text-ink-muted" htmlFor="lead-label">
        Who is it?
      </label>
      <input
        id="lead-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Ada, Chidi from Surulere…"
        className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />

      <label className="mt-4 block text-sm text-ink-muted" htmlFor="lead-ref">
        Paste their WhatsApp message (optional)
      </label>
      <p className="mt-1 text-xs text-ink-faint">
        If they came from an ad, the message has a code like GL-7K4 in it. Paste
        it and Glocal knows which ad brought them.
      </p>
      <textarea
        id="lead-ref"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        rows={2}
        placeholder="Hi! I saw your ad and I'm interested. (ref GL-7K4)"
        className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />

      {error ? (
        <p className="mt-3 text-sm text-negative" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted hover:border-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
