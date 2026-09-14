import { describe, expect, it } from "vitest";
import { ALLOWED, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, extensionOf, validateUpload } from "./validate";

const f = (name: string, size = 1000) => ({ name, size });

describe("what may be uploaded", () => {
  it("accepts the ordinary photo and video formats", () => {
    for (const name of ["a.jpg", "a.JPEG", "a.png", "a.webp", "a.mp4", "a.MOV", "a.webm"]) {
      expect(validateUpload(f(name)).ok, name).toBe(true);
    }
  });

  it("REFUSES SVG, which is an image that can run scripts", () => {
    // The bucket is public. An SVG with a <script> inside, served from our
    // domain at a stable URL, is stored XSS wearing a picture's clothes.
    expect(ALLOWED.svg).toBeUndefined();
    expect(validateUpload(f("logo.svg"))).toMatchObject({ ok: false, reason: "type" });
  });

  it("refuses executables and markup", () => {
    for (const name of ["shell.php", "x.jsp", "page.html", "s.js", "doc.pdf"]) {
      expect(validateUpload(f(name)), name).toMatchObject({ ok: false, reason: "type" });
    }
  });

  it("refuses a file with no extension at all", () => {
    expect(validateUpload(f("README"))).toMatchObject({ ok: false, reason: "type" });
  });

  it("is decided by the LAST segment, as a server serving it would be", () => {
    expect(validateUpload(f("photo.png.php"))).toMatchObject({ ok: false, reason: "type" });
    expect(validateUpload(f("photo.php.png")).ok).toBe(true);
  });
});

describe("content type is derived, never taken from the client", () => {
  it("maps each extension to the type it will be served as", () => {
    expect(validateUpload(f("a.png"))).toMatchObject({ contentType: "image/png" });
    expect(validateUpload(f("a.jpg"))).toMatchObject({ contentType: "image/jpeg" });
    expect(validateUpload(f("a.mov"))).toMatchObject({ contentType: "video/quicktime" });
  });

  it("never yields a type that a browser would execute", () => {
    for (const v of Object.values(ALLOWED)) {
      expect(v.contentType).not.toMatch(/html|javascript|svg/);
    }
  });
});

describe("size limits", () => {
  it("refuses an image over the image cap", () => {
    expect(validateUpload(f("a.png", MAX_IMAGE_BYTES + 1))).toMatchObject({
      ok: false,
      reason: "size",
    });
  });

  it("allows a video larger than the image cap, up to the video cap", () => {
    expect(validateUpload(f("a.mp4", MAX_IMAGE_BYTES + 1)).ok).toBe(true);
    expect(validateUpload(f("a.mp4", MAX_VIDEO_BYTES + 1))).toMatchObject({ reason: "size" });
  });

  it("accepts a file exactly at the cap", () => {
    expect(validateUpload(f("a.png", MAX_IMAGE_BYTES)).ok).toBe(true);
  });

  it("refuses an empty file", () => {
    expect(validateUpload(f("a.png", 0))).toMatchObject({ ok: false, reason: "empty" });
  });

  it("says the limit in megabytes, because bytes are not actionable", () => {
    const r = validateUpload(f("a.png", MAX_IMAGE_BYTES * 3));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/MB/);
  });
});

describe("extensionOf", () => {
  it("lowercases and takes the final segment", () => {
    expect(extensionOf("Holiday.JPG")).toBe("jpg");
    expect(extensionOf("a.b.c.png")).toBe("png");
  });
  it("returns empty for a name with no dot", () => {
    expect(extensionOf("noextension")).toBe("");
  });
});
