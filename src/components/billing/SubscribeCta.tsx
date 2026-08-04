"use client";

import { useState } from "react";

/**
 * Plan-choice button. POSTs to /api/billing/subscribe and forwards to the
 * hosted checkout link. Until live payment keys exist the route returns an
 * error, so the button degrades to a "checkout opens when payments go live"
 * note rather than going nowhere.
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
  const [state, setState] = useState<"idle" | "loading" | "soon">("idle");

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
      const data = (await res.json().catch(() => null)) as { link?: string } | null;
      if (res.ok && data?.link) {
        window.location.href = data.link;
        return;
      }
      setState("soon"); // payments not live yet, or checkout unavailable
    } catch {
      setState("soon");
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
    </div>
  );
}
