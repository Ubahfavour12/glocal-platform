"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Use this one next" — the customer hand-picks a concept from the pipeline
 * instead of waiting for the agent to reach it in rank order. Rebuilds
 * tomorrow's plan with this concept at the front of the queue.
 *
 * The agent still gets the final say on compliance: a hand-picked concept that
 * fails the gateway is substituted, same as any other.
 */
export function UseThisButton({
  businessId,
  conceptId,
  videoAffordable = false,
  videoCredits = 1,
}: {
  businessId: string;
  conceptId: string;
  /** Whether today's remaining allowance can still cover a video. */
  videoAffordable?: boolean;
  /** What a video costs against that allowance, so the price is never hidden. */
  videoCredits?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy">("idle");
  // Images are the default because they are what the account can always
  // afford. Video is offered, priced, and disabled rather than hidden when it
  // will not fit, so the limit is understood instead of merely hit.
  const [kind, setKind] = useState<"image" | "video">("image");
  const [error, setError] = useState("");

  const choice = (
    <div className="mb-2 flex items-center gap-1.5">
      {(["image", "video"] as const).map((k) => {
        const blocked = k === "video" && !videoAffordable;
        return (
          <button
            key={k}
            type="button"
            disabled={blocked}
            onClick={() => setKind(k)}
            title={
              blocked
                ? `A video costs ${videoCredits} renders and today's allowance will not cover it.`
                : k === "video"
                  ? `Costs ${videoCredits} of today's renders.`
                  : "Costs one render."
            }
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              blocked
                ? "cursor-not-allowed border-line-soft text-ink-faint opacity-60"
                : kind === k
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-line text-ink-muted hover:border-ink-faint"
            }`}
          >
            {k === "video" ? `video · ${videoCredits}x` : "image"}
          </button>
        );
      })}
    </div>
  );

  async function pick() {
    setState("busy");
    setError("");
    const res = await fetch("/api/plan/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, concept_ids: [conceptId], kind }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "could not put this into tomorrow's plan");
      setState("idle");
      return;
    }
    // No local "done" state. Whether this concept is in tomorrow's plan is the
    // server's answer, and refresh goes and gets it: the card re-renders with
    // the badge if the rebuild actually kept this concept, and with the button
    // if it did not. Remembering the click instead is how one card ended up
    // insisting it was in a test that had moved on without it.
    router.refresh();
    setState("idle");
  }

  return (
    <span className="flex flex-col items-start">
      {choice}
      <span className="flex items-center gap-2">
      <button
        onClick={pick}
        disabled={state === "busy"}
        className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
      >
        {state === "busy" ? "Adding…" : "Use this one next"}
      </button>
      {error && <span className="text-xs text-negative">{error}</span>}
      </span>
    </span>
  );
}
