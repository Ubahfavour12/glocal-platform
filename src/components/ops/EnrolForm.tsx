"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Confirm the authenticator actually has the key, then save.
 *
 * The secret rides along in the form rather than being held in a server
 * session, and that is deliberate: it was generated for this page view and
 * means nothing until the matching code comes back. The server verifies the
 * code AGAINST THE SUBMITTED SECRET before storing either, so the only way
 * to enrol a secret is to prove you already hold it.
 *
 * The consequence that matters: a key that never reached the phone can never
 * become the one that locks everybody out.
 */
export function EnrolForm({
  totpSecret,
  sessionSecret,
  uri,
}: {
  totpSecret: string;
  sessionSecret: string;
  uri: string;
}) {
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
        body: JSON.stringify({ code, totpSecret, sessionSecret }),
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
        {error && <p className="text-sm text-negative">{error}</p>}
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
