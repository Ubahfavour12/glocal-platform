import { describe, expect, it } from "vitest";
import { parseInsightRow, toCandidateMetrics, type RawInsightRow } from "./insights";

const row = (over: Partial<RawInsightRow> = {}): RawInsightRow => ({
  ad_id: "ad_1",
  date_start: "2026-07-18",
  impressions: "6000",
  clicks: "180",
  spend: "5.40",
  ctr: "3.00",
  frequency: "1.8",
  actions: [
    { action_type: "link_click", value: "120" },
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "12" },
    { action_type: "post_reaction", value: "40" },
  ],
  action_values: [{ action_type: "purchase", value: "90.00" }],
  ...over,
});

describe("parseInsightRow", () => {
  it("normalises a full row", () => {
    const m = parseInsightRow(row());
    expect(m.adId).toBe("ad_1");
    expect(m.impressions).toBe(6000);
    expect(m.clicks).toBe(180);
    expect(m.spendUsdMinor).toBe(540); // $5.40 -> minor
    expect(m.ctr).toBeCloseTo(0.03, 6); // 3.00% -> fraction
    expect(m.frequency).toBe(1.8);
    expect(m.revenueUsdMinor).toBe(9000); // $90 purchase
  });

  it("sums only conversion-intent actions", () => {
    const m = parseInsightRow(row());
    // link_click 120 + messaging 12 = 132; post_reaction ignored
    expect(m.intents).toBe(132);
  });

  it("derives CTR when Meta omits it", () => {
    const m = parseInsightRow(row({ ctr: undefined }));
    expect(m.ctr).toBeCloseTo(180 / 6000, 6);
  });

  it("handles missing reach/frequency as null", () => {
    const m = parseInsightRow(row({ frequency: undefined }));
    expect(m.frequency).toBeNull();
  });

  it("treats absent fields as zero", () => {
    const m = parseInsightRow({ ad_id: "x", date_start: "2026-07-18" });
    expect(m.impressions).toBe(0);
    expect(m.intents).toBe(0);
    expect(m.spendUsdMinor).toBe(0);
    expect(m.revenueUsdMinor).toBe(0);
  });
});

describe("toCandidateMetrics", () => {
  it("groups multi-day rows per ad and applies startedAt", () => {
    const started = new Date("2026-07-16T00:00:00Z");
    const rows = [
      parseInsightRow(row({ ad_id: "a", date_start: "2026-07-16" })),
      parseInsightRow(row({ ad_id: "a", date_start: "2026-07-17" })),
      parseInsightRow(row({ ad_id: "b", date_start: "2026-07-17" })),
    ];
    const cands = toCandidateMetrics(rows, new Map([["a", started]]));
    const a = cands.find((c) => c.adId === "a")!;
    const b = cands.find((c) => c.adId === "b")!;
    expect(a.daily).toHaveLength(2);
    expect(a.startedAt).toEqual(started);
    // b had no startedAt override -> falls back to its first row date
    expect(b.startedAt).toEqual(new Date("2026-07-17T00:00:00Z"));
  });

  it("output feeds the verdict engine shape (impressions/intents/spend/revenue)", () => {
    const rows = [parseInsightRow(row({ ad_id: "a" }))];
    const [c] = toCandidateMetrics(rows, new Map());
    expect(c.daily[0]).toMatchObject({
      impressions: 6000,
      intents: 132,
      spendUsdMinor: 540,
      revenueUsdMinor: 9000,
    });
  });
});
