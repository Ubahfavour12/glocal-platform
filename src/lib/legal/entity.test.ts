import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL,
  JURISDICTION,
  LAST_UPDATED,
  OPERATOR,
  OPERATOR_RC,
  SITE_DOMAIN,
  contactSentence,
  operatorLine,
} from "./entity";

/**
 * These tests guard the legal pages against the way v1 of the privacy policy
 * went wrong: facts written into prose, which then aged without anyone
 * noticing. A test is the only thing that notices.
 *
 * The page files are read as TEXT rather than rendered. Rendering would prove
 * what React produced; reading the source proves nobody typed a domain or an
 * address in by hand, which is the failure being guarded.
 */

const page = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../app/${relative}`, import.meta.url)), "utf8");

const PRIVACY = page("privacy/page.tsx");
const TERMS = page("terms/page.tsx");

/**
 * Prose in JSX is wrapped by the formatter, so a sentence in the source is
 * broken by newlines and indentation at points nobody chose. Matching against
 * the raw text would make these assertions fail on a reformat rather than on a
 * change of meaning, which is the opposite of what they are for.
 */
const flat = (src: string) => src.replace(/\s+/g, " ");
const PRIVACY_TEXT = flat(PRIVACY);
const TERMS_TEXT = flat(TERMS);
const PAGES: [string, string][] = [
  ["privacy", PRIVACY],
  ["terms", TERMS],
];

describe("legal pages carry no hardcoded identity", () => {
  it.each(PAGES)("%s names no domain", (_name, src) => {
    // v1 claimed glocal.ai, which is not ours. A policy that names a site we
    // do not control is a claim a reviewer can check and we would fail.
    expect(src).not.toMatch(/glocal\.(ai|com|ng|io)/i);
  });

  it.each(PAGES)("%s publishes no personal mailbox", (_name, src) => {
    expect(src).not.toMatch(/@gmail\.com/i);
    expect(src).not.toMatch(/@(yahoo|hotmail|outlook|icloud)\./i);
  });

  it.each(PAGES)("%s contains no email address at all while CONTACT_EMAIL is empty", (_name, src) => {
    // Any address in the source is one that did not come from entity.ts.
    // Scoped to the rendered strings rather than imports, which contain none.
    const addresses = src.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    const unexpected = addresses.filter((a) => a !== CONTACT_EMAIL);
    expect(unexpected).toEqual([]);
  });

  it.each(PAGES)("%s takes the operator from entity.ts, not from prose", (_name, src) => {
    // The company name must appear only via operatorLine(). If someone types
    // "UBAHGRID SERVICE LTD" into the JSX, the two pages can disagree, and the
    // one a customer points at will be whichever we forgot.
    expect(src).not.toContain(OPERATOR);
    expect(src).not.toContain(OPERATOR_RC);
    expect(src).toContain("operatorLine()");
  });

  it.each(PAGES)("%s shows a last-updated date from entity.ts", (_name, src) => {
    expect(src).toContain("LAST_UPDATED");
  });
});

describe("the two pages agree with each other", () => {
  it("both name the NDPA rather than the GDPR", () => {
    // The operating company and its customers are Nigerian. v1 cited the GDPR,
    // and the erasure route cited UK tax law, neither of which binds this
    // business.
    expect(PRIVACY).toMatch(/Nigeria Data Protection/);
    expect(PRIVACY).not.toMatch(/\bGDPR\b/);
    expect(TERMS).not.toMatch(/\bGDPR\b/);
  });

  it("both promise the same thing about an unspent balance", () => {
    // /privacy promises refunds on closure; /terms has to say the same, and
    // both have to carry the withdraw-before-you-close warning, because an
    // erased account cannot be identified as the owner of a balance.
    expect(PRIVACY_TEXT).toMatch(/[Ww]ithdraw before you close/);
    expect(TERMS_TEXT).toMatch(/[Ww]ithdraw before you close/);
  });

  it("the terms disclaim the results the marketing copy implies", () => {
    expect(TERMS_TEXT).toMatch(
      /Nothing in Glocal is a guarantee that your advertising will work/i,
    );
  });

  it("the terms state that the agent spends money on its own", () => {
    // The single most important disclosure on the page: this is a product that
    // moves a customer's money without asking each time.
    expect(TERMS_TEXT).toMatch(/Glocal acts on its own/);
    expect(TERMS_TEXT).toMatch(/without asking you first/);
  });

  it("the terms price the markup from the billing code, not from prose", () => {
    // A hardcoded "18%" would drift the first time a tier was repriced.
    expect(TERMS).toContain("subscriptionConfigForTier");
    expect(TERMS).not.toMatch(/\b1[2-8]% on ad spend/);
  });
});

describe("entity", () => {
  it("names the operator with its RC number", () => {
    expect(operatorLine()).toBe("UBAHGRID SERVICE LTD (RC 8566798)");
  });

  it("keeps the domain blank until there is one", () => {
    expect(SITE_DOMAIN).toBe("");
  });

  it("falls back to the route that actually exists when there is no address", () => {
    // Deletion is self-service in settings; export is not. The fallback must
    // promise only the former.
    expect(CONTACT_EMAIL).toBe("");
    expect(contactSentence()).toMatch(/account settings/);
    expect(contactSentence()).toMatch(/delete/);
    expect(contactSentence()).not.toMatch(/export|copy of your data/i);
  });

  it("names a jurisdiction, since a contract without one is argued twice", () => {
    expect(JURISDICTION).toMatch(/Nigeria/);
    expect(LAST_UPDATED).toMatch(/\d{4}$/);
  });
});
