"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkWithdrawal,
  MIN_WITHDRAWAL_USD_MINOR,
  REFUSAL_MESSAGE,
  withdrawableUsdMinor,
} from "@/lib/money/withdrawal";

/**
 * Withdrawing unspent balance.
 *
 * The wallet page has always told customers their unspent balance is
 * refundable. This is the button that makes that sentence true.
 *
 * There is no bank form, and that is the feature. The money is refunded to the
 * cards and accounts that paid it in, so the customer types one number and we
 * never hold their bank details. It is also why a stolen session cannot drain
 * a wallet: there is no destination field to point somewhere else.
 *
 * Kept behind a disclosure rather than sitting open next to "add funds",
 * because withdrawing is a deliberate act and an always-open form invites
 * mis-taps; and the same rules the server enforces run here as you type, so a
 * refused amount says why before you commit to it.
 */
export function WithdrawButton({
  businessId,
  balanceUsdMinor,
  hasPendingWithdrawal,
}: {
  businessId: string;
  balanceUsdMinor: number;
  hasPendingWithdrawal: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = withdrawableUsdMinor(balanceUsdMinor);
  const [amount, setAmount] = useState((available / 100).toFixed(2));

  const usdMinor = Math.round(Number(amount) * 100);
  const verdict = checkWithdrawal({
    amountUsdMinor: Number.isFinite(usdMinor) ? usdMinor : NaN,
    balanceUsdMinor,
    hasPendingWithdrawal,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/wallet/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, usd_minor: usdMinor }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res.ok) {
      setError(data?.error ?? "Could not start the withdrawal.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (hasPendingWithdrawal) {
    return (
      <div className="rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">withdrawal in progress</div>
        <p className="mt-2 text-sm text-ink-muted">
          Your request is being processed and the amount is already held out of your balance, so it
          cannot be spent on ads in the meantime. You can start another once it settles.
        </p>
      </div>
    );
  }

  if (available <= 0) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        Withdraw unspent balance
      </button>
    );
  }

  const field = "rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        ${(available / 100).toFixed(2)} is unspent and can be returned to you. It goes back to the
        card or account you paid with, so there are no bank details to enter. Money already spent
        on ads has bought impressions and cannot come back.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="datalabel">amount (USD)</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${field} w-40`}
          />
          <button
            type="button"
            onClick={() => setAmount((available / 100).toFixed(2))}
            className="text-xs text-ink-muted underline hover:text-ink"
          >
            all of it
          </button>
        </div>
      </label>


      {!verdict.ok && amount !== "" && (
        <p className="text-sm text-ink-muted">{REFUSAL_MESSAGE[verdict.reason]}</p>
      )}
      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!verdict.ok || busy}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {busy ? "Requesting…" : `Withdraw $${(usdMinor / 100 || 0).toFixed(2)}`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-ink-faint">
        Minimum ${MIN_WITHDRAWAL_USD_MINOR / 100}, or your whole balance if it is less. It leaves
        your spendable balance straight away so it cannot be spent on ads while it is on its way
        back, and refunds land on the original card in the time your bank takes, usually a few
        working days.
      </p>
    </form>
  );
}
