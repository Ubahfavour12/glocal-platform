"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

type Mode = "signin" | "signup";

const COPY: Record<
  Mode,
  {
    label: string;
    title: string;
    subtitle: string;
    button: string;
    sending: string;
    sentTitle: string;
    sentBody: (email: string) => string;
    altText: string;
    altHref: string;
    altLink: string;
  }
> = {
  signin: {
    label: "sign in",
    title: "Welcome back",
    subtitle: "Enter your email and we'll send a one-tap sign-in link.",
    button: "Send sign-in link",
    sending: "Sending…",
    sentTitle: "check your email",
    sentBody: (email) =>
      `A sign-in link is on its way to ${email}. Tap it and you'll land in your dashboard.`,
    altText: "New here?",
    altHref: "/signup",
    altLink: "Create an account",
  },
  signup: {
    label: "get started",
    title: "Create your account",
    subtitle:
      "Enter your email to begin. Next we'll set up your business in about two minutes, then the agent takes over.",
    button: "Send sign-up link",
    sending: "Sending…",
    sentTitle: "check your email",
    sentBody: (email) =>
      `A sign-up link is on its way to ${email}. Tap it and we'll set up your business.`,
    altText: "Already have an account?",
    altHref: "/login",
    altLink: "Sign in",
  },
};

export function MagicLinkForm({ mode }: { mode: Mode }) {
  const c = COPY[mode];
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      // friendlier wording for the most common cause
      setMessage(
        /rate limit/i.test(error.message)
          ? "Too many emails were sent just now. Please wait a minute and try again."
          : error.message,
      );
    } else {
      setState("sent");
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm">
        <div className="datalabel">{c.label}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{c.title}</h1>

        {!supabaseConfigured ? (
          <div className="mt-8 rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">setup pending</div>
            <p className="mt-2 text-sm text-ink-muted">
              Authentication activates once the Supabase project is connected. Until
              then you can walk through onboarding in demo mode.
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
            <div className="datalabel">{c.sentTitle}</div>
            <p className="mt-2 text-sm text-ink-muted">{c.sentBody(email)}</p>
          </div>
        ) : (
          <form onSubmit={send} className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-ink-muted">{c.subtitle}</p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
              className="mt-1 rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
            >
              {state === "sending" ? c.sending : c.button}
            </button>
            {state === "error" && <p className="text-sm text-negative">{message}</p>}
            <p className="mt-2 text-center text-xs text-ink-faint">
              {c.altText}{" "}
              <Link href={c.altHref} className="text-ink-muted underline hover:text-ink">
                {c.altLink}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
