"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The six-digit prompt. Thin: every decision is made server-side. */
export function UnlockForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ops/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        // Whatever the server said, verbatim. It deliberately answers every
        // refusal the same way, and inventing a more specific message here
        // would undo that.
        setError(data?.error ?? "that did not work");
        setCode("");
        setBusy(false);
        return;
      }
      // The console is a server component whose gate ran before this cookie
      // existed, so the push must be followed by a refresh -- otherwise the
      // client cache can serve the pre-unlock render straight back.
      router.push("/ops");
      router.refresh();
    } catch {
      setError("could not reach the server");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="123456"
        aria-label="Authenticator code"
        className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-center text-lg tracking-[0.4em] text-ink placeholder:text-ink-faint gl-field"
      />
      <button
        type="submit"
        disabled={busy || code.length < 6}
        className="rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
      >
        {busy ? "Checking…" : "Unlock"}
      </button>
      {/*
        leading-relaxed because this is no longer always three words: a clock
        that is out now gets a sentence explaining itself, and set solid it
        reads like a wall.
      */}
      {error && (
        <p className="text-sm leading-relaxed text-negative" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs leading-relaxed text-ink-faint">
        The code changes every 30 seconds. Attempts are rate limited and every
        one is recorded, successful or not.
      </p>
    </form>
  );
}
