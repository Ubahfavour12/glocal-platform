import type { ReactNode } from "react";

/**
 * Building blocks for the founder console. Server components, no state: the
 * console is a read-out, and every number on it comes from the page's queries.
 */

export type Tone = "accent" | "positive" | "negative" | "neutral" | "indigo";

const TONE_TEXT: Record<Tone, string> = {
  accent: "text-accent-bright",
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-ink-muted",
  indigo: "text-[#a5b4fc]",
};
const TONE_DOT: Record<Tone, string> = {
  accent: "bg-accent-bright shadow-[0_0_10px_rgba(255,157,60,0.9)]",
  positive: "bg-positive shadow-[0_0_10px_rgba(52,211,153,0.8)]",
  negative: "bg-negative shadow-[0_0_10px_rgba(251,113,133,0.8)]",
  neutral: "bg-ink-faint",
  indigo: "bg-[#a5b4fc] shadow-[0_0_10px_rgba(165,180,252,0.8)]",
};

export function Dot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]} ${pulse ? "animate-pulse" : ""}`}
    />
  );
}

export function Panel({
  label,
  title,
  aside,
  children,
  className = "",
}: {
  label: string;
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ops-panel p-5 sm:p-6 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="ops-label">{label}</div>
          {title && <h2 className="mt-1.5 text-[17px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>}
        </div>
        {aside}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A headline read-out: label, a big mono figure, one line of context. */
export function Stat({
  label,
  value,
  note,
  tone = "neutral",
  bar,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
  /** 0–1, drawn as a thin meter under the figure. */
  bar?: number;
}) {
  return (
    <div className="ops-panel px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2">
        <Dot tone={tone} />
        <div className="ops-label">{label}</div>
      </div>
      <div className="mt-2.5 font-mono text-[26px] font-semibold leading-none tracking-[-0.04em] text-ink sm:text-[30px]">
        {value}
      </div>
      {typeof bar === "number" && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-overlay">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#e5730a] to-[#ffa54d] shadow-[0_0_10px_rgba(245,133,16,0.7)]"
            style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%` }}
          />
        </div>
      )}
      {note && <div className={`mt-2 text-xs ${tone === "neutral" ? "text-ink-faint" : TONE_TEXT[tone]}`}>{note}</div>}
    </div>
  );
}

/** A status pill, used for customer health and withdrawal state. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const ring: Record<Tone, string> = {
    accent: "border-[rgba(245,133,16,0.35)] bg-[rgba(245,133,16,0.08)]",
    positive: "border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.08)]",
    negative: "border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.08)]",
    neutral: "border-line bg-surface-overlay",
    indigo: "border-[rgba(165,180,252,0.35)] bg-[rgba(165,180,252,0.08)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10.5px] tracking-[0.06em] ${ring[tone]} ${TONE_TEXT[tone]}`}
    >
      <Dot tone={tone} />
      {children}
    </span>
  );
}

/** One line in an event stream: who, what, when, and an optional detail. */
export function Event({
  tone,
  who,
  what,
  when,
  detail,
}: {
  tone: Tone;
  who: string;
  what: ReactNode;
  when: string;
  detail?: string;
}) {
  return (
    <li className="relative flex gap-3 pl-0.5">
      <span className="mt-1.5">
        <Dot tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm text-ink">
            {who} <span className={TONE_TEXT[tone]}>{what}</span>
          </span>
          <span className="font-mono text-[11px] text-ink-faint">{when}</span>
        </div>
        {detail && <div className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-ink-faint">{detail}</div>}
      </div>
    </li>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-faint">
      <Dot tone="positive" />
      {children}
    </div>
  );
}
