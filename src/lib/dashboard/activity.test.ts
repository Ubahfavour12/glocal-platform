import { describe, expect, it } from "vitest";
import { describeActivity, relativeTime } from "./activity";

describe("describeActivity", () => {
  it("prefers an explicit customer message", () => {
    expect(describeActivity({ content: { action: "rejection", message: "That ad was paused." } })).toBe(
      "That ad was paused.",
    );
  });
  it("maps known actions to friendly lines", () => {
    expect(describeActivity({ content: { action: "plan_launched" } })).toMatch(/Launched your ads/);
    expect(describeActivity({ content: { action: "verdict" } })).toMatch(/Judged/);
  });
  it("prettifies unknown actions and handles empties", () => {
    expect(describeActivity({ content: { action: "some_new_thing" } })).toBe("Some new thing");
    expect(describeActivity({ content: {} })).toBe("Agent activity");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-07-24T12:00:00Z");
  it("formats minutes, hours, days", () => {
    expect(relativeTime("2026-07-24T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-07-24T11:45:00Z", now)).toBe("15m");
    expect(relativeTime("2026-07-24T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-07-22T12:00:00Z", now)).toBe("2d");
  });
});
