"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Confirm the authenticator actually has the key, then save.
 *
 * SIX DIGITS AND NOTHING ELSE. The secret used to ride along in this form,
 * which was defensible on its own terms and had one fatal consequence: the
 * page it came from regenerated the key on every render, so a form submitted
 * after the page had re-rendered carried a DIFFERENT secret from the one in
 * the phone — and the server, verifying the code against what it was handed,
 * refused a perfectly typed code as wrong. Forever, with no way to tell.
 *
 * The candidate now lives server-side and the server reads it itself. There
 * is exactly one key these digits can be checked against, and nothing the
 * browser does can change which one.
 */
export function EnrolForm({ uri }: { uri: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showUri, setShowUri] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ops/enrol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "that did not work");
        setCode("");
        setBusy(false);
        return;
      }
      router.push("/ops");
      router.refresh();
    } catch {
      setError("could not reach the server");
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        <label htmlFor="code" className="text-sm text-ink-muted">
          The 6-digit code your app is showing now
        </label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-center text-lg tracking-[0.4em] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || code.length < 6}
          className="rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {busy ? "Checking…" : "Confirm and save"}
        </button>
        {error && (
          <p className="text-sm leading-relaxed text-negative" role="alert">
            {error}
          </p>
        )}
      </form>

      <button
        type="button"
        onClick={() => setShowUri((v) => !v)}
        className="mt-4 text-xs text-ink-faint underline hover:text-ink-muted"
      >
        {showUri ? "Hide" : "Show"} the otpauth link instead
      </button>
      {showUri && (
        <p className="mt-2 break-all rounded-lg border border-line bg-surface-overlay/40 p-3 font-mono text-[11px] leading-relaxed text-ink-muted">
          {uri}
          <span className="mt-2 block font-sans text-ink-faint">
            Some apps let you paste this whole link. Treat it like the key
            itself — it contains the secret.
          </span>
        </p>
      )}
    </>
  );
}
