import { describe, expect, it } from "vitest";
import { parseDuration, rankTop, viralityScore, type ViralVideo } from "./youtube";

const now = new Date("2026-07-11T00:00:00Z");

const vid = (id: string, score: number, source: ViralVideo["source"] = "keyword"): ViralVideo => ({
  videoId: id,
  title: id,
  channelTitle: "c",
  publishedAt: new Date("2026-07-01T00:00:00Z"),
  views: 0,
  likes: 0,
  durationSeconds: 30,
  viralityScore: score,
  source,
  sourceQuery: "q",
});

describe("viralityScore", () => {
  it("computes views per day since publish", () => {
    const published = new Date("2026-07-01T00:00:00Z"); // 10 days ago
    expect(viralityScore(1_000_000, published, now)).toBe(100_000);
  });

  it("floors age at one day so fresh videos don't explode", () => {
    const published = new Date("2026-07-10T23:00:00Z"); // 1 hour ago
    expect(viralityScore(24_000, published, now)).toBe(24_000);
  });
});

describe("parseDuration", () => {
  it("parses shorts-style durations", () => {
    expect(parseDuration("PT58S")).toBe(58);
    expect(parseDuration("PT1M30S")).toBe(90);
    expect(parseDuration("PT1H2M3S")).toBe(3723);
  });

  it("returns 0 on malformed input", () => {
    expect(parseDuration("garbage")).toBe(0);
  });
});

describe("rankTop", () => {
  it("sorts by virality descending and caps at n", () => {
    const ranked = rankTop([vid("a", 10), vid("b", 30), vid("c", 20)], 2);
    expect(ranked.map((v) => v.videoId)).toEqual(["b", "c"]);
  });

  it("dedupes overlapping keyword/competitor hits, keeping the higher score", () => {
    const ranked = rankTop([vid("a", 10, "keyword"), vid("a", 50, "competitor"), vid("b", 20)]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toMatchObject({ videoId: "a", viralityScore: 50, source: "competitor" });
  });

  it("defaults to the 50-concept pipeline size", () => {
    const many = Array.from({ length: 80 }, (_, i) => vid(`v${i}`, i));
    expect(rankTop(many)).toHaveLength(50);
  });
});
