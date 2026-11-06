/**
 * Subscription tiers — the marketing surface the /upgrade page renders.
 *
 * Repriced and cut from six to four on 6 Nov 2026. The old ladder
 * (Starter $39 / Growth $99 / Scale $249) was priced for a US SaaS buyer:
 * Scale alone was roughly N370,000/month, against a market where the
 * overwhelming majority of businesses are micro. Adding Organic and Spark to
 * the old three would have made six, which is more choices than a trader wants
 * before they have seen the product work once.
 *
 * TWO RULES FOR THIS COPY, both learned the hard way here:
 *
 * 1. NO TIER CLAIMS A CAPABILITY ITS RENDER MATHS FORBIDS. Starter promised
 *    "up to 2 video renders/day" to customers who had 2 credits a day when a
 *    video costs 4 -- a promise that could never once be kept. There is a test
 *    that fails if a tier mentions video without the credits to make one.
 * 2. SAY WHAT A TIER DOES NOT DO. Spark rotates ads one at a time rather than
 *    running the daily duel, and its entry says so. A customer discovering
 *    that themselves costs more than the upgrade it might have won.
 *
 * The subscription roughly covers serving cost; the ad-spend markup is the
 * business. Markup rises as price falls because fixed serving cost is a larger
 * share of a smaller account.
 */

export interface Tier {
  id: "organic" | "spark" | "growth" | "scale";
  name: string;
  priceUsdMonthly: number;
  markupLabel: string;
  platforms: string;
  tagline: string;
  features: string[];
  recommended?: boolean;
}

export const TIERS: Tier[] = [
  {
    id: "organic",
    name: "Organic",
    priceUsdMonthly: 0,
    markupLabel: "no ad spend, no markup",
    platforms: "Facebook & Instagram (posts)",
    tagline: "Start with no ad budget at all. The agent writes and posts for you.",
    features: [
      "Daily posts written for your business, in your language",
      "Uses your own product photo, so nothing to pay for",
      "Facebook & Instagram, posted automatically",
      "No wallet, no ad account, no card needed",
      "Upgrade the day you want to put money behind a post",
    ],
  },
  {
    id: "spark",
    name: "Spark",
    priceUsdMonthly: 5,
    markupLabel: "18% ad-spend markup",
    platforms: "Meta",
    tagline: "Run real ads on a small budget. From about N2,000 a day.",
    features: [
      "Advertise from roughly N2,000/day, not $10",
      "Up to 2 image creatives a day, made for you",
      "One ad at a time, rotated — not the side-by-side daily duel",
      "Awareness, enquiries, WhatsApp or sales as your goal",
      "Ad copy in Pidgin, Hausa, Yoruba or Igbo",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceUsdMonthly: 39,
    markupLabel: "15% ad-spend markup",
    platforms: "Meta + TikTok",
    tagline: "The daily duel, and video. Two ads tested against your best, every day.",
    features: [
      "Video creatives — the first tier with the credits to make them",
      "The daily duel: 2 challengers vs your champion",
      "Meta + TikTok, posted and advertised",
      "Strategy Studio — deep tuning of how the agent thinks",
      "Verified-sales tracking & true return on spend",
      "Everything in Spark",
    ],
    recommended: true,
  },
  {
    id: "scale",
    name: "Scale",
    priceUsdMonthly: 99,
    markupLabel: "12% ad-spend markup",
    platforms: "Meta + TikTok + Google",
    tagline: "Full throttle. Heavy video across every channel, lowest markup.",
    features: [
      "Heavy video with priority rendering",
      "Meta + TikTok + Google, all arbitrated for you",
      "Lowest 12% markup on ad spend",
      "Cross-platform budget arbitration",
      "Everything in Growth",
    ],
  },
];

/** Extra renders beyond a tier's cap are à la carte at ~2× platform cost. */
export const EXTRA_RENDER_NOTE = "Need more renders? Buy à la carte credits any time.";
