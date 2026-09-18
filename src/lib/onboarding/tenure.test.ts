import { describe, expect, it } from "vitest";
import {
  EARLIEST_FOUNDED_YEAR,
  isValidFoundedYear,
  TENURE_LABEL,
  tenureBand,
  tenureYears,
  tenureGuidance,
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

describe("tenureGuidance — what the ad writer is told", () => {
  const now = new Date("2026-09-20T00:00:00Z");

  it("says nothing at all when the year was not given", () => {
    // A model told "tenure unknown" writes around the uncertainty, which is
    // worse than never raising it.
    expect(tenureGuidance(null, now)).toBe("");
    expect(tenureGuidance(undefined, now)).toBe("");
  });

  it("forbids a new business from implying a track record", () => {
    // The honesty rule that also keeps ad accounts unbanned.
    const g = tenureGuidance(2026, now);
    expect(g).toContain("Do NOT imply a track record");
  });

  it("tells a long-standing business to lead with its age", () => {
    const g = tenureGuidance(2005, now);
    expect(g).toContain("21 years");
    expect(g.toLowerCase()).toContain("longevity");
  });

  it("gets the singular year right", () => {
    expect(tenureGuidance(2025, now)).toContain("trading 1 year (");
  });

  it("says 'less than a year' rather than '0 years'", () => {
    expect(tenureGuidance(2026, now)).toContain("less than a year");
  });

  it("ignores an impossible future year rather than trusting it", () => {
    // Accepting it would quietly corrupt every tenure figure derived from it.
    expect(tenureGuidance(2030, now)).toBe("");
  });
});
