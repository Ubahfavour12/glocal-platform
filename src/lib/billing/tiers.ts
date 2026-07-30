/**
 * Subscription tiers (from 08-Pricing-Model.docx v1.0). The subscription roughly
 * covers serving cost; the ad-spend markup is the business. Free is the trial
 * (concepts + one render); paid tiers unlock rendering-at-volume, more platforms,
 * lower markup, and (Growth+) the Strategy Studio. Pure data — the /upgrade page
 * renders these; charging is wired in Phase 4 when payments go live.
 */

export interface Tier {
  id: "starter" | "growth" | "scale";
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
    id: "starter",
    name: "Starter",
    priceUsdMonthly: 39,
    markupLabel: "15% ad-spend markup",
    platforms: "Meta",
    tagline: "Get selling. Image-led ads that run themselves.",
    features: [
      "Image-led creatives + up to 2 video renders/day",
      "Facebook & Instagram ads, run automatically",
      "The daily duel: 2 challengers vs your champion",
      "Verified-sales tracking & true return on spend",
      "$10/day minimum ad budget",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceUsdMonthly: 99,
    markupLabel: "12% ad-spend markup",
    platforms: "Meta + TikTok",
    tagline: "Scale what works. Video-led, more reach, deeper tuning.",
    features: [
      "Video-led creatives, higher daily render cap",
      "Meta + TikTok, posted and advertised",
      "Strategy Studio — deep tuning of how the agent thinks",
      "Lower 12% markup on every ad dollar",
      "Everything in Starter",
    ],
    recommended: true,
  },
  {
    id: "scale",
    name: "Scale",
    priceUsdMonthly: 249,
    markupLabel: "10% ad-spend markup",
    platforms: "Meta + TikTok + Google",
    tagline: "Full throttle. Priority rendering across every channel.",
    features: [
      "Heavy video with priority rendering",
      "Meta + TikTok + Google, all arbitrated for you",
      "Lowest 10% markup on ad spend",
      "Cross-platform budget arbitration",
      "Everything in Growth",
    ],
  },
];

/** Extra renders beyond a tier's cap are à la carte at ~2× platform cost. */
export const EXTRA_RENDER_NOTE = "Need more renders? Buy à la carte credits any time.";
