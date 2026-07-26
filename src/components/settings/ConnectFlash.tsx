"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Result banner for the OAuth connect flows (Phase 3 polish). The Meta/Shopify
 * callbacks redirect back here with ?connect= or ?store=; without this the user
 * lands on Settings with no idea whether it worked. Reads the code, shows a
 * plain-language banner, then strips the param from the URL so a refresh is clean.
 */

const META: Record<string, string> = {
  success: "Facebook / Instagram connected. The agent can now post organically alongside your ads.",
  unconfigured: "Social connect isn't switched on yet — the Meta app keys are still pending.",
  no_pages: "No Facebook Page was found on that account. Create or pick a Page, then connect again.",
  no_business: "Finish onboarding first, then connect your accounts.",
  state_mismatch: "That connect link expired. Please try connecting again.",
  exchange_failed: "We couldn't finish connecting with Meta. Please try again.",
};

const SHOPIFY: Record<string, string> = {
  success: "Shopify connected. Your sales now sync automatically for true return on spend.",
  unconfigured: "Shopify connect isn't switched on yet — the Partner-app keys are still pending.",
  bad_shop: "That doesn't look like a valid .myshopify.com store. Check the address and try again.",
  shop_mismatch: "The store didn't match — please start the connection again.",
  bad_hmac: "We couldn't verify the response from Shopify. Please try again.",
  state_mismatch: "That connect link expired. Please try connecting again.",
  exchange_failed: "We couldn't finish connecting with Shopify. Please try again.",
  no_business: "Finish onboarding first, then connect your store.",
};

export function ConnectFlash() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const connect = params.get("connect");
  const store = params.get("store");
  const code = connect ?? store ?? null;
  const map = connect ? META : store ? SHOPIFY : null;
  const message = code && map ? (map[code] ?? null) : null;
  const isSuccess = code === "success";

  const [dismissed, setDismissed] = useState(false);

  // Clean the URL once we've captured the code (so a refresh doesn't re-show it).
  useEffect(() => {
    if (code) router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!message || dismissed) return null;

  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 rounded-card border px-4 py-3 text-sm ${
        isSuccess
          ? "border-positive/30 bg-positive/10 text-ink"
          : "border-negative/30 bg-negative/10 text-ink"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 ${isSuccess ? "text-positive" : "text-negative"}`}>
          {isSuccess ? "✓" : "!"}
        </span>
        <p>{message}</p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-ink-faint transition-colors hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
