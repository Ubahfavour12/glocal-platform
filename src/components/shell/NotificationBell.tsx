"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Item {
  text: string;
  time: string;
  at: string | null;
}

const SEEN_KEY = "glocal:notif:seen";

/**
 * In-app notification bell (Phase 3). Reads the agent's recent activity from
 * /api/notifications and shows a dot when there's something newer than what the
 * owner last saw. Deliberately lightweight, the full trail lives on /activity.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unread, setUnread] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // `load` lives INSIDE the effect, not in the component body. Declared outside
  // it is a function the compiler sees called straight from an effect while
  // calling setState, which it flags as a cascading render. It is also a fresh
  // function on every render, so the interval would capture whichever copy
  // happened to exist when the effect first ran — harmless today only because
  // the dependency list is empty.
  //
  // `cancelled` guards the unmount case: a fetch in flight when the bell
  // unmounts would otherwise setState on a component that is gone.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/notifications");
        const data = (await res.json()) as { items: Item[] };
        if (cancelled) return;
        setItems(data.items ?? []);
        const newest = data.items?.[0]?.at ?? null;
        let seen: string | null = null;
        try {
          seen = localStorage.getItem(SEEN_KEY);
        } catch {
          /* private mode: treat everything as unseen rather than failing */
        }
        setUnread(Boolean(newest) && newest !== seen);
      } catch {
        /* bell is best-effort */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    load();
    const id = setInterval(load, 90_000); // gentle refresh; no device push
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items[0]?.at) {
      localStorage.setItem(SEEN_KEY, items[0].at);
      setUnread(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-bright ring-2 ring-surface" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-card border border-line bg-surface-raised shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="datalabel">activity</div>
            <Link href="/activity" onClick={() => setOpen(false)} className="text-xs text-accent-bright hover:underline">
              See all
            </Link>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!loaded ? (
              <p className="px-4 py-6 text-center text-sm text-ink-faint">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">
                Nothing yet. The agent starts working once you&apos;re set up.
              </p>
            ) : (
              <ul className="flex flex-col">
                {items.map((it, i) => (
                  <li key={i} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <p className="flex-1 text-sm text-ink">{it.text}</p>
                    <span className="shrink-0 font-mono text-xs text-ink-faint">{it.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
