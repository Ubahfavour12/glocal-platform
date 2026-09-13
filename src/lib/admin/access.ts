/**
 * Who may open the founder console.
 *
 * This gate matters more than most. The console reads through the SERVICE ROLE,
 * which bypasses row-level security entirely — every customer's wallet, plan,
 * spend and errors, in one place. RLS protects every other page in the app by
 * construction; here it is switched off on purpose, so this function is the
 * only thing standing between a signed-in stranger and the whole book.
 *
 * Two decisions follow from that:
 *
 * 1. AN UNSET ALLOWLIST DENIES EVERYONE. The tempting default — "no allowlist
 *    configured, so let the first signed-in user in" — would mean a missing env
 *    var silently opens every customer's data to anyone who can register. A
 *    console nobody can open is a nuisance; one everybody can open is a breach.
 *
 * 2. It is an allowlist of exact addresses, not a domain or a pattern. A
 *    pattern is a thing to get subtly wrong once and never notice.
 *
 * Emails are compared case-insensitively and trimmed, because an env var gets
 * pasted by a human and Supabase stores what the identity provider sends.
 */

/** Parse `FOUNDER_EMAILS` into a set of addresses. Empty means empty. */
export function founderAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * May this email open the console?
 *
 * Returns false for an empty allowlist, an absent email, and anything not
 * listed — in that order of importance.
 */
export function isFounder(email: string | null | undefined, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return false;
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  return allowlist.has(e);
}

/** The configured allowlist, read from the environment. */
export function configuredFounders(): Set<string> {
  return founderAllowlist(process.env.FOUNDER_EMAILS);
}
