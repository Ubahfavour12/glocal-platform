"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm">
        <div className="datalabel">sign in</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Welcome back</h1>

        {!supabaseConfigured ? (
          <div className="mt-8 rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">setup pending</div>
            <p className="mt-2 text-sm text-ink-muted">
              Authentication activates once the Supabase project is connected
              (see <span className="font-mono text-xs">.env.example</span>).
              Until then you can walk through onboarding in demo mode.
            </p>
            <Link
              href="/onboarding"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
            >
              Continue in demo mode
            </Link>
          </div>
        ) : state === "sent" ? (
          <div className="mt-8 rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">check your email</div>
            <p className="mt-2 text-sm text-ink-muted">
              A sign-in link is on its way to{" "}
              <span className="font-mono text-xs">{email}</span>. Tap it and
              you&apos;ll land back here, signed in.
            </p>
          </div>
        ) : (
          <form onSubmit={sendLink} className="mt-8 flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
              className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {state === "error" && <p className="text-sm text-negative">{message}</p>}
            <p className="mt-2 text-center text-xs text-ink-faint">
              New here? The link creates your account automatically.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
