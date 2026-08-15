"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildServiceGeo } from "@/lib/tracking/geo";
import { createClient } from "@/lib/supabase/client";
import { uploadProductMedia } from "@/lib/media/storage";
import { screenCategory } from "@/lib/compliance/categories";
import {
  MIN_DAILY_BUDGET_USD_MINOR,
  minFirstDepositUsdMinor,
} from "@/lib/money/ledger";
import { currencyForCountry, dialCodeForCountry, listCountries } from "@/lib/money/currency";
import { checkWhatsApp, stripTrunkPrefix, waMeLink } from "@/lib/onboarding/phone";
import {
  budgetAdvice,
  countryFromPhone,
  goalDoorMismatch,
  inferCountry,
  OTHER_TRADE,
  OWNER_ROLES,
  readCountrySignals,
  TRADES,
  type Door,
  type Goal,
  type OwnerRole,
} from "@/lib/onboarding/inference";

/**
 * Onboarding, one thumb at a time (UF-1 / PRD F-01).
 *
 * Seven screens on a phone. The order is the argument: money is explained a
 * full screen before it is asked for, the photo step says what the photo
 * becomes, and the last screen points at tomorrow morning instead of throwing
 * confetti. Everything is kept in a local draft, so closing the app mid-flow
 * costs nothing.
 */

type Phase = "business" | "door" | "goal" | "money" | "budget" | "photo" | "next";

const FLOW: Phase[] = ["business", "door", "goal", "money", "budget", "photo", "next"];
/** The last screen is an epilogue, so the counter and the bars stop at six. */
const COUNTED = 6;

const DRAFT_KEY = "glocal.onboarding.draft";

// Display-only example rate until the FX provider is wired (Task #3).
const DEMO_NGN_PER_USD_BUFFERED = 1545;

const DOORS: { id: Door; label: string; hint: string; placeholder: string }[] = [
  {
    id: "whatsapp",
    label: "My WhatsApp",
    hint: "They tap the ad and a chat opens with you.",
    placeholder: "802 555 0117",
  },
  {
    id: "link",
    label: "A link",
    hint: "Your site, a product page, a Linktree.",
    placeholder: "yourshop.com",
  },
  {
    id: "store",
    label: "An online store",
    hint: "Shopify. I read real orders, so I optimise for money.",
    placeholder: "yourshop.myshopify.com",
  },
];

const GOALS: { id: Goal; label: string; hint: string }[] = [
  { id: "whatsapp", label: "WhatsApp conversations", hint: "Someone messages you. Best if you close by chat." },
  { id: "sales", label: "Sales", hint: "A confirmed order. Needs a store, or you telling me." },
  { id: "leads", label: "Leads", hint: "A name and number to follow up." },
  { id: "visits", label: "Shop visits", hint: "Footfall. I can point at maps but I can't count who arrives." },
];

const MONEY_FACTS = [
  {
    icon: "wallet",
    title: "It sits in your wallet, not ours",
    body: "You top up a balance. It is spent on your ads only, and you can see every cent that leaves in the statement.",
  },
  {
    icon: "hold",
    title: "Going live holds seven days of budget",
    body: "It stops your ads dying halfway through a test, which would waste the money already spent. It is still yours.",
  },
  {
    icon: "back",
    title: "Unspent money comes back",
    body: "Ask for it any time and the balance returns to the account you paid from. No lock-in and no minimum term.",
  },
  {
    icon: "tap",
    title: "Nothing spends until you approve",
    body: "Every evening I show you tomorrow's plan. If you do not tap approve, nothing runs and nothing is charged.",
  },
] as const;

const PHOTO_OUTPUTS = [
  { tag: "9:16", label: "Reels and Stories" },
  { tag: "1:1", label: "Feed post" },
  { tag: "4:5", label: "The duel's challengers" },
];

/* ------------------------------------------------------------------ icons */

function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  switch (name) {
    case "back":
      return (
        <svg {...common}>
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="16.5" x2="12" y2="16.5" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M21 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.5A8 8 0 1 1 21 11.5Z" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
          <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5L12.5 17" />
        </svg>
      );
    case "store":
      return (
        <svg {...common}>
          <path d="M4 8h16l-1 12H5L4 8Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h12v4" />
          <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" />
          <path d="M21 11h-4a2 2 0 0 0 0 4h4v-4Z" />
        </svg>
      );
    case "hold":
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "camera":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 9 8 9" />
        </svg>
      );
  }
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`${className} shrink-0 animate-spin rounded-full border-2 border-surface-overlay border-t-accent`}
      aria-hidden
    />
  );
}

/** The agent speaking in its own voice, never as a system warning. */
function AgentNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border-l-2 border-accent bg-accent-soft p-4">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="datalabel text-accent">agent</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">{children}</p>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-negative">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ draft */

interface Draft {
  phase: Phase;
  name: string;
  trade: string;
  otherTrade: string;
  country: string;
  ownerRole: OwnerRole;
  door: Door;
  doorValue: string;
  goal: Goal | null;
  dailyUsd: number;
  savedAt: string;
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "saved today";
  return days === 1 ? "saved yesterday" : `saved ${days} days ago`;
}

/* ------------------------------------------------------------------- page */

export default function OnboardingPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("business");
  const [resuming, setResuming] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [otherTrade, setOtherTrade] = useState("");
  const [country, setCountry] = useState("NG");
  const [countryTouched, setCountryTouched] = useState(false);
  const [ownerRole, setOwnerRole] = useState<OwnerRole>("owner");

  const [door, setDoor] = useState<Door>("whatsapp");
  const [doorValue, setDoorValue] = useState("");
  const [goal, setGoal] = useState<Goal | null>(null);
  const [dailyUsd, setDailyUsd] = useState(10);

  const [media, setMedia] = useState<{ file: File; url: string; isVideo: boolean }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const draftRef = useRef<Draft | null>(null);

  /* -- restore a half-finished run, and infer what we can ---------------- */

  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        if (d && typeof d.phase === "string" && FLOW.includes(d.phase)) {
          draftRef.current = d;
          setName(d.name ?? "");
          setTrade(d.trade ?? "");
          setOtherTrade(d.otherTrade ?? "");
          setCountry(d.country ?? "NG");
          setOwnerRole(d.ownerRole ?? "owner");
          setDoor(d.door ?? "whatsapp");
          setDoorValue(d.doorValue ?? "");
          setGoal(d.goal ?? null);
          setDailyUsd(d.dailyUsd ?? 10);
          setCountryTouched(true);
          // Only worth interrupting for if they got past the first screen.
          if (FLOW.indexOf(d.phase) > 0) {
            setPhase(d.phase);
            setResuming(true);
            restored = true;
          }
        }
      }
    } catch {
      // A corrupt or blocked draft is not worth failing onboarding over.
    }
    // Country is inferred rather than asked: the screen shows the answer and
    // they correct it in one tap if it is wrong.
    if (!restored) setCountry(inferCountry(readCountrySignals()));
    setHydrated(true);
  }, []);

  /* -- keep the draft current ------------------------------------------- */

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          phase, name, trade, otherTrade, country, ownerRole,
          door, doorValue, goal, dailyUsd,
          savedAt: new Date().toISOString(),
        } satisfies Draft),
      );
    } catch {
      // Private-mode storage refusals must not break the flow.
    }
  }, [hydrated, phase, name, trade, otherTrade, country, ownerRole, door, doorValue, goal, dailyUsd]);

  /* -- derived ----------------------------------------------------------- */

  const local = currencyForCountry(country);
  const dial = dialCodeForCountry(country);
  const category = trade === OTHER_TRADE ? otherTrade.trim() : trade;
  const screen = useMemo(() => screenCategory(category), [category]);

  const dailyMinor = Math.max(Math.round(dailyUsd * 100), MIN_DAILY_BUDGET_USD_MINOR);
  const holdMinor = minFirstDepositUsdMinor(dailyMinor);
  const holdUsd = (holdMinor / 100).toFixed(2);
  const holdLocal =
    local.currency === "USD"
      ? null
      : `≈ ${local.symbol}${Math.ceil((holdMinor * DEMO_NGN_PER_USD_BUFFERED) / 100).toLocaleString()}`;

  const mismatch = goal ? goalDoorMismatch(goal, door) : null;
  const advice = budgetAdvice(dailyMinor);

  // Checked against the country's real numbering plan, so a missing digit or
  // a shop landline is caught here rather than after a week of ads pointing at
  // nothing. Whether WhatsApp is registered on it is not knowable from here;
  // the owner settles that with one tap on the link an ad would use.
  const phone = useMemo(
    () => (door === "whatsapp" ? checkWhatsApp(doorValue, country) : null),
    [door, doorValue, country],
  );
  const doorOk =
    door === "whatsapp"
      ? phone?.valid === true
      : /^[\w-]+(\.[\w-]+)+/.test(doorValue.trim().replace(/^https?:\/\//, ""));
  const doorFilled = doorValue.trim().length > 0;
  const doorBad = doorFilled && !doorOk;

  const idx = FLOW.indexOf(phase);
  const chrome = !resuming && phase !== "next";

  const canAdvance =
    phase === "business"
      ? name.trim().length > 1 && category.length > 1 && screen !== "blocked"
      : phase === "door"
        ? doorOk
        : phase === "goal"
          ? goal !== null
          : phase === "photo"
            ? media.length > 0
            : true;

  /* -- navigation -------------------------------------------------------- */

  const go = useCallback((next: Phase) => {
    setResuming(false);
    setPhase(next);
    window.scrollTo({ top: 0 });
  }, []);

  function next() {
    if (!canAdvance) return;
    if (phase === "photo") {
      void finish();
      return;
    }
    if (phase === "next") {
      router.push("/today");
      return;
    }
    go(FLOW[Math.min(FLOW.length - 1, idx + 1)]);
  }

  function back() {
    if (idx > 0) go(FLOW[idx - 1]);
  }

  /* -- media ------------------------------------------------------------- */

  function addFiles(picked: File[]) {
    const room = 5 - media.length;
    if (room <= 0) return;
    const have = new Set(media.map((m) => m.file.name));
    const additions = picked
      .filter((f) => !have.has(f.name))
      .slice(0, room)
      .map((f) => ({ file: f, url: URL.createObjectURL(f), isVideo: f.type.startsWith("video") }));
    if (additions.length > 0) setMedia((m) => [...m, ...additions]);
  }

  function removeMedia(fileName: string) {
    setMedia((m) => {
      const target = m.find((x) => x.file.name === fileName);
      if (target) URL.revokeObjectURL(target.url);
      return m.filter((x) => x.file.name !== fileName);
    });
  }

  /* -- finish ------------------------------------------------------------ */

  async function finish() {
    setSaving(true);
    setSaveError(null);

    const connectionMode = door === "link" ? "website" : door;
    // E.164 for WhatsApp: the one shape wa.me accepts, and the only one that
    // survives being pasted into an ad link without a country code going
    // missing. Guarded above, so e164 is never null here.
    const destination =
      door === "whatsapp" ? (phone?.e164 ?? doorValue.trim()) : doorValue.trim();

    try {
      localStorage.setItem(
        "onboarding",
        JSON.stringify({ name, category, goal, dailyUsd, screen, country, ownerRole }),
      );
    } catch {
      // storage unavailable, proceed anyway
    }

    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const { data: biz, error } = await supabase
            .from("businesses")
            .insert({
              owner_id: userData.user.id,
              name: name.trim(),
              category,
              goal,
              owner_role: ownerRole,
              service_geo: buildServiceGeo(local.countryName, country),
              daily_budget_usd_minor: dailyMinor,
              connection_mode: connectionMode,
              destination,
              country,
              currency: local.currency, // local display currency; USD stays canonical
            })
            .select("id")
            .single();
          if (error) throw new Error(error.message);

          // The photo step promised these become the ads, so actually send
          // them. A failed upload must not strand a created business.
          if (biz?.id) {
            await Promise.allSettled(
              media.map((m) => uploadProductMedia(supabase, biz.id as string, m.file)),
            );
          }

          // Wake the agent: the first concept batch builds in the background
          // (Phase 2.1); the nightly run tops the pipeline up to the target.
          fetch("/api/pipeline/build", { method: "POST", keepalive: true }).catch(() => {});
        }
      } catch (e) {
        setSaving(false);
        setSaveError(
          e instanceof Error ? e.message : "Something went wrong saving your answers.",
        );
        return;
      }
    }

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // nothing to clean up
    }
    setSaving(false);
    go("next");
  }

  /* -- chrome ------------------------------------------------------------ */

  const ctaLabel = saving
    ? "Setting up"
    : phase === "money"
      ? "I understand, ask me the number"
      : phase === "photo"
        ? "Finish setting up"
        : phase === "next"
          ? "Take me to Today"
          : "Continue";

  const footerHint =
    phase === "money"
      ? "No card is needed to finish setting up."
      : phase === "budget"
        ? "You can change this any evening."
        : null;

  if (!hydrated) return <div className="min-h-screen bg-surface" />;

  /* -- returning mid-flow ------------------------------------------------ */

  if (resuming && draftRef.current) {
    const d = draftRef.current;
    const stopped = FLOW.indexOf(d.phase);
    const rows = [
      { label: "business name", value: d.name || "not yet", done: !!d.name },
      { label: "what you sell", value: d.trade || "not yet", done: !!d.trade },
      {
        label: "where ads land",
        value: d.doorValue ? `${DOORS.find((x) => x.id === d.door)?.label}` : "not yet",
        done: !!d.doorValue,
      },
      {
        label: "daily budget",
        value: stopped > 4 ? `$${d.dailyUsd} a day` : "not yet",
        done: stopped > 4,
      },
    ];
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 py-12">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          You stopped at {d.phase === "budget" ? "the budget" : "step " + Math.min(stopped + 1, COUNTED)}.
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
          Everything you filled in is still here. Nothing has been charged and no ads exist yet.
        </p>

        <div className="mt-6 rounded-card border border-line bg-surface-raised p-4">
          <div className="flex items-center justify-between">
            <span className="datalabel">
              {rows.filter((r) => r.done).length} of {COUNTED} done
            </span>
            <span className="datalabel">{relativeDay(d.savedAt)}</span>
          </div>
          <div className="mt-3 flex gap-1">
            {Array.from({ length: COUNTED }).map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i < stopped ? "bg-accent" : "bg-surface-overlay"}`}
              />
            ))}
          </div>
          <ul className="mt-5 flex flex-col gap-3.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-start gap-3">
                {r.done ? (
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                ) : (
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-accent" />
                )}
                <div className="min-w-0">
                  <div className={`text-sm leading-snug ${r.done ? "text-ink" : "text-ink-muted"}`}>
                    {r.value}
                  </div>
                  <div className="datalabel mt-0.5">{r.label}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => go(d.phase)}
          className="mt-5 rounded-lg bg-accent px-6 py-4 text-[15px] font-medium text-white transition-colors hover:bg-accent-bright"
        >
          Pick up where you stopped
        </button>
        <button
          onClick={() => go("business")}
          className="mt-2.5 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          Change something earlier
        </button>
      </main>
    );
  }

  /* -- the flow ---------------------------------------------------------- */

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 pb-8 pt-6">
      {chrome && (
        <header className="shrink-0">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={back}
              disabled={idx === 0}
              aria-label="Back"
              className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-ink transition-opacity disabled:opacity-30"
            >
              <Icon name="back" className="h-5 w-5" />
            </button>
            <span className="datalabel">
              step {Math.min(idx + 1, COUNTED)} of {COUNTED}
            </span>
            <button
              onClick={() => router.push("/today")}
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Save &amp; exit
            </button>
          </div>
          <div className="mt-3 flex gap-1">
            {Array.from({ length: COUNTED }).map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= Math.min(idx, COUNTED - 1) ? "bg-accent" : "bg-surface-overlay"
                }`}
              />
            ))}
          </div>
        </header>
      )}

      <div className="flex-1 pt-7">
        {/* ---------------------------------------------------- 1 business */}
        {phase === "business" && (
          <section>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              First, what should I call you?
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
              This is the name that appears on your ads, so use the one your customers know.
            </p>

            <label className="datalabel mt-7 block" htmlFor="biz-name">
              business name
            </label>
            <input
              id="biz-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Marlango Wines"
              className="mt-2 w-full rounded-lg border border-line bg-surface-raised px-4 py-3.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />

            <div className="datalabel mt-6">what you sell</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">
              I use this to find what is already working in your trade.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {TRADES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTrade(t)}
                  className={`rounded-full border px-4 py-2.5 text-sm transition-colors ${
                    trade === t
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-line text-ink-muted hover:border-ink-faint"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {trade === OTHER_TRADE && (
              <input
                value={otherTrade}
                onChange={(e) => setOtherTrade(e.target.value)}
                placeholder="What do you sell?"
                className="mt-2.5 w-full rounded-lg border border-line bg-surface-raised px-4 py-3.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            )}
            {screen === "blocked" && category.length > 1 && (
              <FieldError>
                This category cannot be advertised through the ad networks, so I would be
                taking your money for ads that never run.
              </FieldError>
            )}
            {screen === "restricted" && (
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                This trade has extra advertising rules. I apply the age and location limits
                the networks require, on every ad.
              </p>
            )}

            <div className="datalabel mt-6">who you are here</div>
            <div className="mt-2.5 flex flex-col gap-2">
              {OWNER_ROLES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setOwnerRole(r.id)}
                  className={`flex items-center justify-between gap-3 rounded-card border px-4 py-3.5 text-left transition-colors ${
                    ownerRole === r.id
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-surface-raised hover:border-ink-faint"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{r.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                      {r.hint}
                    </span>
                  </span>
                  {ownerRole === r.id && (
                    <Icon name="check" className="h-[18px] w-[18px] shrink-0 text-accent" />
                  )}
                </button>
              ))}
            </div>

            <div className="datalabel mt-6">country</div>
            {countryTouched ? (
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-2 w-full rounded-lg border border-line bg-surface-raised px-4 py-3.5 text-base text-ink focus:border-accent focus:outline-none"
              >
                {listCountries().map((c) => (
                  <option key={c.country} value={c.country}>
                    {c.countryName} ({c.symbol} {c.currency})
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3.5">
                <span className="text-base text-ink">{local.countryName}</span>
                <button
                  onClick={() => setCountryTouched(true)}
                  className="datalabel text-accent transition-colors hover:text-accent-bright"
                >
                  not right?
                </button>
              </div>
            )}
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              Every figure stays anchored in USD. I show {local.currency} beside it so you
              always know the real cost.
            </p>
          </section>
        )}

        {/* -------------------------------------------------------- 2 door */}
        {phase === "door" && (
          <section>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              Where should the ads send people?
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
              Every ad ends with one tap. Pick where that tap lands. You can change it later,
              but not per ad.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {DOORS.map((d) => {
                const on = door === d.id;
                return (
                  <div
                    key={d.id}
                    className={`rounded-card border p-4 transition-colors ${
                      on ? "border-accent bg-accent-soft" : "border-line bg-surface-raised"
                    }`}
                  >
                    <button
                      onClick={() => setDoor(d.id)}
                      className="flex w-full items-start gap-3 text-left"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
                          on ? "bg-accent/15 text-accent" : "bg-surface-overlay text-ink-muted"
                        }`}
                      >
                        <Icon
                          name={d.id === "whatsapp" ? "chat" : d.id === "link" ? "link" : "store"}
                          className="h-[18px] w-[18px]"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-ink">{d.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                          {d.hint}
                        </span>
                      </span>
                    </button>

                    {on && (
                      <div className="mt-3.5">
                        <div
                          className={`flex items-center gap-2.5 rounded-lg border bg-surface px-3.5 ${
                            doorBad ? "border-negative" : "border-line"
                          }`}
                        >
                          {d.id === "whatsapp" && (
                            <span className="datalabel shrink-0 text-[15px] normal-case tracking-normal text-ink-muted">
                              {dial}
                            </span>
                          )}
                          <input
                            value={doorValue}
                            onChange={(e) => {
                              const raw = e.target.value;
                              // People type 0802 555 0117 out of habit. Behind
                              // a fixed +234 that is not a number, so fix the
                              // field rather than telling them off.
                              setDoorValue(
                                d.id === "whatsapp" ? stripTrunkPrefix(raw, country) : raw,
                              );
                              // A typed dialling code is deliberate, where the
                              // country is a guess, so let the number win.
                              if (!countryTouched) {
                                const c = countryFromPhone(raw.trim());
                                if (c) setCountry(c);
                              }
                            }}
                            inputMode={d.id === "whatsapp" ? "tel" : "url"}
                            placeholder={d.placeholder}
                            className="min-w-0 flex-1 border-0 bg-transparent py-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none"
                          />
                          {doorFilled && doorOk && (
                            <Icon name="check" className="h-[17px] w-[17px] shrink-0 text-positive" />
                          )}
                        </div>
                        {doorBad && (
                          <FieldError>
                            {d.id === "whatsapp"
                              ? (phone?.problem ??
                                "That is not a complete number. Ads pointing at a dead number go nowhere, so check the digits.")
                              : "That does not look like a web address. Ads pointing at a broken link waste every cent they spend."}
                          </FieldError>
                        )}
                        {doorOk && d.id === "whatsapp" && phone?.e164 && (
                          <div className="mt-2.5">
                            <p className="text-xs leading-relaxed text-ink-faint">
                              A real mobile number in {currencyForCountry(phone.country ?? country).countryName}.
                              I cannot tell from here whether WhatsApp answers on it, so open the
                              link a customer would tap and see for yourself.
                            </p>
                            <a
                              href={waMeLink(phone.e164, `Test from ${name.trim() || "Glocal"}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-accent"
                            >
                              <Icon name="chat" className="h-4 w-4 text-accent" />
                              Open the link your ads will use
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* -------------------------------------------------------- 3 goal */}
        {phase === "goal" && (
          <section>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              What counts as working?
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
              This is what I judge every ad against. Pick the thing you would actually be
              pleased to see more of.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g.id)}
                  className={`flex items-center justify-between gap-3 rounded-card border p-4 text-left transition-colors ${
                    goal === g.id
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-surface-raised hover:border-ink-faint"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium text-ink">{g.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                      {g.hint}
                    </span>
                  </span>
                  {goal === g.id && (
                    <Icon name="check" className="h-[19px] w-[19px] shrink-0 text-accent" />
                  )}
                </button>
              ))}
            </div>
            {mismatch && (
              <div className="mt-3.5">
                <AgentNote>{mismatch}</AgentNote>
              </div>
            )}
          </section>
        )}

        {/* ------------------------------------------------------- 4 money */}
        {phase === "money" && (
          <section>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              Before I ask for a number, here is exactly what happens to your money.
            </h1>
            <div className="mt-6 flex flex-col gap-2.5">
              {MONEY_FACTS.map((f) => (
                <div
                  key={f.title}
                  className="flex items-start gap-3 rounded-card border border-line bg-surface-raised p-4"
                >
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-surface-overlay text-accent">
                    <Icon name={f.icon} className="h-[17px] w-[17px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-snug text-ink">{f.title}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <AgentNote>
                I earn a small percentage of what you spend on ads, and that is it. I do not
                take a cut of your sales. If your ads stop working, tell me to pause and the
                rest of the money is yours.
              </AgentNote>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------ 5 budget */}
        {phase === "budget" && (
          <section>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              How much a day?
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
              You can change this any evening. Nothing is charged now.
            </p>

            <div className="mt-6 rounded-card border border-line bg-surface-raised p-5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[42px] font-semibold leading-none tracking-tight">
                  ${dailyUsd}
                </span>
                <span className="datalabel">per day</span>
              </div>
              {local.currency !== "USD" && (
                <div className="mt-1.5 font-mono text-[13px] text-ink-faint">
                  ≈ {local.symbol}
                  {Math.ceil((dailyMinor * DEMO_NGN_PER_USD_BUFFERED) / 100).toLocaleString()}
                </div>
              )}
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={dailyUsd}
                onChange={(e) => setDailyUsd(Number(e.target.value))}
                aria-label="Daily budget in US dollars"
                className="mt-5 w-full accent-[#b45309]"
              />
              <div className="datalabel mt-1 flex justify-between">
                <span>$10 min</span>
                <span>$100</span>
              </div>
            </div>

            <div className="mt-3 rounded-card border border-line bg-surface-raised p-4">
              <div className="flex items-center justify-between">
                <span className="datalabel">held to go live</span>
                <span className="font-mono text-[17px] font-semibold">${holdUsd}</span>
              </div>
              {holdLocal && <div className="mt-1 text-right font-mono text-xs text-ink-faint">{holdLocal}</div>}
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                Seven days of budget, so ads never cut out mid-test. It stays your money and
                it is still refundable.
              </p>
            </div>

            <div className="mt-3">
              <AgentNote>{advice}</AgentNote>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------- 6 photo */}
        {phase === "photo" && (
          <section>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              Now show me what you sell.
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
              This photo becomes every ad I make. One clear shot of your product is enough to
              start.
            </p>

            {media.length === 0 ? (
              <>
                <div className="mt-6 rounded-card border border-dashed border-line bg-surface-raised px-5 py-9 text-center">
                  <span className="mx-auto flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-surface-overlay text-accent">
                    <Icon name="camera" className="h-[22px] w-[22px]" />
                  </span>
                  <div className="mt-3.5 text-[15px] font-medium text-ink">
                    Take a photo, or pick one
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                    Daylight, plain background, product filling the frame.
                  </p>
                </div>
                <label className="mt-3 block cursor-pointer rounded-lg bg-accent py-3.5 text-center text-[15px] font-medium text-white transition-colors hover:bg-accent-bright">
                  Add a photo
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            ) : (
              <>
                <div className="mt-6 flex flex-col gap-2.5">
                  {media.map((m) => (
                    <div
                      key={m.file.name}
                      className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-4"
                    >
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-surface-overlay">
                        {m.isVideo ? (
                          <video src={m.url} className="h-full w-full object-cover" muted playsInline />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.url} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{m.file.name}</div>
                        <div className="datalabel mt-0.5">
                          {(m.file.size / 1_048_576).toFixed(1)} MB · ready
                        </div>
                      </div>
                      <button
                        onClick={() => removeMedia(m.file.name)}
                        aria-label={`Remove ${m.file.name}`}
                        className="shrink-0 px-2 text-sm text-ink-muted transition-colors hover:text-ink"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {media.length < 5 && (
                    <label className="cursor-pointer rounded-card border border-dashed border-line py-3.5 text-center text-sm text-ink-muted transition-colors hover:border-ink-faint hover:text-ink">
                      Add another angle
                      <input
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          addFiles(Array.from(e.target.files ?? []));
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>

                <div className="mt-4 rounded-card border border-line bg-surface-raised p-4">
                  <div className="datalabel">what I will build from it</div>
                  <div className="mt-3 flex gap-2.5">
                    {PHOTO_OUTPUTS.map((o) => (
                      <div key={o.tag} className="min-w-0 flex-1">
                        <div className="datalabel flex aspect-[4/5] items-center justify-center rounded-[10px] bg-surface-overlay">
                          {o.tag}
                        </div>
                        <div className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">
                          {o.label}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                    Your free render happens from this photo, before you pay for anything.
                  </p>
                </div>
              </>
            )}
            {saveError && <FieldError>{saveError}</FieldError>}
          </section>
        )}

        {/* -------------------------------------------------------- 7 next */}
        {phase === "next" && (
          <section>
            <div className="datalabel">nothing is live yet</div>
            <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">
              Here is what I do next, and when.
            </h1>
            <ol className="ml-3 mt-6 flex flex-col border-l border-surface-overlay">
              {[
                {
                  title: `I read your trade tonight`,
                  body: `What is selling in ${category.toLowerCase() || "your trade"} near you, and which ad angles are doing the work.`,
                  when: "tonight",
                  live: true,
                },
                {
                  title: "I write about fifty concepts",
                  body: "Ranked, with the shot list for each. You can read them all in Pipeline.",
                  when: "tonight",
                  live: false,
                },
                {
                  title: "One free render from your photo",
                  body: "So you can see the quality before you pay for anything.",
                  when: "in an hour",
                  live: false,
                },
                {
                  title: "Tomorrow evening, your first plan",
                  body: "Two ads to approve. Nothing spends until you tap it.",
                  when: "tomorrow",
                  live: false,
                },
              ].map((s) => (
                <li key={s.title} className="relative pb-6 pl-6">
                  <span
                    className={`absolute -left-[13px] top-0 flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line ${
                      s.live ? "bg-accent" : "bg-surface"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${s.live ? "bg-white" : "bg-accent"}`}
                    />
                  </span>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-snug text-ink">{s.title}</div>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{s.body}</p>
                    </div>
                    <span className="datalabel shrink-0">{s.when}</span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <div className="flex items-center justify-between">
                <span className="datalabel">to fund before launch</span>
                <span className="font-mono text-[17px] font-semibold">${holdUsd}</span>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                You can look around first. I will only ask for this when you tell me to go live.
              </p>
            </div>
          </section>
        )}
      </div>

      <footer className="sticky bottom-0 shrink-0 border-t border-line-soft bg-surface pb-2 pt-3">
        {footerHint && (
          <p className="mb-2.5 text-center text-xs text-ink-faint">{footerHint}</p>
        )}
        <button
          onClick={next}
          disabled={!canAdvance || saving}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-accent px-6 py-4 text-base font-medium text-white transition-colors hover:bg-accent-bright disabled:bg-surface-overlay disabled:text-ink-faint"
        >
          {saving && <Spinner />}
          {ctaLabel}
        </button>
      </footer>
    </main>
  );
}
