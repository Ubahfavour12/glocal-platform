"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { computeWalletHealth } from "@/lib/money/wallet-health";
import type { AdLanguage } from "@/lib/copy/language";

type Goal = "sales" | "leads" | "whatsapp" | "visits" | "awareness";
type Persona = "conservative" | "smart" | "aggressive";

const GOALS: { id: Goal; label: string }[] = [
  { id: "sales", label: "Sales" },
  { id: "leads", label: "Leads" },
  { id: "whatsapp", label: "WhatsApp messages" },
  { id: "visits", label: "Store visits" },
  { id: "awareness", label: "Be known locally" },
];

/**
 * The language the agent writes ADS in. Not the dashboard language.
 *
 * The API has accepted `ad_language` since the language work shipped and the
 * generator honours it, but there was no control, so every account stayed on
 * English by default -- a feature that existed and could not be reached.
 */
const AD_LANGUAGES: { id: AdLanguage; label: string }[] = [
  { id: "english", label: "English" },
  { id: "pidgin", label: "Pidgin" },
  { id: "hausa", label: "Hausa" },
  { id: "yoruba", label: "Yoruba" },
  { id: "igbo", label: "Igbo" },
];

const PERSONAS: { id: Persona; label: string; blurb: string }[] = [
  { id: "conservative", label: "Conservative", blurb: "80% to the champion, steady, low variance" },
  { id: "smart", label: "Smart", blurb: "70/30, the balanced default" },
  { id: "aggressive", label: "Aggressive", blurb: "60% champion, tests harder, faster learning" },
];

export function SettingsForm({
  initial,
  balanceUsdMinor,
}: {
  initial: {
    dailyBudgetUsdMinor: number;
    goal: Goal;
    persona: Persona;
    fullAuto: boolean;
    launchHour: number;
    adLanguage: AdLanguage;
  };
  balanceUsdMinor: number;
}) {
  const router = useRouter();
  const [budgetUsd, setBudgetUsd] = useState(Math.round(initial.dailyBudgetUsdMinor / 100));
  const [goal, setGoal] = useState<Goal>(initial.goal);
  const [persona, setPersona] = useState<Persona>(initial.persona);
  const [fullAuto, setFullAuto] = useState(initial.fullAuto);
  const [launchHour, setLaunchHour] = useState(initial.launchHour);
  const [adLanguage, setAdLanguage] = useState<AdLanguage>(initial.adLanguage);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const budgetMinor = Math.max(1000, budgetUsd * 100);
  const health = computeWalletHealth(balanceUsdMinor, budgetMinor);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        daily_budget_usd_minor: budgetMinor,
        goal,
        persona,
        ad_language: adLanguage,
        full_auto: fullAuto,
        launch_hour: launchHour,
        // The shop's own clock, so 7am means 7am where the shop is rather than
        // wherever the server happens to run.
        launch_timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Lagos",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(d?.error ?? "could not save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const runwayColor =
    health.status === "empty" || health.status === "critical"
      ? "text-negative"
      : health.status === "low"
        ? "text-accent-bright"
        : "text-ink-muted";

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">daily budget &amp; strategy</div>

      {/* budget */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-2xl font-semibold">${budgetUsd}</span>
          <span className="datalabel">per day</span>
        </div>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={budgetUsd}
          onChange={(e) => setBudgetUsd(Number(e.target.value))}
          className="mt-3 w-full accent-[var(--accent)]"
        />
        <p className={`mt-2 text-xs ${runwayColor}`}>
          {balanceUsdMinor > 0
            ? `About ${health.runwayDays} ${health.runwayDays === 1 ? "day" : "days"} of runway at this budget.`
            : "Fund your wallet to start. The floor is $10/day so the daily test can learn honestly."}
        </p>
      </div>

      {/* goal */}
      <div className="mt-6">
        <span className="datalabel">goal</span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {GOALS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGoal(g.id)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                goal === g.id ? "border-accent bg-accent-soft text-ink shadow-[0_0_24px_-10px_rgba(245,133,16,0.7)]" : "border-line bg-surface text-ink-muted hover:border-ink-faint"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* ad language */}
      <div className="mt-6">
        <span className="datalabel">ad language</span>
        <p className="mt-1 text-sm text-ink-muted">
          The language your ads are written in. Your dashboard stays in English.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AD_LANGUAGES.map((l) => (
            <button
              key={l.id}
              onClick={() => setAdLanguage(l.id)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                adLanguage === l.id
                  ? "border-accent bg-accent-soft text-ink shadow-[0_0_24px_-10px_rgba(245,133,16,0.7)]"
                  : "border-line bg-surface text-ink-muted hover:border-ink-faint"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        {/*
          Said plainly because the honest answer is "not instantly". Drafts
          already written stay in their own language, and the agent writes
          the new language into the pool on its next run. Without this line
          the only visible effect of changing it is nothing happening, which
          reads as a broken switch.
        */}
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          Drafts already written stay as they are. The agent starts writing in
          the new language on its next run, and your existing ones are kept in
          case you switch back.
        </p>
      </div>

      {/* persona */}
      <div className="mt-6">
        <span className="datalabel">testing style</span>
        <div className="mt-2 flex flex-col gap-2">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPersona(p.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                persona === p.id ? "border-accent bg-accent-soft shadow-[0_0_24px_-10px_rgba(245,133,16,0.7)]" : "border-line bg-surface hover:border-ink-faint"
              }`}
            >
              <div className="text-sm font-medium text-ink">{p.label}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{p.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      {/* One preference, read by both modes. Full auto used to mean "do not
          ask me" AND "go at whatever hour the cron happened to run", which
          nobody chose. Now it only means the first. */}
      <div>
        <div className="datalabel">when your ads go live each day</div>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          {fullAuto
            ? "Full autonomy is on, so this is the hour your ads go up."
            : "This is the time already chosen when you open the evening approval. You can still change it for one night."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[6, 7, 9, 12, 15, 17, 19].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setLaunchHour(h)}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                launchHour === h
                  ? "border-accent bg-accent-soft text-ink shadow-[0_0_24px_-10px_rgba(245,133,16,0.7)]"
                  : "border-line text-ink-muted hover:border-ink-faint"
              }`}
            >
              {h === 12 ? "12 noon" : h < 12 ? `${h}am` : `${h - 12}pm`}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          Mornings give an ad the whole day to gather the views a fair test needs. Evenings suit
          trades where people buy after work.
        </p>
      </div>

      {/* full auto */}
      <div className="mt-6 flex items-center justify-between rounded-lg border border-line bg-surface p-3">
        <div>
          <div className="text-sm font-medium text-ink">Full autonomy</div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {fullAuto ? "The agent launches without asking." : "The agent asks for your approval each evening."}
          </div>
        </div>
        <button
          onClick={() => setFullAuto((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${fullAuto ? "bg-accent shadow-[0_0_10px_rgba(245,133,16,0.6)]" : "bg-surface-overlay"}`}
          aria-pressed={fullAuto}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${fullAuto ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-sm text-positive">Saved.</span>}
        {error && <span className="text-sm text-negative">{error}</span>}
      </div>
    </div>
  );
}
