"use client";

import { useState } from "react";

/**
 * Plan-choice button. POSTs to /api/billing/subscribe and forwards to the
 * hosted checkout link.
 *
 * It used to answer EVERY failure with "checkout opens as soon as payments go
 * live". That was written when no rail had keys, and it aged into a lie: with
 * Paystack configured and rejecting the currency, the button reported a
 * missing feature while the actual fault was a fixable misconfiguration nobody
 * could see. A button that explains only the failure it was born with will
 * eventually explain the wrong one, so it now shows what the server said.
 */
export function SubscribeCta({
  tierId,
  tierName,
  businessId,
  current,
  recommended,
}: {
  tierId: string;
  tierName: string;
  businessId?: string;
  current: boolean;
  recommended?: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "soon" | "error">("idle");
  const [message, setMessage] = useState("");

  if (current) {
    return (
      <div className="mt-4 rounded-lg border border-line bg-surface px-4 py-2 text-center text-sm text-ink-muted">
        Your current plan
      </div>
    );
  }

  async function subscribe() {
    if (!businessId) {
      setState("soon");
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, tier: tierId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { link?: string; error?: string }
        | null;
      if (res.ok && data?.link) {
        window.location.href = data.link;
        return;
      }
      // No rail configured at all is genuinely "not live yet". Anything else is
      // a fault worth naming, because someone can act on it.
      if (/No payment rail is configured/i.test(data?.error ?? "")) {
        setState("soon");
        return;
      }
      setState("error");
      setMessage(data?.error ?? "Checkout could not be started. Please try again.");
    } catch {
      setState("error");
      setMessage("Could not reach checkout. Check your connection and try again.");
    }
  }

  return (
    <div className="mt-4">
      <button
        onClick={subscribe}
        disabled={state === "loading"}
        className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
          recommended
            ? "bg-accent text-white hover:bg-accent-bright"
            : "border border-line text-ink hover:border-accent"
        }`}
      >
        {state === "loading" ? "Starting checkout…" : `Choose ${tierName}`}
      </button>
      {state === "soon" && (
        <p className="mt-2 text-xs text-ink-faint">
          Checkout opens as soon as payments go live — you&apos;ll pick your payment method and
          subscribe right here.
        </p>
      )}
      {state === "error" && <p className="mt-2 text-xs text-negative">{message}</p>}
    </div>
  );
}
