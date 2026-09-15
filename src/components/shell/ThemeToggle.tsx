"use client";

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "@/lib/browser/persisted";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "glocal:theme";

/**
 * Module scope, so every mount shares one store and the value cannot diverge.
 * An unrecognised stored value falls back to "system" rather than being trusted
 * — localStorage is editable by anyone with devtools open.
 */
const themeStore = createPersistedStore<ThemeChoice>(
  THEME_KEY,
  (raw) => (raw === "light" || raw === "dark" || raw === "system" ? raw : "system"),
  "system",
);

/**
 * Theme control: system by default, with an explicit override that persists.
 *
 * The stored value is the *choice*, not the resolved theme, so someone who
 * picked "system" keeps following their device when it changes at sunset. The
 * actual swap happens by stamping data-theme on <html>, which the CSS in
 * globals.css resolves. Removing the attribute hands control back to the
 * prefers-color-scheme media query.
 */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

const LABEL: Record<ThemeChoice, string> = {
  system: "Match device",
  light: "Light",
  dark: "Dark",
};

function Icon({ choice }: { choice: ThemeChoice }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 16,
    height: 16,
    "aria-hidden": true,
  };
  if (choice === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
      </svg>
    );
  }
  if (choice === "dark") {
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4.5" width="18" height="13" rx="2" />
      <path d="M8 21h8" />
    </svg>
  );
}

export function ThemeToggle() {
  // A store rather than useState + an effect. The effect version renders the
  // system default and then re-renders the saved choice from inside the effect,
  // which is a cascading render — and on a theme toggle it is the visible kind:
  // the wrong icon paints for a frame before correcting itself.
  //
  // `ready` is gone with it. It existed only to hide that first wrong paint,
  // and the server snapshot now makes the first paint correct by construction,
  // so there is nothing left to hide.
  const choice = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot,
  );

  function cycle() {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    applyTheme(next);
    themeStore.set(next);
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${LABEL[choice]}`}
      aria-label={`Theme: ${LABEL[choice]}. Click to change.`}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:text-ink"
    >
      {/* Render nothing until the stored choice is known, so the icon cannot
          flash the wrong state on first paint. */}
      <Icon choice={choice} />
    </button>
  );
}
