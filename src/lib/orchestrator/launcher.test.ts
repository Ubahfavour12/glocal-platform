import { describe, expect, it } from "vitest";
import {
  isPaymentMethodError,
  launchPlan,
  type LaunchAdapters,
  type LaunchContext,
  type PlanAd,
} from "./launcher";

const ctx: LaunchContext = {
  businessId: "biz_1",
  planDate: "2026-07-24",
  adAccountId: "act_123",
  pageId: "page_1",
  campaignId: "camp_1",
  countries: ["NG"],
};

const ad = (over: Partial<PlanAd> = {}): PlanAd => ({
  role: "challenger",
  conceptId: "concept-abcdef12",
  hook: "Own the room",
  copy: "Handmade pieces, message us to order.",
  cta: "CONTACT_US",
  budgetUsdMinor: 150,
  ...over,
});

function makeAdapters(over: Partial<LaunchAdapters> = {}) {
  const recorded: unknown[] = [];
  const audits: { action: string; detail: unknown }[] = [];
  let seq = 0;
  const adapters: LaunchAdapters = {
    createAdSet: async () => ({ adSetId: `adset_${seq++}` }),
    mintSmartLink: async () => ({ code: `GL-${seq}`, url: `https://x/l/GL-${seq}` }),
    createCreative: async () => ({ creativeId: `cre_${seq}` }),
    createAd: async () => ({ adId: `ad_${seq}`, awaitingPayment: false }),
    recordAd: async (row) => {
      recorded.push(row);
    },
    audit: async (_b, action, detail) => {
      audits.push({ action, detail });
    },
    ...over,
  };
  return { adapters, recorded, audits };
}

describe("launchPlan", () => {
  it("launches every ad, minting a smart link + recording each", async () => {
    const { adapters, recorded, audits } = makeAdapters();
    const summary = await launchPlan(ctx, [ad({ role: "champion" }), ad(), ad()], adapters);
    expect(summary.launched).toBe(3);
    expect(summary.awaitingPayment).toBe(0);
    expect(summary.errors).toBe(0);
    expect(recorded).toHaveLength(3);
    expect(summary.results.every((r) => r.code.startsWith("GL-"))).toBe(true);
    expect(audits.some((a) => a.action === "plan_launched")).toBe(true);
  });

  it("records awaiting_payment (not error) when Meta blocks on payment method", async () => {
    const { adapters } = makeAdapters({
      createAd: async () => ({ awaitingPayment: true }),
    });
    const summary = await launchPlan(ctx, [ad()], adapters);
    expect(summary.awaitingPayment).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.results[0].status).toBe("awaiting_payment");
    expect(summary.results[0].platformAdId).toBeUndefined();
  });

  it("one failing ad never stops the others", async () => {
    let calls = 0;
    const { adapters, recorded } = makeAdapters({
      createAdSet: async () => {
        calls += 1;
        if (calls === 2) throw new Error("Meta API adsets: transient");
        return { adSetId: `adset_${calls}` };
      },
    });
    const summary = await launchPlan(ctx, [ad(), ad(), ad()], adapters);
    expect(summary.launched).toBe(2);
    expect(summary.errors).toBe(1);
    expect(recorded).toHaveLength(2); // the failed one is not recorded as launched
    expect(summary.results[1].status).toBe("error");
    expect(summary.results[1].detail).toMatch(/transient/);
  });

  it("passes the minted link URL into the creative", async () => {
    let seenLink = "";
    const { adapters } = makeAdapters({
      mintSmartLink: async () => ({ code: "GL-XYZ", url: "https://x/l/GL-XYZ" }),
      createCreative: async (_c, _a, linkUrl) => {
        seenLink = linkUrl;
        return { creativeId: "cre" };
      },
    });
    await launchPlan(ctx, [ad()], adapters);
    expect(seenLink).toBe("https://x/l/GL-XYZ");
  });
});

describe("isPaymentMethodError", () => {
  it("recognises the no-payment-method block", () => {
    expect(isPaymentMethodError("Meta API ads: (#1359188) ...")).toBe(true);
    expect(isPaymentMethodError("You must add a payment method")).toBe(true);
    expect(isPaymentMethodError("some other transient error")).toBe(false);
  });
});
