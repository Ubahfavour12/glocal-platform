"use client";

import { useSyncExternalStore } from "react";
import { Sidebar } from "./Sidebar";
import { IconRail } from "./IconRail";
import { TabBar } from "./TabBar";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { AskAgent } from "@/components/agent/AskAgent";
import { createPersistedStore } from "@/lib/browser/persisted";

const COLLAPSE_KEY = "glocal:nav-collapsed";

/** Module scope: one store shared by every mount, so the value cannot diverge. */
const collapseStore = createPersistedStore(COLLAPSE_KEY, (raw) => raw === "1", false);

/**
 * Dashboard shell (Phase 3 polish). Holds the desktop sidebar's collapsed state
 * so the menu is retractable: a hamburger in the header opens/closes it, and the
 * choice persists across navigation and reloads. Below desktop width, IconRail
 * (tablet) and TabBar (phone) carry navigation instead — Glocal Web App.dc.html's
 * three nav shells (`hasSidebar` / `hasRail` / `hasTabs`).
 */
export function AppShell({
  children,
  awaitingApproval = false,
}: {
  children: React.ReactNode;
  awaitingApproval?: boolean;
}) {
  // Read through a store rather than useState + an effect. The effect version
  // renders expanded, then re-renders collapsed from inside the effect — a
  // cascading render the compiler rejects, and one you can see as the sidebar
  // snaps shut a frame after paint.
  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    collapseStore.getSnapshot,
    collapseStore.getServerSnapshot,
  );

  function toggle() {
    collapseStore.set(!collapsed, (v) => (v ? "1" : "0"));
  }

  return (
    <div className="flex min-h-screen">
      {!collapsed && <Sidebar />}
      {!collapsed && <IconRail awaitingApproval={awaitingApproval} />}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-line-soft px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
          <div className="flex items-center gap-2">
            {/* Desktop-only collapse toggle. Tablet and phone get their own
                dedicated nav chrome (IconRail / TabBar) instead of a drawer. */}
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
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-8 lg:px-8 xl:px-12">
          {children}
        </main>
      </div>
      <TabBar awaitingApproval={awaitingApproval} />
      <AskAgent />
    </div>
  );
}
