/**
 * Sales-tracking connection modes — locked 2026-07-19.
 * The platform is NOT Shopify-only. A business connects whichever door its
 * customers actually walk through, and the verdict engine judges ads on the
 * strongest signal that door can produce (ROAS → CPCI → engagement):
 *
 *   store    — connected storefront (Shopify etc.): real purchase revenue → ROAS
 *   website  — any website/product link: smart-link clicks + landing views → CPCI
 *   whatsapp — a phone number: wa.me deep link + conversation-started events → CPCI
 *
 * Every ad's outbound URL goes through our smart link (/l/[code]) first, so
 * clicks are always tracked platform-side regardless of mode.
 */

export type ConnectionMode = "store" | "website" | "whatsapp";

export type VerdictSignal = "roas" | "cpci";

/** Which rung of the verdict hierarchy this mode can feed. */
export function verdictSignalForMode(mode: ConnectionMode): VerdictSignal {
  return mode === "store" ? "roas" : "cpci";
}

/**
 * Meta action types that count as a conversion intent for this mode.
 * Subset of insights.ts INTENT_ACTIONS: judge each business on the intent
 * its door actually produces, not on someone else's funnel.
 */
export function intentActionsForMode(mode: ConnectionMode): string[] {
  switch (mode) {
    case "whatsapp":
      return [
        "onsite_conversion.messaging_conversation_started_7d",
        "onsite_conversion.total_messaging_connection",
      ];
    case "website":
      return ["link_click", "landing_page_view", "lead"];
    case "store":
      return ["link_click", "landing_page_view", "lead"]; // intents still tracked; ROAS decides
  }
}

const PHONE_DIGITS = /^[0-9]{7,15}$/;

/**
 * Normalise a phone number into wa.me digits.
 * Accepts local formats with spaces/dashes/parentheses and a leading + or 00.
 * A leading single 0 (local format) requires a country code to replace it.
 */
export function normalizeWhatsappPhone(raw: string, countryCode?: string): string {
  let s = (raw ?? "").replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  const cc = (countryCode ?? "").replace(/[^0-9]/g, "");
  if (s.startsWith("0") && cc) s = cc + s.slice(1);
  if (!PHONE_DIGITS.test(s)) {
    throw new Error(`invalid WhatsApp phone: ${raw}`);
  }
  return s;
}

/**
 * The real destination an ad's smart link redirects to for this business.
 * - store/website: their URL, https enforced.
 * - whatsapp: a wa.me deep link, optionally pre-filling the first message so
 *   the seller knows the buyer came from the ad.
 */
export function destinationUrl(
  mode: ConnectionMode,
  value: string,
  opts?: { countryCode?: string; prefillText?: string },
): string {
  if (mode === "whatsapp") {
    const digits = normalizeWhatsappPhone(value, opts?.countryCode);
    const url = new URL(`https://wa.me/${digits}`);
    if (opts?.prefillText) url.searchParams.set("text", opts.prefillText);
    return url.toString();
  }
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new Error("destination URL required");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme); // throws on structural garbage
  url.protocol = "https:";
  // URL parsing is lenient; require a plausible public hostname (letters/
  // digits/hyphens with at least one dot) so ad clicks never point nowhere.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(url.hostname)) {
    throw new Error(`invalid destination hostname: ${url.hostname}`);
  }
  return url.toString();
}

/**
 * Plain-language tracking explanation for onboarding + agent commentary.
 * The customer should always understand what "working" means for THEIR setup.
 */
export function trackingPlanForMode(mode: ConnectionMode): string {
  switch (mode) {
    case "store":
      return "Your store is connected, so I can see actual sales from each ad and spend more on the ads that make you money.";
    case "website":
      return "Every ad links through my tracked link to your website, so I can see exactly which ads send people to you and back the ones that send the most.";
    case "whatsapp":
      return "Every ad opens a WhatsApp chat with you directly. I count started conversations per ad and back the ads that start the most chats.";
  }
}
