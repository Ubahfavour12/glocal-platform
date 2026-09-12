"use client";

import { useState, useSyncExternalStore } from "react";
import {
  IDLE_LIMIT_MS,
  POLICY_COOKIE,
  type SessionPolicy,
  isSessionPolicy,
} from "@/lib/auth/session-policy";

/**
 * How long this browser stays signed in, and a way to change it.
 *
 * This exists because the choice was previously invisible. It was made once, by
 * a checkbox on the sign-in page, and then never shown again — so "shared
 * computer" and "my own phone" behaved identically for the first twenty
 * minutes and looked, reasonably, like a setting that did nothing. A control
 * whose only evidence is something that happens later needs to say what it is
 * currently set to.
 *
 * It reads the cookie the sign-in form wrote and the proxy enforces. Changing
 * it here takes effect on the next request, without signing anyone out:
 * shortening the window applies immediately, which is the direction that
 * matters if you have just realised you are on someone else's machine.
 */
/**
 * The cookie, as a tiny external store.
 *
 * useSyncExternalStore rather than useState+useEffect: the value lives outside
 * React (a cookie this browser owns), it cannot be read during server
 * rendering, and reading it in an effect and calling setState is exactly the
 * cascading-render pattern the compiler rejects. A store gets the server
 * snapshot right by construction — it renders the default, then the real value
 * on hydration, with no second render triggered from an effect.
 */
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): SessionPolicy {
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${POLICY_COOKIE}=`))
    ?.split("=")[1];
  return isSessionPolicy(raw) ? raw : "private";
}

/** Server render has no cookies; the generous default is the honest guess. */
function getServerSnapshot(): SessionPolicy {
  return "private";
}

function writePolicy(next: SessionPolicy): void {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${POLICY_COOKIE}=${next};path=/;max-age=${oneYear};samesite=lax`;
  listeners.forEach((fn) => fn());
}

function hours(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${ms / 60_000} minutes`;
}

export function SessionCard() {
  const policy = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [saved, setSaved] = useState(false);

  function choose(next: SessionPolicy) {
    writePolicy(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">staying signed in</div>
      <p className="mt-2 text-sm text-ink-muted">
        On this browser we sign you out after{" "}
        <strong className="text-ink">{hours(IDLE_LIMIT_MS[policy])}</strong> of not being used.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {(
          [
            {
              id: "private" as const,
              title: "My own phone or computer",
              body: `Stay signed in for ${hours(IDLE_LIMIT_MS.private)} of inactivity.`,
            },
            {
              id: "shared" as const,
              title: "A shared or public computer",
              body: `Sign me out after ${hours(IDLE_LIMIT_MS.shared)} of inactivity.`,
            },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => choose(opt.id)}
            aria-pressed={policy === opt.id}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              policy === opt.id
                ? "border-accent bg-surface-overlay"
                : "border-line hover:border-accent"
            }`}
          >
            <span className="block text-sm font-medium text-ink">{opt.title}</span>
            <span className="block text-xs text-ink-faint">{opt.body}</span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-ink-faint" role="status">
        {saved
          ? "Saved — this takes effect straight away."
          : "This setting lives on this browser only, so a shared machine can be set to sign out quickly without changing anything on your own phone."}
      </p>

      <p className="mt-2 text-xs text-ink-faint">
        Every session also ends after 30 days, however often it is used.
      </p>
    </div>
  );
}
