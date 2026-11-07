import { describe, expect, it } from "vitest";
import { pickDraft, type DraftLike } from "./draft";

interface D extends DraftLike {
  name: string;
}
const d = (name: string, ownerId: string | null, savedAt: string): D => ({
  name,
  ownerId,
  savedAt,
});

const EARLY = "2026-11-07T10:00:00.000Z";
const LATE = "2026-11-07T12:00:00.000Z";

describe("pickDraft", () => {
  it("resumes the account's copy on a device that has never seen this signup", () => {
    // The reason the remote draft exists: a phone in the shop, a laptop at home.
    const r = pickDraft(null, d("Mama Put", "u1", EARLY), "u1");
    expect(r.draft?.name).toBe("Mama Put");
  });

  it("keeps the browser's copy when it is ahead", () => {
    // Two screens filled offline on the phone beats a stale server copy.
    const r = pickDraft(d("local", "u1", LATE), d("remote", "u1", EARLY), "u1");
    expect(r.draft?.name).toBe("local");
  });

  it("takes the account's copy when that is ahead", () => {
    const r = pickDraft(d("local", "u1", EARLY), d("remote", "u1", LATE), "u1");
    expect(r.draft?.name).toBe("remote");
  });

  it("DROPS a draft belonging to somebody else", () => {
    // The shared-machine case. Someone abandons a signup, the next person signs
    // in as themselves, and without this they are handed a stranger's business
    // name, phone number and budget as their own.
    const r = pickDraft(d("stranger", "u2", LATE), null, "u1");
    expect(r.draft).toBeNull();
    expect(r.dropLocal).toBe(true);
  });

  it("prefers the account's copy over a stranger's, however fresh the stranger's", () => {
    const r = pickDraft(d("stranger", "u2", LATE), d("mine", "u1", EARLY), "u1");
    expect(r.draft?.name).toBe("mine");
    expect(r.dropLocal).toBe(true);
  });

  it("keeps an unstamped local draft in demo mode", () => {
    // No account to belong to, so the draft can only be this person's own.
    const r = pickDraft(d("demo", null, LATE), null, null);
    expect(r.draft?.name).toBe("demo");
    expect(r.dropLocal).toBe(false);
  });

  it("keeps a local draft written before sign-in", () => {
    // ownerId null means "written while signed out", not "somebody else's".
    const r = pickDraft(d("pre-signin", null, LATE), null, "u1");
    expect(r.draft?.name).toBe("pre-signin");
    expect(r.dropLocal).toBe(false);
  });

  it("treats an unreadable timestamp as the oldest rather than the newest", () => {
    // A corrupt stamp must not win by accident and overwrite real progress.
    const r = pickDraft(d("corrupt", "u1", "not-a-date"), d("good", "u1", EARLY), "u1");
    expect(r.draft?.name).toBe("good");
  });

  it("gives a tie to the account's copy", () => {
    const r = pickDraft(d("local", "u1", LATE), d("remote", "u1", LATE), "u1");
    expect(r.draft?.name).toBe("remote");
  });

  it("starts fresh when there is nothing anywhere", () => {
    expect(pickDraft<D>(null, null, "u1")).toEqual({ draft: null, dropLocal: false });
  });
});
