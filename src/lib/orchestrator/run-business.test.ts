import { describe, expect, it } from "vitest";
import { approvalStatusFor } from "./run-business";

describe("approvalStatusFor", () => {
  it("lets a full-auto account launch without a tap", () => {
    expect(approvalStatusFor("auto_approved", undefined)).toBe("approved");
  });

  it("still waits for a tap when the gate is on", () => {
    expect(approvalStatusFor("ready_for_approval", undefined)).toBe("awaiting");
  });

  it("makes a regenerated plan wait even on full auto", () => {
    // The bug this exists to stop: the owner rejects a plan, asks for a
    // rewrite, and the rewrite is approved before they have read a word of it.
    expect(approvalStatusFor("auto_approved", true)).toBe("awaiting");
  });

  it("never turns a plan that was not auto-approved into an approved one", () => {
    for (const s of ["ready_for_approval", "insufficient_funds"]) {
      expect(approvalStatusFor(s, false), s).toBe("awaiting");
    }
  });
});
