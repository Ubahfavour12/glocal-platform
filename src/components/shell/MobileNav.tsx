"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";

/**
 * Mobile navigation (Phase 3 polish). The desktop sidebar is hidden below md;
 * this hamburger opens a slide-in drawer with the same links. Closes on route
 * change, outside tap, or Escape.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  // Escape to close; lock body scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-40">
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between px-5 pb-6 pt-6">
              <div>
                <div className="font-mono text-sm font-semibold tracking-wide text-ink">
                  glocal<span className="text-accent-bright">.</span>
                </div>
                <div className="datalabel mt-1">autonomous marketing</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="text-ink-faint transition-colors hover:text-ink"
              >
                ✕
              </button>
            </div>
            <nav className="flex flex-col gap-0.5 px-3">
              {NAV.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? "bg-surface-overlay font-medium text-ink"
                        : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}
