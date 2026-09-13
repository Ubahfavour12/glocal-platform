"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Add something the ten questions never asked about.
 *
 * The brief is good at what it asks and blind to everything else. A second
 * branch opening, a line going out of stock, a product suddenly selling out —
 * all of it should change what the agent writes this week, and none of it fits
 * a question about brand tone.
 *
 * The box clears on save, deliberately. This is a feed, not a field: you are
 * adding what is true now, not editing what was true in June. What has already
 * been absorbed is listed below it, so nothing typed here disappears into
 * somewhere the owner cannot see.
 */
export function ContextFeed({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setState("saving");
    try {
      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { _context: body } }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState("error");
        setMessage(data?.error ?? "Could not save that. Please try again.");
        return;
      }
      setText("");
      setState("saved");
      // Refresh so the note appears in the absorbed list below without a reload.
      router.refresh();
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setMessage("Could not reach the server. Check your connection and try again.");
    }
  }

  return (
    <form onSubmit={save} className="mt-4 flex flex-col gap-3">
      <label htmlFor="context" className="text-sm text-ink-muted">
        Anything else the agent should know right now — a new branch, a line
        that&rsquo;s sold out, a promotion you&rsquo;re running, something a
        customer keeps asking. Add it whenever it&rsquo;s true.
      </label>
      <textarea
        id="context"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled || state === "saving"}
        placeholder="We&rsquo;ve just opened a second shop in Surulere, so ads should mention both locations."
        className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={disabled || state === "saving" || !text.trim()}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {state === "saving" ? "Sending to your agent…" : "Add to the brief"}
        </button>
        <span className="text-xs text-ink-faint" role="status">
          {state === "saved" && "Added — your agent has it."}
          {state === "error" && <span className="text-negative">{message}</span>}
        </span>
      </div>
    </form>
  );
}
