import { describe, expect, it } from "vitest";
import {
  EARLIEST_FOUNDED_YEAR,
  isValidFoundedYear,
  TENURE_LABEL,
  tenureBand,
  tenureYears,
} from "./tenure";

const NOW = new Date("2026-09-05T12:00:00Z"); // year 2026

describe("isValidFoundedYear", () => {
  it("accepts this year and any plausible past year", () => {
    expect(isValidFoundedYear(2026, NOW)).toBe(true);
    expect(isValidFoundedYear(1998, NOW)).toBe(true);
    expect(isValidFoundedYear(EARLIEST_FOUNDED_YEAR, NOW)).toBe(true);
  });

  it("rejects the future, which would corrupt every tenure figure", () => {
    expect(isValidFoundedYear(2027, NOW)).toBe(false);
    expect(isValidFoundedYear(9999, NOW)).toBe(false);
  });

  it("rejects typos and non-years", () => {
    expect(isValidFoundedYear(202, NOW)).toBe(false);
    expect(isValidFoundedYear(20260, NOW)).toBe(false);
    expect(isValidFoundedYear(2026.5, NOW)).toBe(false);
    expect(isValidFoundedYear(NaN, NOW)).toBe(false);
  });
});

describe("tenureYears", () => {
  it("counts years trading", () => {
    expect(tenureYears(2026, NOW)).toBe(0);
    expect(tenureYears(2025, NOW)).toBe(1);
    expect(tenureYears(2001, NOW)).toBe(25);
  });

  it("is null when unanswered, rather than pretending it is zero", () => {
    // A skipped question is not a business founded this year.
    expect(tenureYears(null, NOW)).toBeNull();
    expect(tenureYears(undefined, NOW)).toBeNull();
  });

  it("is null for an impossible year rather than going negative", () => {
    expect(tenureYears(2030, NOW)).toBeNull();
  });
});

describe("tenureBand", () => {
  it("puts the first year in its own band, where most businesses fail", () => {
    expect(tenureBand(2026, NOW)).toBe("new");
  });

  it("bands the rest by survival odds", () => {
    expect(tenureBand(2025, NOW)).toBe("establishing"); // 1y
    expect(tenureBand(2024, NOW)).toBe("establishing"); // 2y
    expect(tenureBand(2023, NOW)).toBe("established"); // 3y
    expect(tenureBand(2017, NOW)).toBe("established"); // 9y
    expect(tenureBand(2016, NOW)).toBe("institution"); // 10y
    expect(tenureBand(1990, NOW)).toBe("institution");
  });

  it("is null when unanswered, so it never becomes a cohort of its own by accident", () => {
    expect(tenureBand(null, NOW)).toBeNull();
    expect(tenureBand(undefined, NOW)).toBeNull();
  });

  it("has a label for every band", () => {
    for (const band of ["new", "establishing", "established", "institution"] as const) {
      expect(TENURE_LABEL[band].length).toBeGreaterThan(0);
    }
  });
});
