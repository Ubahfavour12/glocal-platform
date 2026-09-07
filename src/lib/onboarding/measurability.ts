/**
 * What each door can actually measure, and what the owner has to do about it.
 *
 * The door (where an ad's one tap lands) decides what evidence ever reaches
 * us. Asking someone to pick a goal the door cannot report on is how you get a
 * week of spend and a report full of dashes, so the goal screen is built from
 * the door rather than validated against it afterwards.
 *
 * Three outcomes, and the difference between the last two is the whole point:
 *
 *   auto           the platform reports it. Nothing to do.
 *   self_reported  we cannot see it, but the owner can tell us, and once they
 *                  tell us enough times the agent judges on money instead of
 *                  taps. This is a real path to the best signal there is, not
 *                  a downgrade.
 *   impossible     the evidence cannot exist through this door. Offering it
 *                  would be a lie, so the option is closed and says why.
 *
 * "Sales without a store" is the case worth understanding. We cannot see the
 * order, but the mark-as-sold flow already exists: each evening the owner is
 * shown yesterday's ads and taps the one that brought the buyer. After
 * MIN_ATTRIBUTED_ORDERS sales across MIN_ACTIVE_DAYS days the consistency gate
 * opens and the duel starts being judged on revenue. A WhatsApp seller with no
 * website reaches the same verdict quality as a Shopify store; it just costs
 * them a tap a day to get there.
 */

import { MIN_ACTIVE_DAYS, MIN_ATTRIBUTED_ORDERS } from "@/lib/tracking/consistency";
import type { Door, Goal } from "./inference";

export type Measurement = "auto" | "needs_setup" | "self_reported" | "impossible";

export interface GoalOption {
  goal: Goal;
  label: string;
  /** What the goal means, in the owner's language. */
  hint: string;
  measurement: Measurement;
  /** Why it is closed, or what it will ask of them. Null when it just works. */
  note: string | null;
  /** Short badge for the chip, e.g. "you confirm sales". */
  badge: string | null;
}

const LABELS: Record<Goal, { label: string; hint: string }> = {
  whatsapp: {
    label: "WhatsApp conversations",
    hint: "Counts people who start a chat. I see the chat open, not whether they buy.",
  },
  sales: {
    label: "Sales",
    hint: "Counts money. Fewer, worth more each, and I need to be told which ad earned it.",
  },
  leads: { label: "Leads", hint: "A name or a number to follow up. Not yet a buyer." },
  visits: { label: "Shop visits", hint: "Footfall through your actual door." },
};

/** The evening ask that turns self-reported sales into a revenue verdict. */
const SELF_REPORT_PROMISE =
  `Each evening I show you yesterday's ads and you tap the one that brought the buyer. ` +
  `After ${MIN_ATTRIBUTED_ORDERS} sales across ${MIN_ACTIVE_DAYS} days I stop judging on taps and start judging on money, ` +
  `which is the strongest signal there is.`;

/** Pure: how a goal can be measured through a given door. */
export function measurementFor(
  goal: Goal,
  door: Door,
): { measurement: Measurement; note: string | null; badge: string | null } {
  // A conversation only exists if the tap opens one.
  if (goal === "whatsapp") {
    return door === "whatsapp"
      ? { measurement: "auto", note: null, badge: "counted for you" }
      : {
          measurement: "impossible",
          note: "Your ads open a page, not a chat, so there is no conversation for me to count. Change the door to your WhatsApp if this is what matters.",
          badge: "needs a WhatsApp door",
        };
  }

  // Every door produces a first response we can see: a chat, a click, a visit.
  if (goal === "leads") {
    return {
      measurement: "auto",
      note:
        door === "whatsapp"
          ? "Every chat your ads start is a lead, and Meta reports each one."
          : "Every tap through to you is reported, so I can see which ads bring people.",
      badge: "counted for you",
    };
  }

  if (goal === "sales") {
    if (door === "store") {
      return {
        measurement: "auto",
        note: "Your store tells me the real order value, so I optimise for money from day one. Nothing for you to do.",
        badge: "counted for you",
      };
    }
    // A website can report its own orders, but only once our snippet is on the
    // checkout. That is a one-off job someone can do for them, so it is a step
    // to take rather than a limit to live with, and the wording has to say so.
    if (door === "link") {
      return {
        measurement: "needs_setup",
        note:
          "Paste one line of my code on your site and every order reports itself, values included, exactly like a store. " +
          "Until it is in, you can confirm sales by hand and I will use those instead.",
        badge: "add one line of code",
      };
    }
    return {
      measurement: "self_reported",
      note: "I can see the chats, but not who paid. " + SELF_REPORT_PROMISE,
      badge: "you confirm sales",
    };
  }

  // Visits mean two different things, and the door decides which one.
  if (door === "store") {
    return {
      measurement: "auto",
      note: "Your store reports every visit your ads send it, so I can see who arrived and who bought.",
      badge: "counted for you",
    };
  }
  if (door === "link") {
    return {
      measurement: "needs_setup",
      note:
        "With my code on your site I count every visit an ad sends you. " +
        "Walk-ins to a physical shop are the part nobody can count, so log those the way you log a sale.",
      badge: "add one line of code",
    };
  }
  // Footfall behind a chat: no ad platform on earth reports who walked in.
  return {
    measurement: "self_reported",
    note:
      "No ad platform can tell me who walked into your shop, so nobody can promise you this automatically. " +
      "I optimise for the chats your ads start, and when a walk-in buys, log it the same way. " +
      "That is what turns footfall into something I can actually learn from.",
    badge: "you confirm visits",
  };
}

/** The goal list for a door, best-measured first, impossible ones last. */
export function goalOptionsFor(door: Door): GoalOption[] {
  const order: Measurement[] = ["auto", "needs_setup", "self_reported", "impossible"];
  return (Object.keys(LABELS) as Goal[])
    .map((goal) => ({ goal, ...LABELS[goal], ...measurementFor(goal, door) }))
    .sort((a, b) => order.indexOf(a.measurement) - order.indexOf(b.measurement));
}

/**
 * The goal to pre-select for a door: the strongest thing it measures on its
 * own, so the default is never one that asks the owner for daily work.
 */
export function defaultGoalFor(door: Door): Goal {
  if (door === "store") return "sales";
  if (door === "whatsapp") return "whatsapp";
  return "leads";
}

/** Pure: is this pairing something we should refuse to launch? */
export function isImpossible(goal: Goal, door: Door): boolean {
  return measurementFor(goal, door).measurement === "impossible";
}
