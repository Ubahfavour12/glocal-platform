"use client";

import { useState } from "react";

/**
 * Plan-choice button. Checkout itself opens in Phase 4 (needs live payments),
 * so for now clicking explains what happens rather than silently going nowhere.
 */
export function SubscribeCta({
  tierName,
  current,
  recommended,
}: {
  tierName: string;
  current: boolean;
  recommended?: boolean;
}) {
  const [clicked, setClicked] = useState(false);

  if (current) {
    return (
      <div className="mt-4 rounded-lg border border-line bg-surface px-4 py-2 text-center text-sm text-ink-muted">
        Your current plan
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        onClick={() => setClicked(true)}
        className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          recommended
            ? "bg-accent text-white hover:bg-accent-bright"
            : "border border-line text-ink hover:border-accent"
        }`}
      >
        Choose {tierName}
      </button>
      {clicked && (
        <p className="mt-2 text-xs text-ink-faint">
          Checkout opens as soon as payments go live — you&apos;ll pick your payment method and
          subscribe right here.
        </p>
      )}
    </div>
  );
}
