"use client";

import { useState } from "react";

/**
 * Shopify connect card. Shopify OAuth needs to know WHICH store first, so the
 * customer types their store address; we hand off to /api/oauth/shopify/start
 * which redirects to their own Shopify admin to authorize.
 */
export function ConnectShopify({ connected }: { connected: string | null }) {
  const [shop, setShop] = useState("");

  if (connected) {
    return (
      <div className="rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">store connection</div>
        <p className="mt-2 text-sm text-ink">
          {connected} connected — sales sync automatically for true return on spend.
        </p>
      </div>
    );
  }

  function connect() {
    const clean = shop.trim();
    if (!clean) return;
    window.location.href = `/api/oauth/shopify/start?shop=${encodeURIComponent(clean)}`;
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">store connection</div>
      <p className="mt-2 text-sm text-ink-muted">
        On Shopify? Connect once for automatic sales tracking — one click, zero code.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connect()}
          placeholder="your-store.myshopify.com"
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          onClick={connect}
          disabled={!shop.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          Connect Shopify
        </button>
      </div>
    </div>
  );
}
