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
}: {
  businessId: string;
  conceptId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function pick() {
    setState("busy");
    setError("");
    const res = await fetch("/api/plan/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, concept_ids: [conceptId] }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "could not put this into tomorrow's plan");
      setState("idle");
      return;
    }
    setState("done");
    router.refresh();
  }

  if (state === "done") {
    return <span className="text-xs text-accent-bright">In tomorrow&apos;s test ✓</span>;
  }

  return (
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
  );
}
