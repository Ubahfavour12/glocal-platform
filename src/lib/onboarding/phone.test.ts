import { describe, expect, it } from "vitest";
import { checkWhatsApp, stripTrunkPrefix, waMeLink } from "./phone";

describe("stripTrunkPrefix", () => {
  it("drops the leading zero people actually type", () => {
    // "0802 555 0117" behind a fixed +234 chip would become +2340802...,
    // which is not a number. The field is wrong, not the owner.
    expect(stripTrunkPrefix("0802 555 0117", "NG")).toBe("8025550117");
  });

  it("drops a country code typed on top of the chip", () => {
    expect(stripTrunkPrefix("+234 802 555 0117", "NG")).toBe("8025550117");
    expect(stripTrunkPrefix("234 802 555 0117", "NG")).toBe("8025550117");
  });

  it("leaves an already-clean number alone", () => {
    expect(stripTrunkPrefix("802 555 0117", "NG")).toBe("8025550117");
  });

  it("strips punctuation people paste in from contacts", () => {
    expect(stripTrunkPrefix("(0802)-555-0117", "NG")).toBe("8025550117");
  });
});

describe("checkWhatsApp", () => {
  it("says nothing about an empty field", () => {
    // Nobody should be told off for not having typed yet.
    expect(checkWhatsApp("", "NG").problem).toBeNull();
    expect(checkWhatsApp("   ", "NG").valid).toBe(false);
  });

  it("accepts a Nigerian mobile however it is written", () => {
    for (const form of ["08025550117", "+234 802 555 0117", "234-802-555-0117"]) {
      const c = checkWhatsApp(form, "NG");
      expect(c.valid, form).toBe(true);
      expect(c.e164, form).toBe("+2348025550117");
    }
  });

  it("catches a missing digit, which a length check would let through", () => {
    // This is the bug that spends a week of budget on taps that go nowhere.
    const c = checkWhatsApp("0802 555 011", "NG");
    expect(c.valid).toBe(false);
    expect(c.e164).toBeNull();
  });

  it("rejects a landline, because WhatsApp cannot run on one", () => {
    const c = checkWhatsApp("+234 1 271 2345", "NG");
    expect(c.valid).toBe(false);
    expect(c.problem).toMatch(/mobile line/);
  });

  it("lets an explicitly typed country code beat the guessed country", () => {
    // The country field is inferred from a timezone; a typed +233 is not.
    const c = checkWhatsApp("+233 24 123 4567", "NG");
    expect(c.valid).toBe(true);
    expect(c.country).toBe("GH");
  });

  it("validates the other markets we serve", () => {
    expect(checkWhatsApp("024 123 4567", "GH").e164).toBe("+233241234567");
    expect(checkWhatsApp("0712 345678", "KE").e164).toBe("+254712345678");
    expect(checkWhatsApp("07400 123456", "GB").e164).toBe("+447400123456");
  });

  it("never returns an e164 it did not fully validate", () => {
    // The stored value feeds the live ad link, so a half-checked number must
    // never make it out of here.
    for (const bad of ["12", "abc", "+999 000", "0802 555 011"]) {
      expect(checkWhatsApp(bad, "NG").e164, bad).toBeNull();
    }
  });
});

describe("waMeLink", () => {
  it("builds the exact link an ad would use", () => {
    expect(waMeLink("+2348025550117")).toBe("https://wa.me/2348025550117");
  });

  it("carries a prefilled message", () => {
    expect(waMeLink("+2348025550117", "Test from Glocal")).toBe(
      "https://wa.me/2348025550117?text=Test%20from%20Glocal",
    );
  });
});
