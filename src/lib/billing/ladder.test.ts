import { describe, expect, it } from "vitest";
import { TIERS, type Tier } from "./tiers";
import { subscriptionConfigForTier, isTierId, type TierId } from "./subscription";
import { VIDEO_CREDIT_WEIGHT } from "@/lib/creative/quota";
import { minDailyBudgetFor, MIN_DAILY_BUDGET_USD_MINOR } from "@/lib/money/ledger";
import { asTier } from "./plan";

/** The paid rungs, in the order the pricing page shows them. */
const PAID = TIERS.filter((t): t is Tier & { id: TierId } => isTierId(t.id));

describe("the ladder is internally consistent", () => {
  it("is four tiers, cheapest first", () => {
    // Six was the problem: more choices than a trader wants before they have
    // seen the product work once.
    expect(TIERS.map((t) => t.id)).toEqual(["organic", "spark", "growth", "scale"]);
    const prices = TIERS.map((t) => t.priceUsdMonthly);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("has no trace of the retired starter tier", () => {
    expect(TIERS.some((t) => t.id === ("starter" as string))).toBe(false);
    expect(isTierId("starter")).toBe(false);
  });

  it("drops the markup as the price rises", () => {
    // The low end pays a higher rate because fixed serving cost is a bigger
    // share of a smaller account, not because it is squeezed.
    const bps = PAID.map((t) => subscriptionConfigForTier(t.id).spendMarkupBps);
    expect(bps).toEqual([...bps].sort((a, b) => b - a));
    expect(new Set(bps).size).toBe(bps.length);
  });

  it("raises renders and socials as the price rises", () => {
    const renders = PAID.map((t) => subscriptionConfigForTier(t.id).rendersPerDay);
    const socials = PAID.map((t) => subscriptionConfigForTier(t.id).socialsLimit);
    expect(renders).toEqual([...renders].sort((a, b) => a - b));
    expect(socials).toEqual([...socials].sort((a, b) => a - b));
  });

  it("only adds platforms as the price rises, never removes one", () => {
    for (let i = 1; i < PAID.length; i++) {
      const lower = subscriptionConfigForTier(PAID[i - 1].id).platforms;
      const higher = subscriptionConfigForTier(PAID[i].id).platforms;
      for (const p of lower) expect(higher).toContain(p);
    }
  });
});

describe("no tier promises what its render maths forbids", () => {
  // THE STARTER LIE, MADE UNREPEATABLE. Starter advertised "up to 2 video
  // renders/day" while holding 2 credits against a video costing 4, so the
  // promise could never once be kept. This test fails if that ever recurs.
  const mentionsVideo = (t: Tier) =>
    t.features.some((f) => /video/i.test(f)) || /video/i.test(t.tagline);

  for (const tier of PAID) {
    it(`${tier.id}: video claim matches its credits`, () => {
      const canVideo = subscriptionConfigForTier(tier.id).rendersPerDay >= VIDEO_CREDIT_WEIGHT;
      expect(mentionsVideo(tier)).toBe(canVideo);
    });
  }

  it("spark cannot render video, and says nothing about it", () => {
    expect(subscriptionConfigForTier("spark").rendersPerDay).toBeLessThan(VIDEO_CREDIT_WEIGHT);
    expect(mentionsVideo(TIERS.find((t) => t.id === "spark")!)).toBe(false);
  });

  it("growth is the entry video tier, and claims it", () => {
    expect(subscriptionConfigForTier("growth").rendersPerDay).toBeGreaterThanOrEqual(
      VIDEO_CREDIT_WEIGHT,
    );
    expect(mentionsVideo(TIERS.find((t) => t.id === "growth")!)).toBe(true);
  });

  it("organic promises no ad spend and charges nothing", () => {
    const organic = TIERS.find((t) => t.id === "organic")!;
    expect(organic.priceUsdMonthly).toBe(0);
    expect(organic.markupLabel).toMatch(/no markup/i);
  });

  it("spark says plainly that it is not the duel", () => {
    // A customer discovering that themselves costs more than the upgrade it
    // might have won.
    const spark = TIERS.find((t) => t.id === "spark")!;
    expect(spark.features.some((f) => /not the|rotated/i.test(f))).toBe(true);
  });
});

describe("the budget floor follows the tier", () => {
  it("lets Spark advertise far below the duel's floor", () => {
    // The $10/day floor was never a pricing choice: it falls out of the duel's
    // 70/30 split against a $3 minimum challenger. Spark runs no duel, so the
    // arithmetic that produced it does not apply.
    expect(minDailyBudgetFor("spark")).toBeLessThan(MIN_DAILY_BUDGET_USD_MINOR);
    expect(minDailyBudgetFor("spark")).toBeGreaterThan(0);
  });

  it("keeps the duel floor for every tier that runs a duel", () => {
    for (const t of ["growth", "scale"] as const) {
      expect(minDailyBudgetFor(t)).toBe(MIN_DAILY_BUDGET_USD_MINOR);
    }
  });

  it("gives an unmapped tier the HIGHER floor, not the lower", () => {
    // A tier nobody has mapped must not silently inherit the cheapest floor in
    // the product -- the opposite direction from asTier, and deliberately so:
    // being wrong here spends a customer's money.
    for (const t of [null, undefined, "", "enterprise", "starter"]) {
      expect(minDailyBudgetFor(t)).toBe(MIN_DAILY_BUDGET_USD_MINOR);
    }
  });
});

describe("retired tiers still resolve", () => {
  it("lands a legacy starter row on the tier that replaced it", () => {
    expect(asTier("starter")).toBe("spark");
  });

  it("agrees with the pricing page about which ids are real", () => {
    for (const t of PAID) expect(asTier(t.id)).toBe(t.id);
  });
});
