/**
 * When should an approved plan go live?
 *
 * The agent suggests, the customer decides. Until now every plan launched at the
 * morning cron, which quietly assumes the agent knows the best moment better
 * than the shop owner. It does not: a wine seller knows Friday evening beats
 * Tuesday morning, and that payday week is different from the rest of the month.
 *
 * Pure so the suggestion logic is testable without clocks or a database.
 */

export type LaunchChoice = "default" | "now" | "custom";

/** The default launch hour, in the customer's local time. */
export const DEFAULT_LAUNCH_HOUR = 7;

/**
 * The next default launch moment: tomorrow morning, or this morning if it has
 * not happened yet. Approving at 6am should not wait 25 hours.
 */
export function defaultLaunchAt(now: Date): Date {
  const at = new Date(now);
  at.setHours(DEFAULT_LAUNCH_HOUR, 0, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * A plain-language suggestion for when to go live.
 *
 * Deliberately simple and honest: mornings give an ad the whole day to gather
 * the impressions a verdict needs, and a plan launched late in the evening
 * spends most of its budget while people sleep. We do not pretend to know the
 * customer's trade better than they do, so this explains the reasoning rather
 * than asserting an optimum.
 */
export function launchSuggestion(now: Date): string {
  const hour = now.getHours();
  if (hour >= 21 || hour < 5) {
    return "Tomorrow morning is best. Starting now would spend most of tonight's budget while people are asleep.";
  }
  if (hour >= 17) {
    return "Tomorrow morning is best, so the ads get a full day to gather enough views for a fair test.";
  }
  return "Tomorrow morning is the safe default, but starting now gives today's ads a head start if you are ready.";
}

/** Human label for a launch moment, for the confirmation line. */
export function describeLaunchAt(at: Date, now: Date): string {
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${at.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} at ${time}`;
}

/**
 * Resolve the customer's choice into a timestamp, or null for "use the default
 * morning run". Invalid custom dates fall back to the default rather than
 * throwing: a bad date should never block an approval.
 */
export function resolveLaunchAt(
  choice: LaunchChoice,
  now: Date,
  customIso?: string,
): Date | null {
  if (choice === "now") return now;
  if (choice === "custom" && customIso) {
    const at = new Date(customIso);
    if (!Number.isNaN(at.getTime()) && at > now) return at;
  }
  return null;
}
