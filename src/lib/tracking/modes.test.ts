import { describe, expect, it } from "vitest";
import {
  destinationUrl,
  intentActionsForMode,
  normalizeWhatsappPhone,
  trackingPlanForMode,
  verdictSignalForMode,
} from "./modes";

describe("verdictSignalForMode", () => {
  it("store feeds ROAS, everything else feeds CPCI", () => {
    expect(verdictSignalForMode("store")).toBe("roas");
    expect(verdictSignalForMode("website")).toBe("cpci");
    expect(verdictSignalForMode("whatsapp")).toBe("cpci");
  });
});

describe("intentActionsForMode", () => {
  it("whatsapp counts only messaging conversations", () => {
    const actions = intentActionsForMode("whatsapp");
    expect(actions).toContain("onsite_conversion.messaging_conversation_started_7d");
    expect(actions).not.toContain("link_click");
  });

  it("website counts link clicks and landing views, not messaging", () => {
    const actions = intentActionsForMode("website");
    expect(actions).toContain("link_click");
    expect(actions).toContain("landing_page_view");
    expect(actions).not.toContain("onsite_conversion.messaging_conversation_started_7d");
  });
});

describe("normalizeWhatsappPhone", () => {
  it("accepts international format with +", () => {
    expect(normalizeWhatsappPhone("+234 913 371 2092")).toBe("2349133712092");
  });

  it("accepts 00 international prefix", () => {
    expect(normalizeWhatsappPhone("002349133712092")).toBe("2349133712092");
  });

  it("converts local leading-0 format when a country code is given", () => {
    expect(normalizeWhatsappPhone("09133712092", "234")).toBe("2349133712092");
  });

  it("strips spaces, dashes, parentheses, dots", () => {
    expect(normalizeWhatsappPhone("(234) 913-371.2092")).toBe("2349133712092");
  });

  it("rejects garbage and too-short numbers", () => {
    expect(() => normalizeWhatsappPhone("hello")).toThrow(/invalid/);
    expect(() => normalizeWhatsappPhone("123")).toThrow(/invalid/);
  });
});

describe("destinationUrl", () => {
  it("whatsapp mode builds a wa.me deep link", () => {
    expect(destinationUrl("whatsapp", "+2349133712092")).toBe("https://wa.me/2349133712092");
  });

  it("whatsapp mode can prefill the first message", () => {
    const url = destinationUrl("whatsapp", "+2349133712092", {
      prefillText: "Hi, I saw your ad",
    });
    expect(url).toContain("wa.me/2349133712092");
    expect(url).toContain("text=Hi");
  });

  it("website mode adds https when the scheme is missing", () => {
    expect(destinationUrl("website", "myshop.ng/products")).toBe("https://myshop.ng/products");
  });

  it("website mode upgrades http to https", () => {
    expect(destinationUrl("website", "http://myshop.ng")).toBe("https://myshop.ng/");
  });

  it("store mode behaves like website for the link itself", () => {
    expect(destinationUrl("store", "mystore.myshopify.com")).toBe(
      "https://mystore.myshopify.com/",
    );
  });

  it("rejects empty and garbage destinations", () => {
    expect(() => destinationUrl("website", "")).toThrow(/required/);
    expect(() => destinationUrl("website", "ht!tp:/broken")).toThrow();
  });
});

describe("trackingPlanForMode", () => {
  it("every mode has a plain-language explanation", () => {
    expect(trackingPlanForMode("store")).toMatch(/sales/i);
    expect(trackingPlanForMode("website")).toMatch(/tracked link/i);
    expect(trackingPlanForMode("whatsapp")).toMatch(/conversations|chats/i);
  });
});
