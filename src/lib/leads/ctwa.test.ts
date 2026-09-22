import { describe, expect, it } from "vitest";
import { ctwaDedupeKey, ctwaLabel, parseCtwaLeads, type CtwaLead } from "./ctwa";

/** The Cloud API inbound-message envelope, as Meta documents it. */
const inbound = (message: Record<string, unknown>, contacts?: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "2348012345678", phone_number_id: "PNID1" },
            contacts: contacts ?? [{ profile: { name: "Ada Okoro" }, wa_id: "2348012347391" }],
            messages: [message],
          },
        },
      ],
    },
  ],
});

const referred = {
  from: "2348012347391",
  id: "wamid.ABC",
  timestamp: "1758000000",
  type: "text",
  text: { body: "Hi, how much?" },
  referral: {
    source_url: "https://fb.me/x",
    source_id: "23851234567890123",
    source_type: "ad",
    headline: "Half price today",
    ctwa_clid: "ARAaBBccDD11223344",
  },
};

describe("parseCtwaLeads", () => {
  it("reads Meta's click id and the ad behind it", () => {
    const [l] = parseCtwaLeads(inbound(referred));
    expect(l.ctwaClid).toBe("ARAaBBccDD11223344");
    expect(l.platformAdId).toBe("23851234567890123");
    expect(l.waId).toBe("2348012347391");
    expect(l.profileName).toBe("Ada Okoro");
  });

  it("IGNORES an ordinary message with no referral", () => {
    // The critical negative. Every inbound message is not a lead: regular
    // customers, suppliers and wrong numbers all arrive here, and turning
    // those into leads is the same mistake as counting a link tap.
    const plain = { from: "2348011112222", id: "wamid.X", timestamp: "1758000000", type: "text" };
    expect(parseCtwaLeads(inbound(plain))).toHaveLength(0);
  });

  it("ignores a referral that carries no click id", () => {
    const noClid = { ...referred, referral: { source_id: "ad1", source_type: "ad" } };
    expect(parseCtwaLeads(inbound(noClid))).toHaveLength(0);
  });

  it("reads the timestamp as seconds", () => {
    // As a string, and in seconds. Treating it as milliseconds dates every
    // lead to 1970 and silently empties "leads this week".
    const [l] = parseCtwaLeads(inbound(referred));
    expect(l.receivedAt.getTime()).toBe(1_758_000_000_000);
    expect(l.receivedAt.getUTCFullYear()).toBe(2025);
  });

  it("copes with a sender who has no profile name set", () => {
    const [l] = parseCtwaLeads(inbound(referred, [{ wa_id: "2348012347391" }]));
    expect(l.profileName).toBeNull();
  });

  it("does not confuse two senders' profile names", () => {
    const [l] = parseCtwaLeads(
      inbound(referred, [
        { profile: { name: "Someone Else" }, wa_id: "2340000000000" },
        { profile: { name: "Ada Okoro" }, wa_id: "2348012347391" },
      ]),
    );
    expect(l.profileName).toBe("Ada Okoro");
  });

  it("ignores status callbacks and other fields on the same endpoint", () => {
    const statuses = {
      object: "whatsapp_business_account",
      entry: [{ id: "W", changes: [{ field: "statuses", value: { statuses: [{ id: "x" }] } }] }],
    };
    expect(parseCtwaLeads(statuses)).toHaveLength(0);
  });

  it("survives junk without throwing", () => {
    expect(parseCtwaLeads(null)).toEqual([]);
    expect(parseCtwaLeads({ entry: "no" })).toEqual([]);
    expect(parseCtwaLeads({ entry: [{ changes: [{ field: "messages", value: {} }] }] })).toEqual([]);
  });
});

describe("ctwaLabel — same minimisation rule as lead forms", () => {
  const lead = (over: Partial<CtwaLead> = {}): CtwaLead => ({
    waId: "2348012347391",
    profileName: "Ada Okoro",
    ctwaClid: "C1",
    platformAdId: "A1",
    toPhoneNumberId: "P1",
    receivedAt: new Date(),
    ...over,
  });

  it("keeps a first name and four digits", () => {
    expect(ctwaLabel(lead())).toBe("Ada ••7391");
  });

  it("NEVER stores the full number", () => {
    const label = ctwaLabel(lead());
    expect(label).not.toContain("2348012347391");
    expect(label).toContain("7391");
  });

  it("drops the surname", () => {
    expect(ctwaLabel(lead())).not.toContain("Okoro");
  });

  it("still labels someone with no profile name", () => {
    expect(ctwaLabel(lead({ profileName: null }))).toBe("••7391");
  });
});

describe("ctwaDedupeKey", () => {
  it("uses Meta's click id, which is unique per ad tap", () => {
    const l = { ctwaClid: "XYZ" } as CtwaLead;
    expect(ctwaDedupeKey(l)).toBe("ctwa:XYZ");
  });

  it("is namespaced apart from lead-form ids", () => {
    // Two different webhooks, two id spaces; assuming they never collide is
    // an assumption with no upside.
    expect(ctwaDedupeKey({ ctwaClid: "1" } as CtwaLead)).not.toBe("meta:1");
  });
});
