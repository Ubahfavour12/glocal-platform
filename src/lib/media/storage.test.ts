import { describe, expect, it } from "vitest";
import { kindFromFilename, mediaStoragePath, ownedStoragePath } from "./storage";

describe("mediaStoragePath", () => {
  it("builds a business-scoped path with a validated extension", () => {
    expect(mediaStoragePath("biz-1", "Product Shot.JPG", "abc123")).toBe("biz-1/abc123.jpg");
    expect(mediaStoragePath("biz-1", "clip.mp4", "r1")).toBe("biz-1/r1.mp4");
  });

  it("rejects unsupported types", () => {
    expect(() => mediaStoragePath("biz", "malware.exe", "r")).toThrow(/unsupported/);
    expect(() => mediaStoragePath("biz", "noext", "r")).toThrow(/unsupported/);
  });
});

describe("kindFromFilename", () => {
  it("classifies image vs video by extension", () => {
    expect(kindFromFilename("a.png")).toBe("image");
    expect(kindFromFilename("a.webp")).toBe("image");
    expect(kindFromFilename("a.mp4")).toBe("video");
    expect(kindFromFilename("a.MOV")).toBe("video");
  });
});

describe("ownedStoragePath", () => {
  const biz = "0b0e8a52-6f0a-4f3e-9d57-2f1a1c9d7e11";

  it("accepts exactly what upload produces", () => {
    const path = `${biz}/3f2b9c1e-8a4d-4c6f-b1e2-9a7c5d3e1f00.jpg`;
    expect(ownedStoragePath(biz, path)).toBe(path);
  });

  it("refuses a file in another business's folder", () => {
    // The whole point: the row is written by the customer, so a path naming
    // somebody else's folder must never become a URL we hand to a renderer.
    expect(ownedStoragePath(biz, "11111111-1111-4111-8111-111111111111/a.jpg")).toBeNull();
  });

  it("refuses anything that could climb out of the folder", () => {
    expect(ownedStoragePath(biz, `${biz}/../other/a.jpg`)).toBeNull();
    expect(ownedStoragePath(biz, `${biz}/sub/a.jpg`)).toBeNull();
    expect(ownedStoragePath(biz, `${biz}/a.jpg?x=1`)).toBeNull();
    expect(ownedStoragePath(biz, `${biz}/a.jpg#frag`)).toBeNull();
    expect(ownedStoragePath(biz, `${biz}/%2e%2e%2fa.jpg`)).toBeNull();
  });

  it("refuses a full URL smuggled in as a path", () => {
    expect(ownedStoragePath(biz, "https://evil.example/a.jpg")).toBeNull();
    expect(ownedStoragePath(biz, `${biz}/https://evil.example/a.jpg`)).toBeNull();
  });

  it("refuses a type upload would never have stored", () => {
    expect(ownedStoragePath(biz, `${biz}/a.svg`)).toBeNull();
    expect(ownedStoragePath(biz, `${biz}/a.html`)).toBeNull();
    expect(ownedStoragePath(biz, `${biz}/noext`)).toBeNull();
  });

  it("treats a missing path as no path", () => {
    expect(ownedStoragePath(biz, null)).toBeNull();
    expect(ownedStoragePath(biz, "")).toBeNull();
  });
});
