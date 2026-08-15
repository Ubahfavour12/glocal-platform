import { describe, expect, it } from "vitest";
import {
  budgetAdvice,
  countryFromLocale,
  countryFromPhone,
  goalDoorMismatch,
  inferCountry,
  OTHER_TRADE,
  TRADES,
} from "./inference";

describe("countryFromLocale", () => {
  it("reads the region subtag", () => {
    expect(countryFromLocale("en-NG")).toBe("NG");
    expect(countryFromLocale("en_GB")).toBe("GB");
  });

  it("ignores regions we cannot show a currency for", () => {
    expect(countryFromLocale("fr-BJ")).toBeNull();
  });

  it("survives a language-only tag", () => {
    expect(countryFromLocale("en")).toBeNull();
    expect(countryFromLocale(null)).toBeNull();
  });
});

describe("countryFromPhone", () => {
  it("reads the dialling code", () => {
    expect(countryFromPhone("+234 802 555 0117")).toBe("NG");
    expect(countryFromPhone("+233 24 123 4567")).toBe("GH");
  });

  it("does not read +234 as +2", () => {
    // Longest-code-first matching. A naive scan would return the wrong market
    // and then quietly target the wrong country.
    expect(countryFromPhone("+2348025550117")).toBe("NG");
  });

  it("stays undecided when a code is shared", () => {
    // +1 is the US and Canada. Guessing would be worse than asking.
    expect(countryFromPhone("+1 415 555 0134")).toBeNull();
  });

  it("needs an international prefix", () => {
    expect(countryFromPhone("08025550117")).toBeNull();
    expect(countryFromPhone("")).toBeNull();
  });
});

describe("inferCountry", () => {
  it("trusts the number they typed over where the handset is", () => {
    // A Nigerian owner travelling, or a phone sold with a foreign locale.
    expect(inferCountry({ phone: "+233 24 123 4567", timeZone: "Africa/Lagos" })).toBe("GH");
  });

  it("uses the timezone before the language", () => {
    // Plenty of Lagos handsets ship reporting en-US; almost none report a
    // New York timezone.
    expect(inferCountry({ timeZone: "Africa/Lagos", locale: "en-US" })).toBe("NG");
  });

  it("falls back to the language when there is no timezone", () => {
    expect(inferCountry({ locale: "en-GB" })).toBe("GB");
  });

  it("falls back to the first market when everything is silent", () => {
    expect(inferCountry({})).toBe("NG");
  });
});

describe("TRADES", () => {
  it("is short enough to read without scrolling and has an escape hatch", () => {
    expect(TRADES.length).toBe(8);
    expect(TRADES).toContain(OTHER_TRADE);
  });
});

describe("goalDoorMismatch", () => {
  it("says nothing when the goal is countable through the door", () => {
    expect(goalDoorMismatch("whatsapp", "whatsapp")).toBeNull();
    expect(goalDoorMismatch("sales", "store")).toBeNull();
    expect(goalDoorMismatch("leads", "link")).toBeNull();
  });

  it("flags footfall behind a WhatsApp number", () => {
    const m = goalDoorMismatch("visits", "whatsapp");
    expect(m).toMatch(/can't count someone walking through your door/);
  });

  it("still warns about footfall behind any other door", () => {
    expect(goalDoorMismatch("visits", "link")).toMatch(/who actually arrived/);
  });

  it("explains that sales off-store need the owner to confirm them", () => {
    expect(goalDoorMismatch("sales", "whatsapp")).toMatch(/tell me they happened/);
    expect(goalDoorMismatch("sales", "link")).toMatch(/connect a store/);
  });

  it("flags wanting conversations without a chat door", () => {
    expect(goalDoorMismatch("whatsapp", "link")).toMatch(/don't open one/);
  });
});

describe("budgetAdvice", () => {
  it("promises one challenger at the floor, not two", () => {
    // The real duel maths: at $10/day a smart persona funds exactly one.
    expect(budgetAdvice(1_000)).toMatch(/one challenger against your champion/);
  });

  it("promises two once they can both be funded", () => {
    expect(budgetAdvice(2_000)).toMatch(/two challengers/);
  });

  it("stops promising more certainty at the top of the range", () => {
    expect(budgetAdvice(10_000)).toMatch(/buys speed, not certainty/);
  });

  it("quotes the amount back in the agent's voice", () => {
    expect(budgetAdvice(3_500)).toMatch(/\$35 a day/);
  });
});
