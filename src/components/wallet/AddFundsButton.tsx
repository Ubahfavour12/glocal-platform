"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Dev-mode funding control; becomes the PSP checkout launcher at launch. */
export function AddFundsButton({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function topUp(usdMinor: number) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/wallet/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, usd_minor: usdMinor }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "top-up failed");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="flex gap-2">
        {[7000, 14000, 20000].map((minor) => (
          <button
            key={minor}
            disabled={busy}
            onClick={() => topUp(minor)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
          >
            +${minor / 100}
          </button>
        ))}
      </div>
      <p className="datalabel mt-2">test funds — real payments arrive with stripe/flutterwave</p>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
    </div>
  );
}
