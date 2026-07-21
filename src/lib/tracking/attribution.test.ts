import { describe, expect, it } from "vitest";
import {
  buildWhatsappPrefill,
  extractRefCode,
  preferenceCommentary,
  productPreferences,
  revenueByCode,
  validateOrder,
  type AttributedOrder,
} from "./attribution";

const at = new Date("2026-07-21T12:00:00Z");
const order = (over: Partial<AttributedOrder>): AttributedOrder => ({
  code: "GL-7K4",
  codeSource: "message",
  valueUsdMinor: 10_000,
  source: "manual",
  at,
  ...over,
});

describe("WhatsApp ref codes", () => {
  it("prefill carries the code in a buyer-natural sentence", () => {
    const text = buildWhatsappPrefill("GL-7K4", "the gold bracelet");
    expect(text).toContain("(ref GL-7K4)");
    expect(text).toMatch(/gold bracelet/);
  });

  it("extracts the code back from a received message", () => {
    expect(extractRefCode("Hi! I saw your ad and I'm interested. (ref GL-7K4)")).toBe("GL-7K4");
  });

  it("returns null when a buyer typed their own message", () => {
    expect(extractRefCode("Good evening, how much is the bracelet?")).toBeNull();
    expect(extractRefCode("")).toBeNull();
  });
});

describe("validateOrder — whole orders, not single units", () => {
  it("accepts a plain total-only sale", () => {
    expect(validateOrder(order({}))).toEqual([]);
  });

  it("accepts a multi-product, multi-quantity order", () => {
    const o = order({
      valueUsdMinor: 35_000,
      quantity: 4,
      items: [
        { name: "Gold bracelet", qty: 3, unitValueUsdMinor: 10_000 },
        { name: "Silver ring", qty: 1, unitValueUsdMinor: 5_000 },
      ],
    });
    expect(validateOrder(o)).toEqual([]);
  });

  it("catches quantity that disagrees with items", () => {
    const o = order({
      quantity: 5,
      items: [{ name: "Gold bracelet", qty: 3 }],
    });
    expect(validateOrder(o).join(" ")).toMatch(/does not match/);
  });

  it("rejects zero/negative values and nameless items", () => {
    expect(validateOrder(order({ valueUsdMinor: 0 }))).not.toEqual([]);
    expect(validateOrder(order({ items: [{ name: " ", qty: 1 }] }))).not.toEqual([]);
  });

  it("unattributed sale (repeat customer) is VALID with no code", () => {
    expect(validateOrder(order({ code: null, codeSource: "none" }))).toEqual([]);
  });

  it("seller-picked attribution is valid with a code", () => {
    expect(validateOrder(order({ codeSource: "seller_pick" }))).toEqual([]);
  });

  it("rejects contradictions: none+code, message without code", () => {
    expect(validateOrder(order({ codeSource: "none" })).join(" ")).toMatch(/must not carry/);
    expect(validateOrder(order({ code: null, codeSource: "message" })).join(" ")).toMatch(
      /code is missing/,
    );
  });
});

describe("revenueByCode", () => {
  it("sums FULL order values per ad code", () => {
    const m = revenueByCode([
      order({ code: "A", valueUsdMinor: 10_000 }),
      order({ code: "A", valueUsdMinor: 25_000 }),
      order({ code: "B", valueUsdMinor: 5_000 }),
    ]);
    expect(m.get("A")).toBe(35_000);
    expect(m.get("B")).toBe(5_000);
  });

  it("unattributed sales never vote in duels", () => {
    const m = revenueByCode([
      order({ code: "A", valueUsdMinor: 10_000 }),
      order({ code: null, codeSource: "none", valueUsdMinor: 999_999 }),
    ]);
    expect(m.get("A")).toBe(10_000);
    expect(m.size).toBe(1);
  });
});

describe("productPreferences — learning what buyers actually want", () => {
  const orders: AttributedOrder[] = [
    order({
      valueUsdMinor: 30_000,
      items: [{ name: "Gold Bracelet", qty: 3, unitValueUsdMinor: 10_000 }],
    }),
    order({
      valueUsdMinor: 15_000,
      items: [
        { name: "gold bracelet", qty: 1, unitValueUsdMinor: 10_000 },
        { name: "Silver Ring", qty: 1, unitValueUsdMinor: 5_000 },
      ],
    }),
    order({ valueUsdMinor: 5_000, items: [{ name: "Silver Ring", qty: 1 }] }),
  ];

  it("aggregates case-insensitively and ranks by revenue", () => {
    const prefs = productPreferences(orders);
    expect(prefs[0].name.toLowerCase()).toBe("gold bracelet");
    expect(prefs[0].units).toBe(4);
    expect(prefs[0].revenueUsdMinor).toBe(40_000);
    expect(prefs[1].name).toBe("Silver Ring");
    expect(prefs[1].revenueUsdMinor).toBe(10_000);
  });

  it("apportions order value by units when unit prices are missing", () => {
    const prefs = productPreferences([
      order({
        valueUsdMinor: 9_000,
        items: [
          { name: "A", qty: 2 },
          { name: "B", qty: 1 },
        ],
      }),
    ]);
    expect(prefs.find((p) => p.name === "A")!.revenueUsdMinor).toBe(6_000);
    expect(prefs.find((p) => p.name === "B")!.revenueUsdMinor).toBe(3_000);
  });

  it("orders without item detail don't distort preference", () => {
    const prefs = productPreferences([order({ valueUsdMinor: 999_999 })]);
    expect(prefs).toEqual([]);
  });

  it("preference commentary appears only when the signal is strong", () => {
    const strong = preferenceCommentary(productPreferences(orders));
    expect(strong).toMatch(/Gold Bracelet/i);
    expect(strong).toMatch(/80%/);
    const thin = preferenceCommentary(
      productPreferences([order({ valueUsdMinor: 5_000, items: [{ name: "A", qty: 1 }] })]),
    );
    expect(thin).toBeNull();
  });
});
