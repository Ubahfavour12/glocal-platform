import { describe, expect, it } from "vitest";
import { buildPostPayload, normalizeNetworks, type OrganicPost } from "./client";

describe("normalizeNetworks", () => {
  it("keeps supported networks, lower-cases, de-dupes", () => {
    expect(normalizeNetworks(["Instagram", "FACEBOOK", "instagram", "myspace"])).toEqual([
      "instagram",
      "facebook",
    ]);
  });
  it("drops everything unsupported", () => {
    expect(normalizeNetworks(["myspace", "bebo"])).toEqual([]);
  });
});

describe("buildPostPayload", () => {
  const post: OrganicPost = {
    text: "  New season styles just landed  ",
    mediaUrls: ["https://cdn/x.jpg", "not-a-url"],
    networks: ["instagram", "facebook"],
  };

  it("builds the schedule body, trims text, filters non-URL media", () => {
    const body = buildPostPayload(post, "2026-07-24T09:00:00.000Z");
    expect(body.text).toBe("New season styles just landed");
    expect(body.providers).toEqual([{ network: "instagram" }, { network: "facebook" }]);
    expect(body.media).toEqual(["https://cdn/x.jpg"]); // non-URL dropped
    expect(body.publicationDate.dateTime).toBe("2026-07-24T09:00:00.000Z");
    expect(body.autoPublish).toBe(true);
  });

  it("rejects empty text or no networks", () => {
    expect(() => buildPostPayload({ ...post, text: "   " }, "t")).toThrow(/text is empty/);
    expect(() => buildPostPayload({ ...post, networks: [] }, "t")).toThrow(/no networks/);
  });
});
