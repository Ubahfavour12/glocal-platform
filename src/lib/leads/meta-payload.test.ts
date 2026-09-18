import { describe, expect, it } from "vitest";
import { parseLeadgenEvents } from "./capture";

/**
 * Meta's ACTUAL leadgen envelope, as documented for the Pages webhook.
 *
 * The unit tests elsewhere use a convenience builder, which means they test the
 * parser against a shape this file invented. That is exactly the gap that lets
 * a parser pass every test and then receive nothing usable in production, so
 * these fixtures are written out in full — nested entry/changes/value, string
 * ids, numeric created_time, and the extra fields Meta sends that we ignore.
 */

const REAL_LEADGEN = {
  object: "page",
  entry: [
    {
      id: "102938475610293",
      time: 1_758_000_000,
      changes: [
        {
          field: "leadgen",
          value: {
            ad_id: "23851234567890123",
            form_id: "1234567890123456",
            leadgen_id: "9876543210987654",
            created_time: 1_758_000_000,
            page_id: "102938475610293",
            adgroup_id: "23851234567890456",
          },
        },
      ],
    },
  ],
};

/** Meta batches several pages, and several changes per page, in one POST. */
const BATCHED = {
  object: "page",
  entry: [
    {
      id: "page_a",
      time: 1_758_000_100,
      changes: [
        { field: "leadgen", value: { leadgen_id: "L_a1", ad_id: "ad_a", created_time: 1_758_000_100 } },
        { field: "leadgen", value: { leadgen_id: "L_a2", ad_id: "ad_a", created_time: 1_758_000_150 } },
      ],
    },
    {
      id: "page_b",
      time: 1_758_000_200,
      changes: [
        { field: "leadgen", value: { leadgen_id: "L_b1", ad_id: "ad_b", created_time: 1_758_000_200 } },
      ],
    },
  ],
};

/** The other subscription that lands on the same endpoint. */
const AD_REVIEW = {
  object: "page",
  entry: [
    {
      id: "102938475610293",
      time: 1_758_000_000,
      changes: [
        {
          field: "ads_rules_engine",
          value: { ad_id: "23851234567890123", effective_status: "DISAPPROVED" },
        },
      ],
    },
  ],
};

describe("Meta's real leadgen envelope", () => {
  it("parses the documented shape end to end", () => {
    const [e] = parseLeadgenEvents(REAL_LEADGEN);
    expect(e.leadgenId).toBe("9876543210987654");
    expect(e.platformAdId).toBe("23851234567890123");
    expect(e.formId).toBe("1234567890123456");
  });

  it("reads created_time as seconds, giving a sane date", () => {
    // The single most likely silent failure: treating Meta's seconds as
    // milliseconds dates every lead to 1970 and empties "leads this week".
    const [e] = parseLeadgenEvents(REAL_LEADGEN);
    expect(e.createdAt.getUTCFullYear()).toBe(2025);
    expect(e.createdAt.getTime()).toBe(1_758_000_000_000);
  });

  it("handles a batch across several pages and several leads", () => {
    const events = parseLeadgenEvents(BATCHED);
    expect(events.map((e) => e.leadgenId)).toEqual(["L_a1", "L_a2", "L_b1"]);
  });

  it("returns nothing for an ad-review delivery", () => {
    // Both arrive at one callback URL. Misreading one as the other would
    // create phantom leads out of rejection notices.
    expect(parseLeadgenEvents(AD_REVIEW)).toHaveLength(0);
  });

  it("keeps leads when a leadgen change sits beside an ad-review change", () => {
    const mixed = {
      object: "page",
      entry: [
        {
          id: "p",
          time: 1,
          changes: [
            AD_REVIEW.entry[0].changes[0],
            { field: "leadgen", value: { leadgen_id: "L_mixed", created_time: 1_758_000_000 } },
          ],
        },
      ],
    };
    const events = parseLeadgenEvents(mixed);
    expect(events).toHaveLength(1);
    expect(events[0].leadgenId).toBe("L_mixed");
  });

  it("tolerates a leadgen value missing the optional ids", () => {
    // Organic lead forms carry no ad_id at all.
    const [e] = parseLeadgenEvents({
      object: "page",
      entry: [{ id: "p", time: 1, changes: [{ field: "leadgen", value: { leadgen_id: "L" } }] }],
    });
    expect(e.platformAdId).toBeNull();
    expect(e.formId).toBeNull();
  });
});
