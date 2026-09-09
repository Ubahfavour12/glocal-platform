/**
 * Which concepts go into tomorrow's test when the customer hand-picks one.
 *
 * Tomorrow's test has a fixed number of challenger slots, and they are never
 * empty: the agent fills them by rank overnight. So "picking" is not adding to
 * a blank list, it is taking a slot from whatever is currently in it.
 *
 * The rule is fill, not replace. A second pick keeps the first and takes the
 * remaining slot; only once every slot is spoken for does a further pick push
 * the oldest out. Replacing on every pick was the old behaviour and it made
 * choosing two concepts impossible without the customer ever being told why.
 */

/**
 * The concepts to request for tomorrow, newest pick first.
 *
 * Newest first because the front of this list is what the planner honours when
 * it cannot fit everything: the customer's most recent decision should be the
 * one that survives, not the one that happens to be oldest.
 */
export function nextPickSelection(
  conceptId: string,
  plannedConceptIds: readonly string[],
  slots: number,
): string[] {
  if (!conceptId) return [...plannedConceptIds];
  const capacity = Math.max(1, Math.floor(slots));
  // De-duplicated: re-picking something already in tomorrow's test should move
  // it to the front, not occupy two slots with one concept.
  const rest = plannedConceptIds.filter((id) => id && id !== conceptId);
  return [conceptId, ...rest].slice(0, capacity);
}

/** How many slots a further pick would still leave free. */
export function slotsRemaining(plannedConceptIds: readonly string[], slots: number): number {
  const capacity = Math.max(0, Math.floor(slots));
  return Math.max(0, capacity - new Set(plannedConceptIds.filter(Boolean)).size);
}

/**
 * What to tell the customer about tomorrow's test, in their words.
 *
 * Says what is true rather than what is encouraging: when the slots are full,
 * the next pick costs something, and hiding that is how someone loses a choice
 * they had already made.
 */
export function slotSummary(
  plannedConceptIds: readonly string[],
  slots: number,
  walletEmpty = false,
): string {
  const capacity = Math.max(0, Math.floor(slots));
  // The wallet is checked first because it is the reason that is actually
  // actionable. "Your budget cannot fund a test" sends someone to change a
  // budget that was never the problem; "your wallet is empty" sends them to the
  // one screen that fixes it.
  if (walletEmpty) {
    return "Your wallet is empty, so tomorrow's test is paused. Add funds and your picks start running again.";
  }
  if (capacity === 0) return "Tomorrow's budget cannot fund a new ad to test.";
  const used = capacity - slotsRemaining(plannedConceptIds, capacity);
  const slotWord = capacity === 1 ? "slot" : "slots";
  if (used >= capacity) {
    return `Tomorrow's test is full: ${used} of ${capacity} ${slotWord} taken. Picking another swaps out the oldest.`;
  }
  return `${used} of ${capacity} ${slotWord} taken for tomorrow. ${capacity - used} still free.`;
}
