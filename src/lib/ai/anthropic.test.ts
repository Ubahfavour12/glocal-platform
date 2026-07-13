import { describe, expect, it } from "vitest";
import { parseJsonFromText } from "./anthropic";

describe("parseJsonFromText", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonFromText<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a JSON array", () => {
    expect(parseJsonFromText<number[]>("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("extracts JSON from a fenced code block", () => {
    const raw = "Here you go:\n```json\n{\"x\":true}\n```\nhope that helps";
    expect(parseJsonFromText<{ x: boolean }>(raw)).toEqual({ x: true });
  });

  it("extracts JSON wrapped in prose", () => {
    const raw = 'Sure! [{"rank":1}] is the answer.';
    expect(parseJsonFromText<{ rank: number }[]>(raw)).toEqual([{ rank: 1 }]);
  });

  it("throws when no JSON present", () => {
    expect(() => parseJsonFromText("no json here")).toThrow();
  });
});
