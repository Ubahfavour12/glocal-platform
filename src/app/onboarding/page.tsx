"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { screenCategory } from "@/lib/compliance/categories";
import {
  MIN_DAILY_BUDGET_USD_MINOR,
  minFirstDepositUsdMinor,
} from "@/lib/money/ledger";

/**
 * Quick-Start onboarding — UF-1 / PRD F-01.
 * Four steps, under two minutes: basics → media → goal → budget.
 * The agent infers everything else; the Strategy Studio holds the deep flow.
 */

type Goal = "sales" | "leads" | "whatsapp" | "visits";

const GOALS: { id: Goal; title: string; blurb: string }[] = [
  { id: "sales", title: "Sales", blurb: "Sell products, online or in store" },
  { id: "leads", title: "Leads", blurb: "Collect enquiries and contacts" },
  { id: "whatsapp", title: "WhatsApp messages", blurb: "Customers chat with you directly" },
  { id: "visits", title: "Store visits", blurb: "Bring people through the door" },
];

const STEPS = ["Business", "Media", "Goal", "Budget"] as const;

// Display-only example rate until the FX provider is wired (Task #3).
const DEMO_NGN_PER_USD_BUFFERED = 1545;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [geo, setGeo] = useState("");
  const [mediaNames, setMediaNames] = useState<string[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [dailyUsd, setDailyUsd] = useState(10);

  const screen = useMemo(() => screenCategory(category), [category]);
  const dailyMinor = Math.max(Math.round(dailyUsd * 100), MIN_DAILY_BUDGET_USD_MINOR);
  const depositMinor = minFirstDepositUsdMinor(dailyMinor);
  const depositUsd = depositMinor / 100;
  const depositNgn = Math.ceil((depositMinor * DEMO_NGN_PER_USD_BUFFERED) / 100);

  const canNext =
    step === 0
      ? name.trim().length > 1 && category.trim().length > 1 && geo.trim().length > 1 && screen !== "blocked"
      : step === 1
        ? mediaNames.length > 0
        : step === 2
          ? goal !== null
          : true;

  async function finish() {
    // Local copy first so the dashboard reflects answers even in demo mode.
    try {
      localStorage.setItem(
        "onboarding",
        JSON.stringify({ name, category, geo, goal, dailyUsd, mediaNames, screen }),
      );
    } catch {
      // storage unavailable — proceed anyway
    }

    // Signed-in users get a real business row (RLS scopes it to them).
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase.from("businesses").insert({
          owner_id: userData.user.id,
          name: name.trim(),
          category: category.trim(),
          goal,
          service_geo: { raw: geo.trim() },
          daily_budget_usd_minor: dailyMinor,
        });
      }
    }
    router.push("/today");
  }

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 py-12">
      {/* progress — the mono register from the prototype */}
      <div className="mb-10">
        <div className="flex items-center justify-between">
          <span className="datalabel">onboarding completion</span>
          <span className="datalabel">{pct}% completed</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay">
          <div
            className="h-full rounded-full bg-ink transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="datalabel">
        step {step + 1} of {STEPS.length} — {STEPS[step].toLowerCase()}
      </div>

      {step === 0 && (
        <section className="mt-4">
          <h1 className="text-2xl font-semibold tracking-tight">Tell me about the business</h1>
          <div className="mt-6 flex flex-col gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Business name"
              className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="What do you sell? (e.g. fashion, phones, wine)"
              className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <input
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
              placeholder="Where do you serve? (city or countries)"
              className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>
          {screen === "blocked" && category.trim().length > 1 && (
            <p className="mt-3 text-sm text-negative">
              Sorry — this category can&apos;t be advertised through the platform.
            </p>
          )}
          {screen === "restricted" && (
            <p className="mt-3 text-sm text-ink-muted">
              This category has special advertising rules — the agent will apply
              extra compliance checks to every creative.
            </p>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="mt-4">
          <h1 className="text-2xl font-semibold tracking-tight">Show me the product</h1>
          <p className="mt-2 text-sm text-ink-muted">
            1–5 photos or videos. The agent studies them and the most viral ads
            in your niche to build your creative pipeline.
          </p>
          <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface-raised px-6 py-10 text-center transition-colors hover:border-accent">
            <span className="text-sm text-ink-muted">Tap to add photos or videos</span>
            <span className="datalabel mt-1">jpg · png · mp4 — up to 5 files</span>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) =>
                setMediaNames(Array.from(e.target.files ?? []).slice(0, 5).map((f) => f.name))
              }
            />
          </label>
          {mediaNames.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1">
              {mediaNames.map((n) => (
                <li key={n} className="font-mono text-xs text-ink-muted">
                  ✓ {n}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="mt-4">
          <h1 className="text-2xl font-semibold tracking-tight">What should the ads achieve?</h1>
          <div className="mt-6 flex flex-col gap-2">
            {GOALS.map((g) => (
              <button
                key={g.id}
                onClick={() => setGoal(g.id)}
                className={`rounded-card border px-5 py-4 text-left transition-colors ${
                  goal === g.id
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-surface-raised hover:border-ink-faint"
                }`}
              >
                <div className="text-sm font-medium">{g.title}</div>
                <div className="mt-0.5 text-xs text-ink-muted">{g.blurb}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-4">
          <h1 className="text-2xl font-semibold tracking-tight">Set your daily budget</h1>
          <p className="mt-2 text-sm text-ink-muted">
            The daily duel needs data to learn from — $10/day is the floor that
            keeps verdicts honest.
          </p>
          <div className="mt-8">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-3xl font-semibold">${dailyUsd}</span>
              <span className="datalabel">per day</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={dailyUsd}
              onChange={(e) => setDailyUsd(Number(e.target.value))}
              className="mt-4 w-full accent-[#b45309]"
            />
          </div>
          <div className="mt-6 rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">first deposit — 7 days of runway</div>
            <div className="mt-2 font-mono text-xl font-semibold">
              ${depositUsd.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-ink-faint">
              ≈ ₦{depositNgn.toLocaleString()} at the current rate (final price
              always shown before you pay)
            </div>
          </div>
        </section>
      )}

      <div className="mt-10 flex items-center justify-between">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-lg border border-line px-5 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-30"
          >
            Next
          </button>
        ) : (
          <button
            onClick={finish}
            className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            Enter the dashboard
          </button>
        )}
      </div>
    </div>
  );
}
