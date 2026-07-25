import { describe, expect, it } from "vitest";
import { buildFacebookParams } from "./publish";

describe("buildFacebookParams", () => {
  it("makes a photo post when an image is present", () => {
    const r = buildFacebookParams({ message: "New drop", imageUrl: "https://cdn/x.jpg" });
    expect(r.endpoint).toBe("photos");
    expect(r.params).toEqual({ url: "https://cdn/x.jpg", caption: "New drop" });
  });

  it("makes a text/link feed post when there is no image", () => {
    const r = buildFacebookParams({ message: "Message us", link: "https://shop.ng" });
    expect(r.endpoint).toBe("feed");
    expect(r.params).toEqual({ message: "Message us", link: "https://shop.ng" });
  });

  it("omits the link when absent", () => {
    const r = buildFacebookParams({ message: "Hello" });
    expect(r.endpoint).toBe("feed");
    expect(r.params).toEqual({ message: "Hello" });
  });
});
