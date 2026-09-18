/**
 * When to ask, and how hard.
 *
 * The answers only exist in the owner's head, so the whole feature lives or
 * dies on whether they actually tap the buttons. Two failure modes, pulling in
 * opposite directions: ask too rarely and a month of leads piles into a chore
 * nobody starts; ask too often and it becomes noise they learn to dismiss,
 * which is worse because dismissal is a habit.
 *
 * Four days is the interval. It is short enough that a WhatsApp conversation
 * is still recognisable — "Ada ••7391" means nothing three weeks later — and
 * long enough that the list is worth opening. It is also not weekly, which
 * would tie the prompt to a particular day and make it the thing you skip when
 * that day is busy.
 *
 * None of this gates the page. Anyone can open leads and answer whenever they
 * like; this only decides whether Glocal brings it up.
 */

export const NUDGE_INTERVAL_DAYS = 4;

/** Leads go stale as memories, not as data. */
export const STALE_AFTER_DAYS = 21;

export interface NudgeInput {
  /** Leads with no outcome yet. */
  openCount: number;
  /** The oldest open lead, or null when there are none. */
  oldestOpenAt: Date | null;
  /** When the owner last settled anything, or null if never. */
  lastAnsweredAt: Date | null;
  now: Date;
}

export type Nudge =
  | { show: false }
  | { show: true; tone: "normal" | "stale"; openCount: number; oldestDays: number };

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Should Glocal bring up the leads?
 *
 * Silence when there is nothing to answer — an empty prompt teaches people the
 * prompt is noise, and then the one that matters gets dismissed too.
 *
 * The first ever lead prompts immediately rather than waiting out the interval.
 * Someone who has never done this needs to be shown what the question is, and a
 * four-day silence after their first lead arrives reads as nothing happening.
 */
export function shouldNudge(input: NudgeInput): Nudge {
  if (input.openCount <= 0) return { show: false };

  const oldestDays =
    input.oldestOpenAt === null ? 0 : Math.max(0, daysBetween(input.oldestOpenAt, input.now));

  // Never answered anything: show it now, whatever the interval says.
  if (input.lastAnsweredAt === null) {
    return {
      show: true,
      tone: oldestDays >= STALE_AFTER_DAYS ? "stale" : "normal",
      openCount: input.openCount,
      oldestDays,
    };
  }

  const sinceAnswered = daysBetween(input.lastAnsweredAt, input.now);
  if (sinceAnswered < NUDGE_INTERVAL_DAYS) return { show: false };

  return {
    show: true,
    // Past three weeks the honest framing changes: this is no longer "please
    // answer", it is "answer while you can still remember". Saying so is more
    // use than a louder version of the same request.
    tone: oldestDays >= STALE_AFTER_DAYS ? "stale" : "normal",
    openCount: input.openCount,
    oldestDays,
  };
}

/** The sentence itself. Plain, specific, and never guilt-tripping. */
export function nudgeMessage(nudge: Nudge): string | null {
  if (!nudge.show) return null;
  const n = nudge.openCount;
  const plural = n === 1 ? "lead" : "leads";
  if (nudge.tone === "stale") {
    return `${n} ${plural} still unanswered, the oldest from ${nudge.oldestDays} days ago. Worth doing now while you can still place them.`;
  }
  return `${n} ${plural} waiting. Which turned into business?`;
}
