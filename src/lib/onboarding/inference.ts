/**
 * What onboarding can work out on its own, and what it must genuinely ask.
 *
 * The design review pushed back on three things in the required list, and all
 * three are decided here rather than in the screen, so they can be tested
 * without a browser:
 *
 *  1. Country was a dropdown. The phone's timezone and the dialling code on
 *     their WhatsApp number already answer it. Asking costs a field on the
 *     first screen, which is exactly where people abandon.
 *  2. Category was free text. It drives the niche research, so a typo costs
 *     real creative quality. A chip list of trades removes the keyboard and
 *     the typo at once.
 *  3. Nothing asked who the person is to the business. It decides who gets the
 *     evening approval, so it is the one field genuinely missing.
 */

import { viableChallengerCount } from "@/lib/guardrails/budget";
import type { PersonaMode } from "@/lib/guardrails/budget";
import { currencyForCountry, listCountries } from "@/lib/money/currency";

/* ---------------------------------------------------------------- country */

/**
 * Timezone to country, for the markets we serve.
 *
 * Timezone beats language: plenty of Lagos phones report `en-US` because that
 * is what shipped on them, but almost none report a New York timezone.
 */
const COUNTRY_BY_TIMEZONE: Record<string, string> = {
  "Africa/Lagos": "NG",
  "Africa/Accra": "GH",
  "Africa/Nairobi": "KE",
  "Africa/Johannesburg": "ZA",
  "Africa/Kampala": "UG",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Cairo": "EG",
  "Europe/London": "GB",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "Asia/Dubai": "AE",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
};

/** Countries we can display a local currency for. */
const KNOWN = new Set(listCountries().map((c) => c.country));

/** The first market, used only when nothing at all can be read. */
export const FALLBACK_COUNTRY = "NG";

export interface CountrySignals {
  /** e.g. "Africa/Lagos", from Intl.DateTimeFormat().resolvedOptions(). */
  timeZone?: string | null;
  /** e.g. "en-NG", from navigator.language. */
  locale?: string | null;
  /** Whatever they typed as a WhatsApp number, dialling code and all. */
  phone?: string | null;
}

/** Pure: the region subtag of a BCP-47 tag, when it names a country. */
export function countryFromLocale(locale: string | null | undefined): string | null {
  const parts = (locale ?? "").split(/[-_]/);
  // Region is the first two-letter subtag after the language, e.g. en-NG.
  for (const part of parts.slice(1)) {
    const up = part.toUpperCase();
    if (/^[A-Z]{2}$/.test(up) && KNOWN.has(up)) return up;
  }
  return null;
}

/**
 * Pure: the country a typed phone number belongs to, by dialling code.
 *
 * Longest code first so +234 is never read as +2, and codes that several
 * countries share (+1) are left undecided rather than guessed wrong.
 */
export function countryFromPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  if (!digits.startsWith("+")) return null;

  const byCode = new Map<string, string[]>();
  for (const c of listCountries()) {
    if (c.dialCode.length < 2) continue; // "+" alone (Eurozone) names no country
    byCode.set(c.dialCode, [...(byCode.get(c.dialCode) ?? []), c.country]);
  }

  const codes = [...byCode.keys()].sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (!digits.startsWith(code)) continue;
    const owners = byCode.get(code) ?? [];
    // Shared codes (US and CA both +1) tell us nothing on their own.
    return owners.length === 1 ? owners[0] : null;
  }
  return null;
}

/**
 * Work out their country without asking.
 *
 * The number they typed wins: it is a deliberate act, where the timezone is
 * just where the handset happens to be. Returns the fallback market only when
 * every signal is silent, and the screen still shows the answer so they can
 * correct it in one tap.
 */
export function inferCountry(signals: CountrySignals): string {
  return (
    countryFromPhone(signals.phone) ??
    COUNTRY_BY_TIMEZONE[(signals.timeZone ?? "").trim()] ??
    countryFromLocale(signals.locale) ??
    FALLBACK_COUNTRY
  );
}

/** Read the browser's signals. Safe on the server, where it returns nothing. */
export function readCountrySignals(): CountrySignals {
  if (typeof window === "undefined") return {};
  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // Some older Android WebViews throw here rather than returning undefined.
  }
  return { timeZone, locale: navigator.language ?? null };
}

/* --------------------------------------------------------------- category */

/**
 * The trades, as a chip list.
 *
 * Eight plus an escape hatch: enough to cover the market we sell to without a
 * scroll, and the labels are what an owner would call their own shop rather
 * than what a marketer would call the vertical.
 */
export const TRADES = [
  "Clothes & fashion",
  "Food & drink",
  "Wine & spirits",
  "Phones & electronics",
  "Beauty & skincare",
  "Home & furniture",
  "Services",
  "Something else",
] as const;

export type Trade = (typeof TRADES)[number];

/** The one chip that still needs a keyboard, because it has to. */
export const OTHER_TRADE: Trade = "Something else";

/* ------------------------------------------------------------- who they are */

export type OwnerRole = "owner" | "staff";

export const OWNER_ROLES: { id: OwnerRole; label: string; hint: string }[] = [
  { id: "owner", label: "I own it", hint: "The evening approval comes to you." },
  {
    id: "staff",
    label: "I work here",
    hint: "You set up and run the ads. Approval can go to the owner instead.",
  },
];

/* ------------------------------------------------------- goal vs the door */

export type Door = "whatsapp" | "link" | "store";
export type Goal = "sales" | "leads" | "whatsapp" | "visits";

/**
 * Pure: whether the thing they want to count can be counted through the door
 * they chose.
 *
 * Said on the goal screen rather than discovered a week later, when the answer
 * is a report full of dashes and a week of spend with nothing to show.
 */
export function goalDoorMismatch(goal: Goal, door: Door): string | null {
  if (goal === "visits") {
    return door === "whatsapp"
      ? "You picked shop visits, but the ads point at a WhatsApp number. I can't count someone walking through your door. I'd either send them to WhatsApp and count conversations, or point the door at your maps listing."
      : "I can point ads at your shop, but no ad platform can tell me who actually arrived. I'll judge these on taps, and you'll have to tell me what turned into a sale.";
  }
  if (goal === "sales" && door !== "store") {
    return door === "whatsapp"
      ? "Sales through WhatsApp only count when you tell me they happened. I'll ask you each evening which ad brought the buyer. If you'd rather it was automatic, connect a store instead."
      : "I can see taps on your link, but not orders, unless you connect a store or log sales yourself. Until then I'll judge on taps and ask you about the money.";
  }
  if (goal === "whatsapp" && door !== "whatsapp") {
    return "You want conversations, but the ads don't open one. Point the door at your WhatsApp and every tap becomes a chat I can count.";
  }
  return null;
}

/* ----------------------------------------------------------------- budget */

/**
 * What this budget actually buys, in the agent's own voice.
 *
 * Derived from the real duel maths rather than written thresholds, so it stays
 * true if the persona shares ever move. At $10 a day the honest answer is one
 * challenger, not two: two would starve each other and never reach a verdict.
 */
export function budgetAdvice(dailyUsdMinor: number, persona: PersonaMode = "smart"): string {
  const daily = `$${Math.round(dailyUsdMinor / 100)}`;
  const plan = viableChallengerCount(dailyUsdMinor, persona);

  // Below the floor the guardrail already explains itself; use its words.
  if (plan.count === 0) return plan.note ?? "";
  if (plan.count === 1) {
    return `At ${daily} a day I run one challenger against your champion instead of two, so it gets enough spend to actually prove itself. Two would starve each other and I'd never reach a verdict.`;
  }
  if (dailyUsdMinor < 4_500) {
    return `At ${daily} a day I can run two challengers and still fund each one properly. This is where the daily test works as designed.`;
  }
  return `At ${daily} a day I can test two challengers hard and reach a verdict most days. More than this mostly buys speed, not certainty.`;
}

/** The local-currency line shown under a USD figure. */
export function localAside(usdMinor: number, country: string, rate: number): string {
  const c = currencyForCountry(country);
  if (c.currency === "USD") return "";
  return `≈ ${c.symbol}${Math.ceil((usdMinor * rate) / 100).toLocaleString()}`;
}
