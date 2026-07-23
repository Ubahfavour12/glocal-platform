import { describe, expect, it } from "vitest";
import { kindFromFilename, mediaStoragePath } from "./storage";

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
