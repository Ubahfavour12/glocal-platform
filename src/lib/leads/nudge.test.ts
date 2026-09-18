import { describe, expect, it } from "vitest";
import { NUDGE_INTERVAL_DAYS, nudgeMessage, shouldNudge, STALE_AFTER_DAYS } from "./nudge";

const now = new Date("2026-09-20T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("shouldNudge", () => {
  it("says nothing when there is nothing to answer", () => {
    // An empty prompt teaches people the prompt is noise, and then the one
    // that matters gets dismissed too.
    expect(
      shouldNudge({ openCount: 0, oldestOpenAt: null, lastAnsweredAt: daysAgo(30), now }),
    ).toEqual({ show: false });
  });

  it("prompts on the very first lead without waiting out the interval", () => {
    // Someone who has never done this needs to see what the question is. Four
    // days of silence after their first lead reads as nothing happening.
    const n = shouldNudge({
      openCount: 1,
      oldestOpenAt: daysAgo(0),
      lastAnsweredAt: null,
      now,
    });
    expect(n.show).toBe(true);
  });

  it("stays quiet inside the interval", () => {
    expect(
      shouldNudge({
        openCount: 5,
        oldestOpenAt: daysAgo(2),
        lastAnsweredAt: daysAgo(NUDGE_INTERVAL_DAYS - 1),
        now,
      }).show,
    ).toBe(false);
  });

  it("prompts once the interval has passed", () => {
    expect(
      shouldNudge({
        openCount: 5,
        oldestOpenAt: daysAgo(6),
        lastAnsweredAt: daysAgo(NUDGE_INTERVAL_DAYS),
        now,
      }).show,
    ).toBe(true);
  });

  it("changes tone once leads are too old to place", () => {
    // Past three weeks the honest framing changes: not "please answer" but
    // "answer while you can still remember who this was".
    const n = shouldNudge({
      openCount: 3,
      oldestOpenAt: daysAgo(STALE_AFTER_DAYS + 1),
      lastAnsweredAt: daysAgo(10),
      now,
    });
    expect(n.show && n.tone).toBe("stale");
  });

  it("treats a future timestamp as zero days rather than negative", () => {
    // Clock skew between the database and the browser must not produce
    // "-1 days ago" in front of a customer.
    const n = shouldNudge({
      openCount: 1,
      oldestOpenAt: new Date(now.getTime() + 86_400_000),
      lastAnsweredAt: null,
      now,
    });
    expect(n.show && n.oldestDays).toBe(0);
  });
});

describe("nudgeMessage", () => {
  it("is silent when there is no nudge", () => {
    expect(nudgeMessage({ show: false })).toBeNull();
  });

  it("gets the singular right", () => {
    const msg = nudgeMessage({ show: true, tone: "normal", openCount: 1, oldestDays: 1 });
    expect(msg).toContain("1 lead ");
    expect(msg).not.toContain("leads");
  });

  it("names the age when leads have gone stale", () => {
    const msg = nudgeMessage({ show: true, tone: "stale", openCount: 4, oldestDays: 30 });
    expect(msg).toContain("30 days");
  });

  it("never guilt-trips", () => {
    const msg = nudgeMessage({ show: true, tone: "stale", openCount: 9, oldestDays: 40 }) ?? "";
    for (const word of ["forgot", "failed", "should have", "neglect"]) {
      expect(msg.toLowerCase()).not.toContain(word);
    }
  });
});
