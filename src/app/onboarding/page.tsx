"use client";

import { useMemo, useState } from "react";
import { buildServiceGeo } from "@/lib/tracking/geo";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { screenCategory } from "@/lib/compliance/categories";
import {
  MIN_DAILY_BUDGET_USD_MINOR,
  minFirstDepositUsdMinor,
} from "@/lib/money/ledger";
import { currencyForCountry, dialCodeForCountry, listCountries } from "@/lib/money/currency";

/**
 * Quick-Start onboarding, UF-1 / PRD F-01.
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
  const [country, setCountry] = useState("NG");
  const [geo, setGeo] = useState("");

  const local = currencyForCountry(country); // secondary display currency
  const dial = dialCodeForCountry(country); // phone-field hint for their country
  const [mediaNames, setMediaNames] = useState<string[]>([]);
  // Client-side previews only: the files never leave the device or get saved.
  const [mediaPreviews, setMediaPreviews] = useState<
    { name: string; url: string; isVideo: boolean }[]
  >([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [destination, setDestination] = useState("");
  const [dailyUsd, setDailyUsd] = useState(10);

  // The door the agent's ads send buyers through (tracking/modes.ts).
  const connectionMode = goal === "whatsapp" ? "whatsapp" : "website";

  const screen = useMemo(() => screenCategory(category), [category]);
  const dailyMinor = Math.max(Math.round(dailyUsd * 100), MIN_DAILY_BUDGET_USD_MINOR);
  const depositMinor = minFirstDepositUsdMinor(dailyMinor);
  const depositUsd = depositMinor / 100;
  const depositNgn = Math.ceil((depositMinor * DEMO_NGN_PER_USD_BUFFERED) / 100);

  const canNext =
    step === 0
      ? name.trim().length > 1 && category.trim().length > 1 && country.trim().length === 2 && geo.trim().length > 1 && screen !== "blocked"
      : step === 1
        ? mediaNames.length > 0
        : step === 2
          ? goal !== null && destination.trim().length > 2
          : true;

  async function finish() {
    // Local copy first so the dashboard reflects answers even in demo mode.
    try {
      localStorage.setItem(
        "onboarding",
        JSON.stringify({ name, category, geo, goal, dailyUsd, mediaNames, screen }),
      );
    } catch {
      // storage unavailable, proceed anyway
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
          service_geo: buildServiceGeo(geo, country),
          daily_budget_usd_minor: dailyMinor,
          connection_mode: connectionMode,
          destination: destination.trim(),
          country,
          currency: local.currency, // local display currency; USD stays canonical
        });
        // Wake the agent: the first concept batch builds in the background
        // (Phase 2.1); the nightly run tops the pipeline up to the target.
        fetch("/api/pipeline/build", { method: "POST", keepalive: true }).catch(() => {});
      }
    }
    router.push("/today");
  }

  function removeMedia(name: string) {
    const target = mediaPreviews.find((p) => p.name === name);
    if (target) URL.revokeObjectURL(target.url);
    const next = mediaPreviews.filter((p) => p.name !== name);
    setMediaPreviews(next);
    setMediaNames(next.map((p) => p.name));
  }

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 py-12">
      {/* progress, the mono register from the prototype */}
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
        step {step + 1} of {STEPS.length}, {STEPS[step].toLowerCase()}
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
            <div>
              <label className="datalabel">your country</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm text-ink focus:border-accent focus:outline-none"
              >
                {listCountries().map((c) => (
                  <option key={c.country} value={c.country}>
                    {c.countryName} ({c.symbol} {c.currency})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-faint">
                Prices show in USD with a {local.symbol} {local.currency} equivalent for you.
              </p>
            </div>
          </div>
          {screen === "blocked" && category.trim().length > 1 && (
            <p className="mt-3 text-sm text-negative">
              Sorry, this category can&apos;t be advertised through the platform.
            </p>
          )}
          {screen === "restricted" && (
            <p className="mt-3 text-sm text-ink-muted">
              This category has special advertising rules, the agent will apply
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
          <label
            className={`mt-6 flex flex-col items-center justify-center rounded-card border border-dashed px-6 py-10 text-center transition-colors ${
              mediaPreviews.length >= 5
                ? "pointer-events-none border-line bg-surface opacity-50"
                : "cursor-pointer border-line bg-surface-raised hover:border-accent"
            }`}
          >
            <span className="text-sm text-ink-muted">
              {mediaPreviews.length >= 5 ? "Maximum reached (5 files)" : "Tap to add photos or videos"}
            </span>
            <span className="datalabel mt-1">
              {mediaPreviews.length > 0
                ? `${mediaPreviews.length} of 5 added`
                : "jpg · png · mp4, up to 5 files"}
            </span>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = ""; // let the same file be re-picked after removal
                if (picked.length === 0) return;
                // Append, don't replace: keep what's there and top up to 5.
                const remaining = 5 - mediaPreviews.length;
                if (remaining <= 0) return;
                const have = new Set(mediaPreviews.map((p) => p.name));
                const additions = picked
                  .filter((f) => !have.has(f.name))
                  .slice(0, remaining)
                  .map((f) => ({
                    name: f.name,
                    url: URL.createObjectURL(f),
                    isVideo: f.type.startsWith("video"),
                  }));
                if (additions.length === 0) return;
                const next = [...mediaPreviews, ...additions];
                setMediaPreviews(next);
                setMediaNames(next.map((p) => p.name));
              }}
            />
          </label>
          {mediaPreviews.length > 0 && (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {mediaPreviews.map((m) => (
                  <div
                    key={m.name}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-overlay"
                  >
                    {m.isVideo ? (
                      <video src={m.url} className="h-full w-full object-cover" muted playsInline />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMedia(m.name)}
                      aria-label={`Remove ${m.name}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white transition-colors hover:bg-black/80"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-faint">
                Shown here so you can check them. Your files stay on your device for
                now; nothing is uploaded.
              </p>
            </>
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
                onClick={() => {
                  setGoal(g.id);
                  // Start the WhatsApp field with their country's dial code so
                  // they just append the rest; don't clobber a typed value.
                  setDestination((d) => {
                    const t = d.trim();
                    if (g.id === "whatsapp" && t === "") return `${dial} `;
                    if (g.id !== "whatsapp" && t === dial) return "";
                    return d;
                  });
                }}
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

          {goal && (
            <div className="mt-6">
              <label className="text-sm text-ink">
                {goal === "whatsapp"
                  ? "Your WhatsApp number (with country code)"
                  : "Your website or product link"}
              </label>
              <input
                type={goal === "whatsapp" ? "tel" : "url"}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={goal === "whatsapp" ? dial : "https://yourshop.com"}
                className="mt-2 w-full rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
              <p className="mt-2 text-xs text-ink-faint">
                {goal === "whatsapp"
                  ? "Every ad opens a WhatsApp chat with you. Buyers arrive with a tag so you know which ad they came from."
                  : "Every ad links here through our tracked link, so the agent can see which ads actually send people to you."}
              </p>
            </div>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="mt-4">
          <h1 className="text-2xl font-semibold tracking-tight">Set your daily budget</h1>
          <p className="mt-2 text-sm text-ink-muted">
            You decide what to spend, and you can change it any time. We start
            the floor at $10 a day, just enough for the daily test to learn
            honestly.
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
            <div className="datalabel">first deposit, 7 days of runway</div>
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
