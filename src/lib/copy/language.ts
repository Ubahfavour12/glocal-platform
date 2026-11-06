/**
 * What language an ad is written in.
 *
 * WHY THIS EXISTS. Every ad this product has ever written was in English,
 * because the concept prompt never mentioned language and the model defaults to
 * the language it was asked in. For a platform whose market is Nigerian SMBs
 * that is a silent, large mistake: a trader in Kano advertising to Kano
 * customers in textbook English is advertising in a register their customers do
 * not use, and the ad reads like it came from outside.
 *
 * The change is small — a paragraph in a prompt and a column — and the effect is
 * plausibly large. That asymmetry is the whole argument for doing it now.
 *
 * WHAT THIS IS NOT. It is not app i18n. The dashboard stays in English; this is
 * only the language of the ad copy the agent writes for the customer's
 * audience. Those are different problems and conflating them would mean
 * translating a hundred UI strings to fix an advertising defect.
 *
 * Pure and fixture-tested: no model call, no database, so the directive text can
 * be reviewed and regression-tested like any other logic.
 */

/**
 * Nigeria's four widest advertising languages plus English.
 *
 * Deliberately a closed set rather than free text. A free-text language field
 * would let a typo ("Yorùbá ", "pidgeon") silently become an instruction the
 * model half-follows, and an ad is not a place to find out. Adding a language
 * should be a considered change with a directive written for it, which is
 * exactly what this list forces.
 */
export const AD_LANGUAGES = ["english", "pidgin", "hausa", "yoruba", "igbo"] as const;

export type AdLanguage = (typeof AD_LANGUAGES)[number];

export const DEFAULT_AD_LANGUAGE: AdLanguage = "english";

/** Pure: normalise a stored or submitted value. Anything unknown is English. */
export function asAdLanguage(raw: string | null | undefined): AdLanguage {
  const v = (raw ?? "").trim().toLowerCase();
  return (AD_LANGUAGES as readonly string[]).includes(v) ? (v as AdLanguage) : DEFAULT_AD_LANGUAGE;
}

/** Human label for the settings UI. */
export function languageLabel(lang: AdLanguage): string {
  switch (lang) {
    case "english":
      return "English";
    case "pidgin":
      return "Nigerian Pidgin";
    case "hausa":
      return "Hausa";
    case "yoruba":
      return "Yoruba";
    case "igbo":
      return "Igbo";
  }
}

/**
 * Rules that apply whatever the language, and that matter more than the
 * language choice itself.
 *
 * The failure mode for a non-English ad is not bad grammar — it is a model
 * writing what it imagines the language sounds like. That reads as mockery to a
 * native speaker and will cost the customer more than an English ad would have.
 * So the directive names the register, forbids caricature, and pins the things
 * that must NOT be translated: a brand name translated into Yoruba is no longer
 * the brand, and a translated price is a misprice.
 */
const SHARED_RULES = [
  "Write as a fluent native speaker advertising to their own community, not as someone translating from English.",
  "Never caricature the language or spell it phonetically for comic effect. A native speaker must read it as normal, confident advertising.",
  "Keep these EXACTLY as given, never translated and never transliterated: the business name, product names, and any brand names.",
  "Keep prices, phone numbers, quantities and dates as digits in their original form.",
  "The call to action must be the phrasing a real trader in this language would use, not a literal translation of an English CTA.",
].join("\n- ");

/**
 * The language instruction appended to the concept prompt.
 *
 * Returns "" for English so the English path is byte-identical to what it was
 * before this module existed. That keeps the default behaviour unchanged and
 * the prompt cache prefix stable for the majority of accounts.
 */
export function languageDirective(lang: AdLanguage): string {
  if (lang === "english") return "";
  return `\nLANGUAGE\nWrite the hook, copyAngle and cta in ${LANGUAGE_BRIEF[lang]}\n- ${SHARED_RULES}\n\nThe storyboard and sourcePattern stay in English: they are production notes for the team, not customer-facing copy.\n`;
}

/**
 * How to write each language, in one line.
 *
 * Each names the real-world register rather than the language in the abstract,
 * because "write in Hausa" and "write the way a Kano trader sells" produce
 * different ads and only one of them is worth running.
 */
const LANGUAGE_BRIEF: Record<Exclude<AdLanguage, "english">, string> = {
  pidgin:
    "Nigerian Pidgin as actually spoken in Lagos markets and on Nigerian radio. Natural English code-switching is correct and expected; forcing every word into Pidgin is not.",
  hausa:
    "Hausa as spoken and advertised in northern Nigeria, in the everyday register a Kano market trader would use with a customer.",
  yoruba:
    "Yoruba as spoken in southwest Nigeria. Light code-switching with English is normal in Lagos advertising and is fine where it reads naturally. Use tone marks only where their absence would change the meaning.",
  igbo:
    "Igbo as spoken in southeast Nigeria, in the everyday trading register rather than formal or literary Igbo.",
};

/**
 * Whether a verdict between two ads is comparing like with like.
 *
 * Language is a creative variable like any other, so an English ad beating a
 * Pidgin one tells you about the language as much as the hook — which is useful
 * to know and dangerous to read as "this hook won". The duel does not control
 * for it, so callers that mix languages should say so rather than report a
 * clean result.
 */
export function sameLanguage(langs: readonly AdLanguage[]): boolean {
  return langs.length < 2 || langs.every((l) => l === langs[0]);
}
