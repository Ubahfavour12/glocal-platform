import { describe, expect, it } from "vitest";
import {
  JOB_CEILING_MS,
  PER_BUSINESS_MS,
  RESERVE_MS,
  hasRoomForAnother,
  observedPerBusinessMs,
} from "./budget";

const at = (elapsedMs: number, over = {}) =>
  hasRoomForAnother({ startedAtMs: 0, nowMs: elapsedMs, ...over });

describe("hasRoomForAnother", () => {
  it("starts the first business immediately", () => {
    expect(at(0)).toBe(true);
  });

  it("stops before the ceiling, not at it", () => {
    // THE WHOLE POINT. Running until 300s means being killed with no response,
    // no audit row and no record of how far the run got. The reserve buys the
    // time to write the answer down.
    const lastSafeStart = JOB_CEILING_MS - PER_BUSINESS_MS - RESERVE_MS;
    expect(at(lastSafeStart)).toBe(true);
    expect(at(lastSafeStart + 1)).toBe(false);
  });

  it("refuses once past the ceiling", () => {
    expect(at(JOB_CEILING_MS + 60_000)).toBe(false);
  });

  it("fits more in when the night is running fast", () => {
    // Same moment, different estimate: a 3-second business still fits where a
    // 25-second one does not.
    const late = JOB_CEILING_MS - 30_000;
    expect(at(late)).toBe(false);
    expect(at(late, { perBusinessMs: 3_000 })).toBe(true);
  });

  it("keeps going rather than halting on a nonsense clock", () => {
    // A clock that runs backwards must not silently stop the whole run. The
    // worst case of continuing is being killed, which is where we already were.
    expect(hasRoomForAnother({ startedAtMs: 1_000, nowMs: 0 })).toBe(true);
    expect(hasRoomForAnother({ startedAtMs: 0, nowMs: Number.NaN })).toBe(true);
  });
});

describe("observedPerBusinessMs", () => {
  it("learns from how long the run is actually taking", () => {
    expect(observedPerBusinessMs(4, 40_000)).toBe(10_000);
  });

  it("falls back before there is anything to learn from", () => {
    expect(observedPerBusinessMs(0, 0)).toBe(PER_BUSINESS_MS);
    expect(observedPerBusinessMs(3, 0)).toBe(PER_BUSINESS_MS);
  });

  it("will not believe a business is nearly free", () => {
    // Three cached no-ops in a row must not convince the loop it can start
    // thirty more. The floor is what stops a fast start causing a kill.
    expect(observedPerBusinessMs(3, 300)).toBe(2_000);
  });
});
