"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

type Mode = "signin" | "signup";

/** Why a sign-in link did not work, as diagnosed by /auth/callback. */
export type LinkError = "device" | "expired" | "idle" | "absolute";

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
  /**
   * A timeout is not a failure and must not read like one. Someone who is
   * simply told "sign in" after being signed out mid-task assumes something
   * broke; saying which timeout ended it, and why, is the difference between a
   * safety feature and a bug.
   */
  idle: {
    title: "signed out for safety",
    body: "You were away for a while, so we ended the session. That is deliberate on a shared computer. Sign in again below to pick up where you left off.",
  },
  absolute: {
    title: "time to sign in again",
    body: "Sessions end after 30 days no matter how often they are used, so a browser you have forgotten about cannot stay signed in forever.",
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
    subtitle: "Enter your email and we'll send a sign-in link and a 6-digit code.",
    button: "Send sign-in link",
    sending: "Sending…",
    sentTitle: "check your email",
    sentBody: (email) =>
      `Sent to ${email}. Tap the link to land in your dashboard, or type the code below.`,
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
      `Sent to ${email}. Tap the link and we'll set up your business, or type the code below.`,
    altText: "Already have an account?",
    altHref: "/login",
    altLink: "Sign in",
  },
};

export function MagicLinkForm({ mode, linkError }: { mode: Mode; linkError?: LinkError }) {
  const c = COPY[mode];
  const failure = linkError ? LINK_ERRORS[linkError] : null;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [shared, setShared] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "verifying" | "error">("idle");
  const [message, setMessage] = useState("");

  function friendly(msg: string) {
    if (/rate limit/i.test(msg)) {
      return "Too many emails were sent just now. Please wait a minute and try again.";
    }
    if (/expired|invalid/i.test(msg)) {
      return "That code is wrong or has expired. Check the newest email, or send a fresh code.";
    }
    return msg;
  }

  /**
   * The chosen timeout has to survive the redirect into the app, and the
   * checkbox is only on this page, so it is written before sign-in completes.
   * Not httpOnly, because it is set here in the browser -- it is a preference,
   * not a credential, and the only session it can shorten or lengthen is the
   * one belonging to whoever set it.
   */
  function rememberPolicy() {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `glocal-session-policy=${shared ? "shared" : "private"};path=/;max-age=${oneYear};samesite=lax`;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    rememberPolicy();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(friendly(error.message));
    } else {
      setState("sent");
    }
  }

  /**
   * Sign in with the six-digit code from the email.
   *
   * This exists because the link cannot always work. A link is bound to the
   * browser that asked for it, so requesting it on a laptop and opening it on a
   * phone fails by design, as does any email app that opens links in its own
   * in-app browser -- see LINK_ERRORS.device. A code carries no such binding:
   * it can be read on a phone and typed on a desktop, or the other way round.
   * The link still works where it works; this is the path that always does.
   */
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setState("verifying");
    rememberPolicy();
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setState("error");
      setMessage(friendly(error.message));
      return;
    }
    // A full navigation, not a router push: the session cookie was just set and
    // every server component needs to be re-rendered knowing about it.
    window.location.assign(mode === "signup" ? "/onboarding" : "/today");
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
        ) : state === "sent" || state === "verifying" || (state === "error" && code) ? (
          <div className="mt-8 rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">{c.sentTitle}</div>
            <p className="mt-2 text-sm text-ink-muted">{c.sentBody(email)}</p>
            <form onSubmit={verify} className="mt-4 flex flex-col gap-3">
              <label htmlFor="otp" className="text-sm text-ink-muted">
                Or type the 6-digit code from the email — this works even if you
                opened your email somewhere else.
              </label>
              <input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="rounded-lg border border-line bg-surface px-4 py-3 text-center text-lg tracking-[0.4em] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={state === "verifying" || code.length < 6}
                className="rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
              >
                {state === "verifying" ? "Signing you in…" : "Sign in with code"}
              </button>
              {state === "error" && <p className="text-sm text-negative">{message}</p>}
              <button
                type="button"
                onClick={() => {
                  setCode("");
                  setState("idle");
                }}
                className="text-center text-xs text-ink-faint underline hover:text-ink-muted"
              >
                Use a different email
              </button>
            </form>
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
            <label className="flex items-start gap-2.5 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span>
                This is a shared or public computer
                <span className="block text-xs text-ink-faint">
                  We&rsquo;ll sign you out after 20 minutes of not being used,
                  instead of keeping you signed in.
                </span>
              </span>
            </label>
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
