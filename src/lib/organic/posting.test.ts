import { describe, expect, it } from "vitest";
import {
  publishTimes,
  scheduleOrganic,
  type PostCandidate,
  type PostingDeps,
  type PostingPlan,
} from "./posting";

const now = new Date("2026-07-24T06:00:00.000Z");
const cand = (id: string): PostCandidate => ({
  conceptId: id,
  text: `Post ${id}`,
  mediaUrls: [`https://cdn/${id}.jpg`],
});

const plan = (over: Partial<PostingPlan> = {}): PostingPlan => ({
  networks: ["instagram", "facebook"],
  postedToday: 0,
  dailyLimit: 1,
  ...over,
});

function makeDeps(over: Partial<PostingDeps> = {}) {
  const recorded: unknown[] = [];
  const audits: unknown[] = [];
  let seq = 0;
  const deps: PostingDeps = {
    schedule: async () => ({ postId: `post_${seq++}` }),
    record: async (_b, s) => {
      recorded.push(s);
    },
    audit: async (_b, _a, d) => {
      audits.push(d);
    },
    ...over,
  };
  return { deps, recorded, audits };
}

describe("scheduleOrganic", () => {
  it("schedules within the daily cadence and records each", async () => {
    const { deps, recorded } = makeDeps();
    const s = await scheduleOrganic("biz", [cand("a")], plan(), deps, now);
    expect(s.scheduled).toHaveLength(1);
    expect(s.scheduled[0].networks).toEqual(["instagram", "facebook"]);
    expect(recorded).toHaveLength(1);
  });

  it("respects the cadence cap (skips beyond dailyLimit)", async () => {
    const { deps } = makeDeps();
    const s = await scheduleOrganic("biz", [cand("a"), cand("b"), cand("c")], plan(), deps, now);
    expect(s.scheduled).toHaveLength(1);
    expect(s.skippedForCadence).toBe(2);
  });

  it("posts nothing (and flags it) when no networks are connected", async () => {
    const { deps } = makeDeps();
    const s = await scheduleOrganic("biz", [cand("a")], plan({ networks: [] }), deps, now);
    expect(s.scheduled).toHaveLength(0);
    expect(s.skippedNoNetworks).toBe(true);
  });

  it("already-posted-today leaves no room", async () => {
    const { deps } = makeDeps();
    const s = await scheduleOrganic("biz", [cand("a")], plan({ postedToday: 1 }), deps, now);
    expect(s.scheduled).toHaveLength(0);
    expect(s.skippedForCadence).toBe(1);
  });

  it("captures a scheduling failure without crashing", async () => {
    const { deps } = makeDeps({
      schedule: async () => {
        throw new Error("metricool 500");
      },
    });
    const s = await scheduleOrganic("biz", [cand("a")], plan(), deps, now);
    expect(s.scheduled).toHaveLength(0);
    expect(s.failed[0]).toMatchObject({ conceptId: "a", error: "metricool 500" });
  });
});

describe("publishTimes", () => {
  it("spreads posts and never schedules in the past", () => {
    const times = publishTimes(2, now);
    expect(times).toHaveLength(2);
    expect(new Date(times[0]).getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(new Date(times[1]).getTime()).toBeGreaterThan(new Date(times[0]).getTime());
  });

  it("pushes past a mid-morning start that already elapsed", () => {
    const afternoon = new Date("2026-07-24T15:00:00.000Z");
    const [t] = publishTimes(1, afternoon);
    expect(new Date(t).getTime()).toBeGreaterThan(afternoon.getTime());
  });
});
