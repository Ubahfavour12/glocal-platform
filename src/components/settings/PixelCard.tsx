"use client";

import { useState } from "react";
import { pixelSnippet } from "@/lib/tracking/pixel";

/**
 * Website tracking pixel — the one line a customer pastes into their site's
 * header so we can attribute purchases back to the exact ad. Shopify sellers
 * connect instead (one click); this is for every other website.
 */
export function PixelCard({ businessId, origin }: { businessId: string; origin: string }) {
  const snippet = pixelSnippet(businessId, origin);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">website tracking</div>
      <p className="mt-2 text-sm text-ink-muted">
        Not on Shopify? Paste this one line into your website&apos;s header (the &quot;custom code&quot;
        box in most site builders). Then on your order-confirmation page, call
        <span className="font-mono text-xs text-ink"> glocalTrack.purchase(total)</span>. We&apos;ll tie
        each sale back to the ad that drove it.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface p-3">
        <code className="whitespace-pre text-xs text-ink-muted">{snippet}</code>
      </div>
      <button
        onClick={copy}
        className="mt-3 rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        {copied ? "Copied ✓" : "Copy snippet"}
      </button>
    </div>
  );
}
