import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No screen may hardcode one country's money.
 *
 * Three places did, while the architecture around them was already correct:
 * `currencyForCountry`, `pspChargeCurrency` and `chargesInLocalCurrency` all
 * resolve the right answer per country, and three files ignored them.
 *
 *   - the wallet's FX card fetched the NGN rate and printed a naira sign for
 *     everybody, on a page that did not even select the business's country
 *   - the Add Funds button was labelled "Pay with card (naira)" whoever paid
 *   - onboarding multiplied by a hardcoded 1545 and printed the customer's OWN
 *     symbol, so a Kenyan read "KSh 38,625" for a $25/day budget against a
 *     true figure near 3,200
 *
 * The third is not a cosmetic slip. It is a wrong number, shown at the moment
 * a shop owner decides what they can afford.
 *
 * SCOPED TO WHAT PEOPLE SEE -- src/app and src/components. A first attempt
 * swept the whole tree and flagged six test files that assert on symbols by
 * design, plus `compliance/gateway.ts`, whose regex DETECTS "earn N500,000 a
 * month" in ad copy. Those are not this bug, and a guard that cries about them
 * is a guard somebody deletes.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

/** Symbols naming ONE country's money. "$" is excluded: USD is canonical here. */
const LOCAL_SYMBOLS = /[₦₵₹£€]/;

/** The symbol table itself has to spell them out; it is the single source. */
const ALLOWED = new Set([join(SRC, "components", "wallet", "AddFundsButton.tsx")]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments explaining the bug are not the bug. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("what customers see is in their own currency", () => {
  const files = [join(SRC, "app"), join(SRC, "components")]
    .flatMap((d) => walk(d))
    .filter((f) => !ALLOWED.has(f));

  it("no page or component spells out one country's currency symbol", () => {
    const offenders = files.filter((f) =>
      LOCAL_SYMBOLS.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });

  it("onboarding asks for a real rate rather than assuming one", () => {
    // The constant it replaces was DEMO_NGN_PER_USD_BUFFERED = 1545, behind a
    // comment calling itself temporary, for long enough to reach production.
    const onboarding = readFileSync(join(SRC, "app", "onboarding", "page.tsx"), "utf8");
    expect(onboarding).not.toMatch(/DEMO_[A-Z]*_?PER_USD/);
    expect(onboarding).toContain("/api/fx?currency=");
  });

  it("the wallet reads the business's own currency before quoting a rate", () => {
    const wallet = readFileSync(join(SRC, "app", "(app)", "wallet", "page.tsx"), "utf8");
    // It used to ask for NGN unconditionally, on a page that never selected
    // `country` or `currency` and so could not have done better.
    expect(wallet).not.toMatch(/fetchUsdRate\(\s*["']NGN["']\s*\)/);
    expect(wallet).toMatch(/currency/);
  });
});
