/**
 * Checking the number the ads will point at.
 *
 * This is the single most expensive field in onboarding. Every ad ends in one
 * tap, and if that tap opens a chat with nobody, the entire budget is spent
 * buying taps that go nowhere. The owner does not find out for days, and when
 * they do, it looks like the product stole from them.
 *
 * There are three different questions here and they are worth keeping apart:
 *
 *   1. Is it a real, complete number for that country?   Answerable offline.
 *   2. Is it a mobile line rather than a landline?       Answerable offline.
 *   3. Is WhatsApp actually registered on it?            NOT answerable.
 *
 * (3) needs the WhatsApp Business API, and WhatsApp deliberately refuses to
 * answer it for anyone else, because a public "is this number on WhatsApp"
 * endpoint is a phone-book enumeration tool. So we answer 1 and 2 properly
 * against the real national numbering plans, hand the owner the exact link an
 * ad would use so they can settle 3 in one tap, and never claim we checked
 * something we did not.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";
import { currencyForCountry } from "@/lib/money/currency";

export interface PhoneCheck {
  /** Canonical +234... form, the only shape that should ever be stored. */
  e164: string | null;
  /** Grouped for display, e.g. "0802 555 0117". */
  national: string | null;
  /** Country the number actually belongs to, which may not be the one asked. */
  country: string | null;
  valid: boolean;
  /** Whether the line can carry WhatsApp at all. */
  mobile: boolean;
  /** Plain-language problem in the agent's voice, or null when it is fine. */
  problem: string | null;
}

const EMPTY: PhoneCheck = {
  e164: null,
  national: null,
  country: null,
  valid: false,
  mobile: false,
  problem: null,
};

/**
 * Drop the trunk prefix people type out of habit.
 *
 * Nigerians write their number as 0802 555 0117. Sitting behind a fixed "+234"
 * that becomes +234 0802..., which is not a number at all. Silently correcting
 * it is right: the owner is not wrong, the field is.
 */
export function stripTrunkPrefix(input: string, country: string): string {
  const dial = currencyForCountry(country).dialCode.replace("+", "");
  let s = input.replace(/[^\d+]/g, "");
  s = s.replace(/^\+/, "");
  // Typed the country code as well as the prefix chip showing it.
  if (dial.length > 1 && s.startsWith(dial)) s = s.slice(dial.length);
  // Trunk "0", used across almost every plan we serve.
  s = s.replace(/^0+/, "");
  return s;
}

/**
 * Check a number against the real numbering plan for its country.
 *
 * `defaultCountry` is only a fallback: an explicitly typed +233 wins, because
 * typing a country code is a deliberate act and the field beneath it is a
 * guess we made from their timezone.
 */
export function checkWhatsApp(input: string, defaultCountry: string): PhoneCheck {
  const raw = (input ?? "").trim();
  if (raw.replace(/\D/g, "").length === 0) return EMPTY;

  const parsed = parsePhoneNumberFromString(raw, {
    defaultCountry: defaultCountry.toUpperCase() as never,
    extract: false,
  });

  if (!parsed) {
    return { ...EMPTY, problem: "I cannot read that as a phone number." };
  }

  const country = parsed.country ?? null;
  const valid = parsed.isValid();
  // Mobile metadata: a landline simply fails to validate, so a parsed-but-
  // invalid number in a country we know is usually someone's shop landline.
  const mobile = valid;

  if (!valid) {
    const digits = parsed.nationalNumber.length;
    const place = country ? currencyForCountry(country).countryName : "that country";
    return {
      e164: null,
      national: null,
      country,
      valid: false,
      mobile: false,
      problem:
        digits < 7
          ? "That is too short to be a whole number. Check for a missing digit."
          : `That is not a mobile number in ${place}. WhatsApp only runs on a mobile line, so a landline cannot be the door your ads point at.`,
    };
  }

  return {
    e164: parsed.number,
    national: parsed.formatNational(),
    country,
    valid: true,
    mobile,
    problem: null,
  };
}

/**
 * The exact link an ad will use.
 *
 * Handing this to the owner is the honest version of verification: we cannot
 * ask WhatsApp anything, but they can settle it in one tap, and what they are
 * testing is precisely what a customer will tap.
 */
export function waMeLink(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, "");
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}
