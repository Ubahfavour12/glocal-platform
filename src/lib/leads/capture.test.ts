import { describe, expect, it } from "vitest";
import { dedupeKey, deriveLabel, parseLeadgenEvents, type LeadField } from "./capture";

const webhook = (changes: unknown[]) => ({ object: "page", entry: [{ id: "p1", changes }] });
const leadgen = (value: Record<string, unknown>) => ({ field: "leadgen", value });

describe("parseLeadgenEvents", () => {
  it("pulls a lead out of a webhook", () => {
    const events = parseLeadgenEvents(
      webhook([leadgen({ leadgen_id: "L1", form_id: "F1", ad_id: "A1", created_time: 1_700_000_000 })]),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ leadgenId: "L1", formId: "F1", platformAdId: "A1" });
  });

  it("converts Meta's seconds to milliseconds", () => {
    // Getting this wrong dates every lead to 1970 and silently breaks
    // "leads this week", which is the whole weekly review.
    const [e] = parseLeadgenEvents(webhook([leadgen({ leadgen_id: "L1", created_time: 1_700_000_000 })]));
    expect(e.createdAt.getUTCFullYear()).toBe(2023);
  });

  it("ignores ad-review events on the same endpoint", () => {
    // Both event types arrive at one callback URL.
    expect(
      parseLeadgenEvents(webhook([{ field: "ads_rules_engine", value: { ad_id: "A1" } }])),
    ).toHaveLength(0);
  });

  it("keeps the good leads when one entry is malformed", () => {
    // A throw here would drop a customer's real lead on the floor.
    const events = parseLeadgenEvents(
      webhook([leadgen({ nothing: true }), leadgen({ leadgen_id: "L2" })]),
    );
    expect(events).toHaveLength(1);
    expect(events[0].leadgenId).toBe("L2");
  });

  it("survives junk without throwing", () => {
    expect(parseLeadgenEvents(null)).toEqual([]);
    expect(parseLeadgenEvents({})).toEqual([]);
    expect(parseLeadgenEvents({ entry: "not an array" })).toEqual([]);
    expect(parseLeadgenEvents({ entry: [{ changes: "nope" }] })).toEqual([]);
  });

  it("handles an organic form with no ad", () => {
    const [e] = parseLeadgenEvents(webhook([leadgen({ leadgen_id: "L1" })]));
    expect(e.platformAdId).toBeNull();
  });
});

describe("deriveLabel — this is the data-minimisation boundary", () => {
  const f = (name: string, value: string): LeadField => ({ name, values: [value] });

  it("keeps a first name and the last four digits", () => {
    expect(deriveLabel([f("full_name", "Ada Okoro"), f("phone_number", "+234 801 234 7391")])).toBe(
      "Ada ••7391",
    );
  });

  it("DROPS the surname", () => {
    // A full name plus a phone fragment starts becoming identifying again, and
    // the surname adds nothing for someone reviewing their own week's leads.
    const label = deriveLabel([f("full_name", "Ada Okoro"), f("phone_number", "08012347391")]);
    expect(label).not.toContain("Okoro");
  });

  it("NEVER includes the full phone number", () => {
    const label = deriveLabel([f("full_name", "Ada"), f("phone_number", "+2348012347391")]);
    expect(label).not.toContain("8012347391");
    expect(label).toContain("7391");
  });

  it("never includes an email address", () => {
    // Email is not in the label at all — it is the most directly identifying
    // field the form collects and the most useful to an attacker.
    const label = deriveLabel([
      f("email", "ada@example.com"),
      f("full_name", "Ada"),
      f("phone_number", "08012347391"),
    ]);
    expect(label).not.toContain("@");
    expect(label).not.toContain("example.com");
  });

  it("ignores phone formatting, so the same person labels the same way", () => {
    expect(deriveLabel([f("full_name", "Ada"), f("phone_number", "+234-801-234-7391")])).toBe(
      deriveLabel([f("full_name", "Ada"), f("phone_number", "0801 234 7391")]),
    );
  });

  it("falls back to the name alone when there is no phone", () => {
    expect(deriveLabel([f("first_name", "Chidi")])).toBe("Chidi");
  });

  it("falls back to digits alone when there is no name", () => {
    expect(deriveLabel([f("phone_number", "08012341180")])).toBe("••1180");
  });

  it("returns something usable when the form gave nothing", () => {
    // A blank row in the weekly review is worse than an unhelpful one: the
    // owner still needs to be able to mark it won or lost.
    expect(deriveLabel([])).toBe("Lead");
    expect(deriveLabel([f("full_name", "   ")])).toBe("Lead");
  });
});

describe("dedupeKey", () => {
  it("is stable across Meta's retries", () => {
    // Meta retries until it gets a 200. Without this a retry duplicates the
    // lead, which inflates cost-per-won and sends budget to the wrong ad.
    const e = { leadgenId: "L1", formId: null, platformAdId: null, createdAt: new Date() };
    expect(dedupeKey(e)).toBe(dedupeKey({ ...e, createdAt: new Date(0) }));
  });

  it("is namespaced, so a Meta id cannot collide with another source", () => {
    expect(dedupeKey({ leadgenId: "1", formId: null, platformAdId: null, createdAt: new Date() })).toBe(
      "meta:1",
    );
  });
});
