"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Ask the agent".
 *
 * One component for every screen: a right-hand rail on wide screens, a
 * full-height sheet on phones and tablets. Building a separate mobile version
 * is how the two drift apart, so the layout is the only thing that changes.
 *
 * Answers come from /api/agent/ask, which reads the customer's own rows through
 * their session and is read-only. The agent explains and recommends; it never
 * changes anything, and it says so when asked to.
 */
interface Turn {
  role: "you" | "agent";
  text: string;
}

const SUGGESTED = [
  "Which ad is winning?",
  "Should I raise my budget?",
  "What are you doing with my money?",
];

export function AskAgent({ suggestions = SUGGESTED }: { suggestions?: string[] }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setTurns((t) => [...t, { role: "you", text: q }]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agent/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;
      if (!res.ok || !data?.answer) {
        setError(data?.error ?? "I could not answer that just now.");
      } else {
        setTurns((t) => [...t, { role: "agent", text: data.answer as string }]);
      }
    } catch {
      setError("I could not answer that just now.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-accent-bright"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.9-.4L3 21l1.6-4.7A8.2 8.2 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Ask the agent
      </button>
    );
  }

  return (
    <>
      {/* Scrim on small screens only; the rail does not obscure content on desktop. */}
      <button
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-30 bg-black/40 lg:hidden"
      />
      <aside
        role="dialog"
        aria-label="Ask the agent"
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface-raised sm:max-w-md lg:w-96"
      >
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <div className="datalabel">strategy studio</div>
            <h2 className="mt-0.5 text-lg font-semibold text-ink">Ask the agent</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-ink-faint transition-colors hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {turns.length === 0 && (
            <p className="text-sm text-ink-muted">
              Ask me anything about your ads, your budget or what I did today. I read your live
              numbers, so I will tell you when I genuinely cannot answer something yet.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {turns.map((t, i) =>
              t.role === "you" ? (
                <div
                  key={i}
                  className="max-w-[85%] self-end rounded-card bg-surface-overlay px-3.5 py-2.5 text-sm text-ink"
                >
                  {t.text}
                </div>
              ) : (
                <div
                  key={i}
                  className="max-w-[92%] self-start whitespace-pre-wrap rounded-card border-l-2 border-accent bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed text-ink"
                >
                  {t.text}
                </div>
              ),
            )}
            {busy && (
              <div className="self-start text-xs text-ink-faint">Reading your numbers…</div>
            )}
            {error && <p className="text-sm text-negative">{error}</p>}
          </div>
          <div ref={endRef} />
        </div>

        <div className="border-t border-line px-5 py-4">
          {turns.length === 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about budget, angles, timing…"
              maxLength={500}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-bright disabled:opacity-40"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                <path d="M4 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            I can explain and suggest, but I never change anything here. Budget and approvals stay on
            their own screens.
          </p>
        </div>
      </aside>
    </>
  );
}
