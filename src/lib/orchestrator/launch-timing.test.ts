import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCH_HOUR,
  defaultLaunchAt,
  describeLaunchAt,
  launchSuggestion,
  resolveLaunchAt,
} from "./launch-timing";

const at = (h: number, m = 0, day = 12) => new Date(2026, 7, day, h, m, 0, 0);

describe("defaultLaunchAt", () => {
  it("is tomorrow morning when the hour has already passed", () => {
    const d = defaultLaunchAt(at(20));
    expect(d.getHours()).toBe(DEFAULT_LAUNCH_HOUR);
    expect(d.getDate()).toBe(13);
  });

  it("is this morning when it has not happened yet", () => {
    // Approving at 6am should not wait 25 hours for the next one.
    const d = defaultLaunchAt(at(6));
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(DEFAULT_LAUNCH_HOUR);
  });
});

describe("launchSuggestion", () => {
  it("warns that a late start spends while people sleep", () => {
    expect(launchSuggestion(at(23))).toMatch(/asleep/i);
    expect(launchSuggestion(at(2))).toMatch(/asleep/i);
  });

  it("explains the full-day reasoning in the evening", () => {
    expect(launchSuggestion(at(18))).toMatch(/full day/i);
  });

  it("allows a head start during the day rather than insisting", () => {
    expect(launchSuggestion(at(10))).toMatch(/head start/i);
  });
});

describe("resolveLaunchAt", () => {
  it("returns null for the default, so the morning run handles it", () => {
    expect(resolveLaunchAt("default", at(20))).toBeNull();
  });

  it("returns now for an immediate launch", () => {
    const now = at(14);
    expect(resolveLaunchAt("now", now)).toEqual(now);
  });

  it("accepts a future custom time", () => {
    const now = at(9);
    const chosen = resolveLaunchAt("custom", now, at(18).toISOString());
    expect(chosen?.getHours()).toBe(18);
  });

  it("falls back to the default rather than throwing on bad input", () => {
    // A bad date must never block an approval; the approval matters more than
    // the timing refinement on top of it.
    const now = at(9);
    expect(resolveLaunchAt("custom", now, "not-a-date")).toBeNull();
    expect(resolveLaunchAt("custom", now, at(8).toISOString())).toBeNull(); // in the past
    expect(resolveLaunchAt("custom", now)).toBeNull();
  });
});

describe("describeLaunchAt", () => {
  it("says today, tomorrow, or names the day", () => {
    const now = at(9);
    expect(describeLaunchAt(at(18), now)).toMatch(/^today at/);
    expect(describeLaunchAt(at(7, 0, 13), now)).toMatch(/^tomorrow at/);
    expect(describeLaunchAt(at(7, 0, 16), now)).toMatch(/at /);
  });
});
