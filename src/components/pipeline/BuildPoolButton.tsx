"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Write the first batch of concepts now, instead of waiting for tonight.
 *
 * WHY THIS EXISTS. Scoping the pool to the chosen ad language was correct and
 * left a hole: an account that switches to Pidgin has nothing in Pidgin yet,
 * so the pipeline page goes blank until the nightly run. Blank with no
 * explanation and no button reads exactly like a broken page — and the person
 * looking at it has no way to tell the difference, which is the worst state a
 * screen can be in.
 *
 * It calls the same endpoint onboarding does. That endpoint is idempotent: a
 * full pool short-circuits, and the first-plan step it also performs only runs
 * for an account with no approvals, so pressing this on an established account
 * cannot burn a render.
 *
 * It is deliberately NOT fire-and-forget like onboarding's call. There the
 * customer has a progress screen to watch; here they are looking at an empty
 * page and need to be told when it has stopped being empty.
 */
export function BuildPoolButton({ label }: { label: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");

  async function build() {
    if (state === "working") return;
    setState("working");
    setMessage("");
    try {
      const res = await fetch("/api/pipeline/build", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage(data?.error ?? "that did not work — tonight's run will pick it up");
        setState("error");
        return;
      }
      router.refresh();
      // Left in the working state on purpose: refresh() repaints the page with
      // the new concepts, and flipping the button back to idle first would
      // show "write them now" beside the drafts it just wrote.
    } catch {
      setMessage("could not reach the server — tonight's run will pick it up");
      setState("error");
    }
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={build}
        disabled={state === "working"}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-60"
      >
        {state === "working" ? "Writing…" : `Write the first ${label} drafts now`}
      </button>
      <p className="mt-2 text-xs text-ink-faint">
        {state === "working"
          ? "The agent is studying your niche and writing. This takes about a minute."
          : "Takes about a minute. Otherwise they arrive with tonight's run."}
      </p>
      {state === "error" && <p className="mt-2 text-sm text-negative">{message}</p>}
    </div>
  );
}
