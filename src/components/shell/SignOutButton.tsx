"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sign out, from the dashboard header.
 *
 * There was no way to sign out anywhere in the product. On a shared phone or a
 * cyber-café machine -- which is how a good share of this market gets online --
 * that is not a missing convenience, it is the next person inheriting an
 * account that can spend money.
 *
 * The work happens in POST /api/auth/signout, because the Supabase session is
 * in httpOnly cookies the browser cannot clear for itself.
 *
 * `router.refresh()` after the push matters: the (app) layout is a server
 * component that checked auth when it rendered, and without the refresh the
 * client cache can show a signed-in shell to someone who has just signed out.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return; // a double-tap must not fire two requests
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Network failed. Still send them to /login: the server may well have
      // cleared the session before the response was lost, and leaving someone
      // on a dashboard they tried to leave is the worse outcome.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
    </button>
  );
}
