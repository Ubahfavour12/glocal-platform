"use client";

import { useState } from "react";

const PHRASE = "DELETE MY ACCOUNT";

/**
 * Close the account, for good.
 *
 * The erasure itself has existed since migration 0032 and until now nobody
 * could reach it — the law requires that a deletion request can be carried out,
 * and an API route with no way to call it does not carry anything out.
 *
 * Deliberately undramatic and deliberately hard to do by accident. It is placed
 * last on the page, it is not styled to attract the eye, and it is closed until
 * asked for. The typed phrase is the confirmation: a dialog trains people to
 * click through, whereas typing the words requires having read them.
 *
 * It explains what survives BEFORE the customer commits, rather than after.
 * Someone deleting their account and later discovering we still hold records of
 * their payments would reasonably feel misled, even though keeping those is
 * both lawful and required — so the honest move is to say it up front.
 */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: PHRASE }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // The refusals are the useful ones: money still in the wallet, or a
        // withdrawal in flight. Shown as written rather than flattened into
        // "something went wrong", because they tell the customer what to do.
        setError(data.error ?? "Could not delete the account.");
        setBusy(false);
        return;
      }
      // A full navigation, not router.push(). Next 16.3 lints against this for
      // internal links and is right in general; here the point is precisely the
      // thing a client-side navigation preserves. The account has just been
      // erased and the session ended server-side, so every piece of React state
      // and every cached server component in this tab belongs to a user who no
      // longer exists. Tearing the document down is the only honest state, and
      // router.refresh() would clear the server cache while leaving the
      // component tree holding the deleted customer's data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } catch {
      setError("Could not reach the server. Nothing was deleted.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">closing your account</div>

      {!open ? (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            You can delete your account and everything personal in it at any time.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:border-negative hover:text-negative"
          >
            Delete my account
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink">
            This cannot be undone. Read what happens first.
          </p>

          <div className="mt-4 space-y-3 text-sm">
            <div>
              <span className="block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Deleted immediately
              </span>
              <p className="mt-1 text-ink-muted">
                Your login, your business name and website, every photo you have
                uploaded, everything we generated for you, your connected
                Instagram and Shopify accounts, and the click data from your ads.
              </p>
            </div>

            <div>
              <span className="block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Kept, but no longer linked to you
              </span>
              <p className="mt-1 text-ink-muted">
                Records of money — what you paid in, what was spent on ads, and
                what was paid back out. We are legally required to keep
                accounting records for six years. They stay as figures against a
                reference number that no longer points to you or your business.
              </p>
            </div>

            <div>
              <span className="block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Before you can delete
              </span>
              <p className="mt-1 text-ink-muted">
                Your wallet must be empty. If you still have a balance, withdraw
                it first — once the account is gone we have no way to return it.
              </p>
            </div>
          </div>

          <label className="mt-5 block text-sm text-ink-muted" htmlFor="confirm-erase">
            Type <strong className="text-ink">{PHRASE}</strong> to confirm.
          </label>
          <input
            id="confirm-erase"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-negative"
          />

          {error ? (
            <p className="mt-3 text-sm text-negative" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={erase}
              disabled={typed !== PHRASE || busy}
              className="rounded-lg bg-negative px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete my account permanently"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              disabled={busy}
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted hover:border-accent"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
