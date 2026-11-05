/**
 * Which engine renders which job.
 *
 * FOUNDER DECISION, 5 Nov 2026: Higgsfield access is a tier benefit, and
 * images are the cheap lane. The table below is the whole policy:
 *
 *            images        video
 *   free     fal           fal            <- no Higgsfield at all
 *   starter  fal           Higgsfield
 *   growth   fal           Higgsfield
 *   scale    Higgsfield    Higgsfield     <- "higher account, all higgs"
 *
 * Free accounts additionally get NO failover: one engine, one render, so an
 * unpaid preview cannot become two attempts at two vendors. Paid tiers fail
 * over to the other engine, because a vendor outage mid-launch should cost a
 * render's quality, not the render.
 *
 * READ THIS BEFORE TRUSTING THE TABLE. It only takes effect while BOTH engines
 * are configured. With no FAL_KEY set there is nothing to route to, so every
 * row above collapses onto Higgsfield and every render spends Higgsfield
 * credits — the table becomes a comment that happens to be false. That is not
 * hypothetical: it is the second time this exact shape of bug has appeared
 * here. The old free-tier rule said "a free account renders on fal", named the
 * vendor, and silently stopped restricting anything the moment fal was the
 * vendor removed. So routing no longer fails silently: when the preferred
 * engine is not configured the route says so in `reason`, and render-live
 * writes that to the journal, where a policy that is not happening is visible
 * instead of merely true-on-paper.
 *
 * RENDER_PRIMARY, when set, overrides the whole table and leads every job with
 * that engine. It is the emergency lever, not the normal path: the case it
 * exists for is "stop spending Higgsfield credits now" (set it to `fal`), which
 * with a credit-metered plan is a live concern, not a theoretical one.
 *
 * What stops the table being an assumption forever: every render records the
 * engine that made it, so the duel that already decides which creative wins on
 * money becomes engine evidence for free. See `scoreboard.ts`. Nobody has
 * compared the two vendors' output yet — this table is a cost and packaging
 * decision, which is a good reason, just not an evidential one.
 *
 * Pure, so the whole policy is testable without a vendor or a database.
 */

import type { RenderTier } from "@/lib/billing/plan";
import type { CreativeKind } from "@/lib/fal/client";
import { standbyFor, type EngineName, type RenderEngine } from "./engine";

export interface RouteInput {
  kind: CreativeKind;
  /** The business's tier. Paid tiers are NOT interchangeable here. */
  tier: RenderTier;
  /** Engines that are actually configured, in no particular order. */
  available: readonly RenderEngine[];
  /**
   * Override the tier table and lead with this engine instead. Normally
   * undefined; comes from RENDER_PRIMARY.
   */
  primary?: EngineName;
}

export interface Route {
  /** Try these in order. Empty when nothing is configured. */
  order: RenderEngine[];
  /** Why this order, in plain language, for the journal. */
  reason: string;
  /**
   * True when the engine this job was supposed to run on is not configured, so
   * it is running somewhere else. The policy is not in force for this render,
   * and the caller records it rather than letting it pass unnoticed.
   */
  degraded: boolean;
}

/** Higgsfield access by tier and kind. The founder decision, in one table. */
const ENGINE_FOR: Record<RenderTier, Record<CreativeKind, EngineName>> = {
  free: { image: "fal", video: "fal" },
  starter: { image: "fal", video: "higgsfield" },
  // To give Growth Higgsfield images too, change this one line to match scale.
  growth: { image: "fal", video: "higgsfield" },
  scale: { image: "higgsfield", video: "higgsfield" },
};

/** Free accounts get one engine and no second attempt. */
function allowsFailover(tier: RenderTier): boolean {
  return tier !== "free";
}

/**
 * Preference order by name, before availability is considered.
 *
 * `primary` overrides the tier table entirely when given — that is the
 * RENDER_PRIMARY escape hatch, and it deliberately ignores tier and kind,
 * because the situation it exists for ("stop spending that vendor's credits")
 * is not one where a per-tier exception helps.
 */
export function preferenceFor(
  kind: CreativeKind,
  tier: RenderTier,
  primary?: EngineName,
): EngineName[] {
  const lead = primary ?? ENGINE_FOR[tier][kind];
  return allowsFailover(tier) ? [lead, standbyFor(lead)] : [lead];
}

/**
 * Order the configured engines for this job.
 *
 * A preference is never allowed to stop a render: if the preferred engine is
 * not configured, whatever is left still gets the job, and the reason says so
 * rather than failing quietly.
 *
 * That now holds for the free tier too, which is a deliberate change. The old
 * version returned nothing for a free account when fal specifically was
 * missing, and that was silently untrue: the caller falls back to the full
 * engine list when the route is empty, so the render happened anyway, on the
 * engine the journal had just finished saying was off limits. Two ways out
 * existed — make the refusal real, or stop refusing. Refusing for real would
 * have killed the free preview outright the moment fal was replaced, and the
 * free preview is the product's entire first impression. So the restriction
 * keeps the part that costs money (one engine, one render, no failover) and
 * drops the part that only named a vendor.
 */
export function routeRender(input: RouteInput): Route {
  const override = input.primary;
  const wanted = preferenceFor(input.kind, input.tier, override);
  const intended = wanted[0];
  const byName = new Map(input.available.map((e) => [e.name, e]));
  const order = wanted.map((n) => byName.get(n)).filter((e): e is RenderEngine => !!e);

  // A free account never gets a second attempt, so its list is capped at one
  // engine whichever engine that turns out to be.
  const cap = allowsFailover(input.tier) ? Infinity : 1;

  // Anything configured is better than refusing to render. The tier decides
  // how many engines may be tried, never whether a render happens at all.
  const rest = input.available.filter((e) => !order.includes(e));
  const full = [...order, ...rest].slice(0, cap);

  if (full.length === 0) {
    return { order: [], reason: "No render engine is configured.", degraded: true };
  }

  const ran = full[0].name;
  const where = override ? `${ran} (RENDER_PRIMARY override)` : ran;

  if (ran !== intended) {
    return {
      order: full,
      // Named loudly: this is the policy NOT being in force. render-live writes
      // it to the journal so it is visible rather than silently true-on-paper.
      reason: `${input.tier} ${input.kind} should render on ${intended}, but ${intended} is not configured, so it renders on ${ran} instead. The tier routing policy is not in force.`,
      degraded: true,
    };
  }

  const tail =
    full.length > 1
      ? `, with ${full[1].name} behind it as failover`
      : input.tier === "free"
        ? ", alone, with no failover"
        : ", the only engine configured";
  return {
    order: full,
    reason: `A ${input.tier} ${input.kind} renders on ${where}${tail}.`,
    degraded: false,
  };
}
