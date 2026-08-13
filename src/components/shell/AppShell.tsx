"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { AskAgent } from "@/components/agent/AskAgent";

const COLLAPSE_KEY = "glocal:nav-collapsed";

/**
 * Dashboard shell (Phase 3 polish). Holds the desktop sidebar's collapsed state
 * so the menu is retractable: a hamburger in the header opens/closes it, and the
 * choice persists across navigation and reloads. Mobile keeps its own slide-in
 * drawer (MobileNav) unchanged.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore the saved preference after mount (localStorage is client-only).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* private mode / unavailable — default to expanded */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen">
      {!collapsed && <Sidebar />}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-line-soft px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
          <div className="flex items-center gap-2">
            {/* desktop-only collapse toggle; mobile uses MobileNav's own button */}
            <button
              onClick={toggle}
              aria-label={collapsed ? "Open menu" : "Close menu"}
              aria-expanded={!collapsed}
              className="hidden h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:text-ink lg:flex"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
              </svg>
            </button>
            <MobileNav />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-12">{children}</main>
      </div>
      <AskAgent />
    </div>
  );
}
