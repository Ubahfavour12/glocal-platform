"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

type Mode = "signin" | "signup";

/** Why a sign-in link did not work, as diagnosed by /auth/callback. */
export type LinkError = "device" | "expired";

/**
 * The two failures need different actions, so they get different words.
 *
 * "device" is the one worth spelling out. A sign-in link is tied to the
 * browser that asked for it, so requesting it on a laptop and opening it on a
 * phone can never work, and neither can an email app that opens links in its
 * own in-app browser. Nothing is broken and the link is not expired, so any
 * message about it being invalid would send people hunting for the wrong
 * problem.
 */
const LINK_ERRORS: Record<LinkError, { title: string; body: string }> = {
  device: {
    title: "open the link on this device",
    body:
      "That link was requested from a different browser, so it can only sign you in there. Send yourself a fresh one from this device and open it here. If your email app opens links in its own window, choose \u201cOpen in browser\u201d.",
  },
  expired: {
    title: "that link has expired",
    body: "Sign-in links are single use and time limited. Enter your email and we\u2019ll send a new one.",
  },
};

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

export function MagicLinkForm({ mode, linkError }: { mode: Mode; linkError?: LinkError }) {
  const c = COPY[mode];
  const failure = linkError ? LINK_ERRORS[linkError] : null;
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

        {failure && state === "idle" && (
          <div
            role="status"
            className="mt-5 rounded-card border border-line bg-surface-raised p-4"
          >
            <div className="datalabel text-accent-bright">{failure.title}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{failure.body}</p>
          </div>
        )}

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
