/**
 * Which half-finished signup to resume from.
 *
 * There are now two copies of a draft and they can disagree. The browser's is
 * instant and works before the session resolves; the account's survives
 * changing device, which is the whole point of adding it -- someone starts in
 * the shop on a phone and finishes at home on a laptop, and until now that
 * person began again from the first screen.
 *
 * Disagreement is normal rather than exceptional: fill two screens on a phone
 * offline, then open the laptop, and the local copy is genuinely ahead. So the
 * rule is the newest wins, not "the server is authoritative".
 *
 * Pure, because the alternative is reasoning about this inside an effect that
 * also talks to Supabase and localStorage.
 */

export interface DraftLike {
  /** Whose run this is. Null in demo mode, where there is no account. */
  ownerId: string | null;
  /** ISO timestamp of the last edit. */
  savedAt: string;
}

export interface DraftChoice<T> {
  /** The draft to restore, or null to start fresh. */
  draft: T | null;
  /**
   * True when the browser's copy belonged to somebody else and must be
   * deleted rather than merely ignored.
   */
  dropLocal: boolean;
}

/** Milliseconds, or -Infinity for a missing or unparseable stamp. */
function stamp(d: DraftLike | null): number {
  if (!d) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(d.savedAt);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Choose between the browser's draft and the account's.
 *
 * THE SECURITY RULE COMES FIRST. localStorage is per-browser, not per-account:
 * on a shared machine someone can abandon a signup and the next person, signing
 * in as themselves, would be handed the first person's business name, phone
 * number and budget. A local draft stamped with a different owner is dropped,
 * never merely passed over -- leaving it on disk means the next sign-in finds
 * it again.
 *
 * The remote draft needs no such check: row-level security only ever returns
 * the signed-in user's own row.
 */
export function pickDraft<T extends DraftLike>(
  local: T | null,
  remote: T | null,
  signedInAs: string | null,
): DraftChoice<T> {
  // Someone else's draft, sitting in this browser.
  const foreign = Boolean(local && local.ownerId && signedInAs && local.ownerId !== signedInAs);
  const usableLocal = foreign ? null : local;

  if (!usableLocal && !remote) return { draft: null, dropLocal: foreign };
  if (!usableLocal) return { draft: remote, dropLocal: foreign };
  if (!remote) return { draft: usableLocal, dropLocal: foreign };

  // Ties go to the account's copy: if both were written in the same
  // millisecond the remote one is the copy that will still exist tomorrow.
  return { draft: stamp(usableLocal) > stamp(remote) ? usableLocal : remote, dropLocal: foreign };
}
