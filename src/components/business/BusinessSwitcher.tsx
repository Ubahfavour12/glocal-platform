"use client";

import { useState } from "react";
import type { BusinessRef } from "@/lib/business/current";

/**
 * Switch between the businesses on this account.
 *
 * Renders NOTHING when there is only one, which is almost everybody. A
 * switcher with a single option is a control that cannot do anything, and it
 * would make a simple account look like an agency tool.
 *
 * A full page load rather than a router push: the selection lives in a cookie
 * the server reads, and every page on screen was rendered for the previous
 * business. Reloading is the only way to be certain nothing from the old one
 * is left behind — and showing one business's numbers under another's name is
 * the single worst bug this feature could have.
 */
export function BusinessSwitcher({
  businesses,
  currentId,
}: {
  businesses: BusinessRef[];
  currentId: string | null;
}) {
  const [busy, setBusy] = useState(false);

  if (businesses.length < 2) return null;

  async function switchTo(businessId: string) {
    if (businessId === currentId || busy) return;
    setBusy(true);
    const res = await fetch("/api/business/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId }),
    });
    if (!res.ok) {
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Business</span>
      <select
        value={currentId ?? ""}
        disabled={busy}
        onChange={(e) => switchTo(e.target.value)}
        className="max-w-[12rem] truncate rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
      >
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
