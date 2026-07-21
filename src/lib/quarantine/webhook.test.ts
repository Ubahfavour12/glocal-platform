import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseAdRejections, verifyMetaSignature } from "./webhook";

const SECRET = "test_app_secret";
const sign = (body: string) =>
  `sha256=${createHmac("sha256", SECRET).update(body, "utf8").digest("hex")}`;

describe("verifyMetaSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ object: "ad_account", entry: [] });
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ object: "ad_account", entry: [] });
    expect(verifyMetaSignature(body + "x", sign(body), SECRET)).toBe(false);
  });

  it("rejects missing header or secret", () => {
    const body = "{}";
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body), "")).toBe(false);
  });
});

describe("parseAdRejections", () => {
  it("extracts a DISAPPROVED ad with review feedback", () => {
    const events = parseAdRejections({
      object: "ad_account",
      entry: [
        {
          id: "act_1",
          changes: [
            {
              field: "ads",
              value: {
                ad_id: "1203986",
                effective_status: "DISAPPROVED",
                review_feedback: { "Personal Health": "Ad promotes unrealistic outcomes" },
              },
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].platformAdId).toBe("1203986");
    expect(events[0].reason).toMatch(/Personal Health/);
    expect(events[0].reason).toMatch(/unrealistic/);
  });

  it("extracts with_issues_ad_objects events by ad_object_id", () => {
    const events = parseAdRejections({
      entry: [
        {
          changes: [
            {
              field: "with_issues_ad_objects",
              value: { ad_object_id: 777, reason: "Text overlay too large" },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([{ platformAdId: "777", reason: "Text overlay too large" }]);
  });

  it("ignores healthy ads and junk payloads", () => {
    expect(
      parseAdRejections({
        entry: [{ changes: [{ field: "ads", value: { ad_id: "1", effective_status: "ACTIVE" } }] }],
      }),
    ).toEqual([]);
    expect(parseAdRejections(null)).toEqual([]);
    expect(parseAdRejections({})).toEqual([]);
    expect(parseAdRejections({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });

  it("drops rejected events with no ad id rather than crashing", () => {
    const events = parseAdRejections({
      entry: [{ changes: [{ field: "ads", value: { effective_status: "DISAPPROVED" } }] }],
    });
    expect(events).toEqual([]);
  });
});
