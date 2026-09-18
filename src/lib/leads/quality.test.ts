import { describe, expect, it } from "vitest";
import {
  decided,
  qualityByCreative,
  rankForBudget,
  volumeVersusValue,
  type LeadRow,
} from "./quality";

const lead = (creativeId: string | null, status: LeadRow["status"], value?: number): LeadRow => ({
  creativeId,
  status,
  valueUsdMinor: value ?? null,
});

describe("decided — why open leads must not count", () => {
  it("counts only won and lost", () => {
    expect(
      decided([lead("a", "new"), lead("a", "contacted"), lead("a", "won", 100), lead("a", "lost")]),
    ).toBe(2);
  });

  it("is zero before anything has resolved", () => {
    expect(decided([lead("a", "new"), lead("a", "contacted")])).toBe(0);
  });
});

describe("win rate", () => {
  it("ignores still-open leads in the denominator", () => {
    // Otherwise a fresh ad with ten untouched leads reads as a total failure,
    // and every campaign looks worse the newer it is.
    const q = qualityByCreative(
      [lead("a", "won", 1000), lead("a", "lost"), lead("a", "new"), lead("a", "contacted")],
      { a: 500 },
    );
    expect(q[0].winRate).toBe(0.5);
    expect(q[0].open).toBe(2);
  });

  it("is null, not zero, before any lead has resolved", () => {
    // Zero would read as "nothing ever closes here", which is a different and
    // much worse claim than "we do not know yet".
    const q = qualityByCreative([lead("a", "new"), lead("a", "contacted")], { a: 500 });
    expect(q[0].winRate).toBeNull();
  });

  it("counts a won lead as having been qualified", () => {
    // Nobody taps "qualified" on the way to closing a deal.
    const q = qualityByCreative([lead("a", "won", 1000)], { a: 100 });
    expect(q[0].qualified).toBe(1);
  });
});

describe("cost per won deal — the number that changes the decision", () => {
  it("divides spend by wins", () => {
    const q = qualityByCreative([lead("a", "won", 5000), lead("a", "won", 3000)], { a: 2000 });
    expect(q[0].costPerWonUsdMinor).toBe(1000);
    expect(q[0].averageDealUsdMinor).toBe(4000);
  });

  it("is null rather than Infinity when nothing has closed", () => {
    // Infinity propagates silently through arithmetic and surfaces later as
    // nonsense in front of a customer.
    const q = qualityByCreative([lead("a", "lost"), lead("a", "lost")], { a: 9000 });
    expect(q[0].costPerWonUsdMinor).toBeNull();
    expect(q[0].returnOnSpend).toBe(0);
  });

  it("keeps cost per LEAD separate, because it is the flattering one", () => {
    const q = qualityByCreative([lead("a", "lost"), lead("a", "lost"), lead("a", "lost")], {
      a: 3000,
    });
    expect(q[0].costPerLeadUsdMinor).toBe(1000);
    expect(q[0].costPerWonUsdMinor).toBeNull();
  });
});

describe("creatives with spend and no leads", () => {
  it("still appear, because that is the worst case and must be visible", () => {
    const q = qualityByCreative([lead("a", "won", 1000)], { a: 500, b: 4000 });
    const b = q.find((x) => x.creativeId === "b");
    expect(b).toBeDefined();
    expect(b?.leads).toBe(0);
    expect(b?.costPerWonUsdMinor).toBeNull();
  });
});

describe("leads with no creative", () => {
  it("are excluded rather than blamed on an ad", () => {
    // A walk-in or a direct message is real business and no evidence about any
    // creative. Attributing it to one would corrupt the comparison.
    const q = qualityByCreative([lead(null, "won", 9999), lead("a", "won", 1000)], { a: 500 });
    expect(q).toHaveLength(1);
    expect(q[0].revenueUsdMinor).toBe(1000);
  });
});

describe("volumeVersusValue — the sentence worth paying for", () => {
  it("names the volume ad and the money ad when they differ", () => {
    const q = qualityByCreative(
      [
        lead("cheap", "lost"),
        lead("cheap", "lost"),
        lead("cheap", "lost"),
        lead("cheap", "won", 500),
        lead("good", "won", 40000),
      ],
      { cheap: 1000, good: 1000 },
    );
    const v = volumeVersusValue(q);
    expect(v?.mostLeads.creativeId).toBe("cheap");
    expect(v?.mostRevenue.creativeId).toBe("good");
  });

  it("says nothing when the same ad wins both", () => {
    // "Your best ad is also your best ad" is noise, not insight.
    const q = qualityByCreative([lead("a", "won", 5000), lead("b", "lost")], { a: 100, b: 100 });
    expect(volumeVersusValue(q)).toBeNull();
  });

  it("says nothing before any revenue is known", () => {
    // Early on every lead is open. A confident claim here would be a lie told
    // with a straight face.
    const q = qualityByCreative([lead("a", "new"), lead("b", "contacted")], { a: 100, b: 100 });
    expect(volumeVersusValue(q)).toBeNull();
  });
});

describe("rankForBudget", () => {
  it("puts the cheapest cost-per-won first", () => {
    const q = qualityByCreative(
      [lead("a", "won", 1000), lead("b", "won", 1000)],
      { a: 5000, b: 1000 },
    );
    expect(rankForBudget(q)[0].creativeId).toBe("b");
  });

  it("sorts creatives with no wins last rather than hiding them", () => {
    // "Spent money, closed nothing" is a finding, not missing data.
    const q = qualityByCreative([lead("a", "won", 1000), lead("b", "lost")], { a: 500, b: 8000 });
    const ranked = rankForBudget(q);
    expect(ranked[0].creativeId).toBe("a");
    expect(ranked[ranked.length - 1].creativeId).toBe("b");
  });

  it("falls back to lead volume when nothing anywhere has closed", () => {
    const q = qualityByCreative([lead("a", "new"), lead("b", "new"), lead("b", "new")], {
      a: 100,
      b: 100,
    });
    expect(rankForBudget(q)[0].creativeId).toBe("b");
  });
});
