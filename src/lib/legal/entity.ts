/**
 * Who operates Glocal, in one place.
 *
 * The legal text used to carry this inline, and it went wrong the way
 * duplicated facts always go wrong: /privacy named a domain nobody owns and
 * published a personal Gmail address, and there was no second page to disagree
 * with it because /terms did not exist. Both pages now read from here, so the
 * day the registration or the domain changes there is one edit, not a hunt
 * through prose.
 *
 * SITE_DOMAIN and CONTACT_EMAIL are deliberately empty. Until the domain is
 * bought, a policy that names one is making a claim about a site we do not
 * control, and reviewers do check. Both pages are written to read correctly
 * with both blank.
 *
 * BEFORE AD-PLATFORM OR PAYMENT REVIEW: set CONTACT_EMAIL. The NDPA 2023
 * expects a route for a data-subject request, and with this blank the only
 * route is the signed-in account — which answers deletion but not a request
 * from someone who cannot sign in. It is a one-line change, and it is the one
 * thing on these pages that is not finished.
 */

/** The company that operates Glocal, and the data controller under the NDPA. */
export const OPERATOR = "UBAHGRID SERVICE LTD";

/** Its CAC registration number. */
export const OPERATOR_RC = "8566798";

/** Empty until the domain is bought. No page may invent one. */
export const SITE_DOMAIN = "";

/** Empty by decision. See the note above before launch. */
export const CONTACT_EMAIL = "";

/**
 * Shown as "Last updated" on both legal pages.
 *
 * Hardcoded rather than derived from the build date: a legal page that
 * re-dates itself on every deploy tells a customer their terms changed when
 * they did not, and destroys the one signal the date exists to give.
 */
export const LAST_UPDATED = "7 November 2026";

/** The courts named in the terms. Lagos because that is where the market is. */
export const JURISDICTION = "the courts of Lagos State, Nigeria";

/**
 * How a customer reaches us about their data.
 *
 * While CONTACT_EMAIL is empty this names the route we actually have rather
 * than rendering a dangling "Contact: ." — a visible placeholder reads worse
 * to a reviewer than an honest description of a narrower route.
 *
 * It names deletion specifically and claims nothing else, because deletion is
 * the only right a customer can exercise unaided today: the settings page has
 * DeleteAccountCard and there is no data-export route. Promising an export
 * that does not exist would be the exact failure this file was made to stop.
 */
export function contactSentence(): string {
  if (CONTACT_EMAIL) return `Write to us at ${CONTACT_EMAIL}.`;
  return "Sign in and open your account settings, where you can delete your account and the data it holds.";
}

/** How the operator is named in a sentence: company plus RC number. */
export function operatorLine(): string {
  return `${OPERATOR} (RC ${OPERATOR_RC})`;
}
