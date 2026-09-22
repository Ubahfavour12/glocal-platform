import { describe, expect, it } from "vitest";
import { gapMessage, leadGaps, messagingConversations } from "./reconcile";

describe("leadGaps", () => {
  it("finds ads where Meta counted more conversations than we logged", () => {
    const gaps = leadGaps([{ adId: "a", reportedByMeta: 7, logged: 2 }]);
    expect(gaps).toEqual([{ adId: "a", missing: 5, reportedByMeta: 7, logged: 2 }]);
  });

  it("IGNORES logging more than Meta reports", () => {
    // Walk-ins, referrals and repeat customers are real leads that never
    // touched an ad. Flagging them would train people to ignore this.
    expect(leadGaps([{ adId: "a", reportedByMeta: 1, logged: 6 }])).toEqual([]);
  });

  it("ignores a difference of one", () => {
    // Meta's attribution window and ours never align to the hour, so one is
    // noise at any volume — and a permanently slightly-wrong warning is the
    // fastest way to make a warning worthless.
    expect(leadGaps([{ adId: "a", reportedByMeta: 4, logged: 3 }])).toEqual([]);
  });

  it("puts the biggest gap first, because that is where to start", () => {
    const gaps = leadGaps([
      { adId: "small", reportedByMeta: 5, logged: 2 },
      { adId: "big", reportedByMeta: 20, logged: 1 },
    ]);
    expect(gaps[0].adId).toBe("big");
  });

  it("says nothing when everything reconciles", () => {
    expect(leadGaps([{ adId: "a", reportedByMeta: 3, logged: 3 }])).toEqual([]);
  });
});

describe("gapMessage", () => {
  it("is silent when there is no gap", () => {
    expect(gapMessage([])).toBeNull();
  });

  it("names the total and how many ads", () => {
    const msg = gapMessage(leadGaps([
      { adId: "a", reportedByMeta: 7, logged: 2 },
      { adId: "b", reportedByMeta: 5, logged: 1 },
    ]));
    expect(msg).toContain("9");
    expect(msg).toContain("2 of your ads");
  });

  it("does not blame the owner", () => {
    // The likeliest explanation is that WhatsApp cannot be captured
    // automatically yet, which is our limitation, not theirs.
    const msg = gapMessage(leadGaps([{ adId: "a", reportedByMeta: 9, logged: 1 }])) ?? "";
    for (const word of ["forgot", "failed", "should", "neglect", "missed"]) {
      expect(msg.toLowerCase()).not.toContain(word);
    }
  });
});

describe("messagingConversations", () => {
  it("takes the LARGEST overlapping metric, never the sum", () => {
    // Meta reports several windows over the same conversations. Summing them
    // double-counts and would send someone hunting for leads that never were.
    expect(
      messagingConversations([
        { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5" },
        { action_type: "onsite_conversion.total_messaging_connection", value: "7" },
      ]),
    ).toBe(7);
  });

  it("ignores unrelated action types", () => {
    expect(
      messagingConversations([
        { action_type: "link_click", value: "400" },
        { action_type: "post_engagement", value: "90" },
      ]),
    ).toBe(0);
  });

  it("is zero when there are no actions at all", () => {
    expect(messagingConversations(undefined)).toBe(0);
    expect(messagingConversations([])).toBe(0);
  });

  it("survives a non-numeric value", () => {
    expect(
      messagingConversations([
        { action_type: "onsite_conversion.total_messaging_connection", value: "oops" },
      ]),
    ).toBe(0);
  });
});
