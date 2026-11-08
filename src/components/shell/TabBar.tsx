"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "./nav";
import { MenuIcon } from "@/components/ui/icons";
import { navIcon } from "./navIcons";

/**
 * Phone-width bottom tab bar, Glocal Mobile.dc.html. Five slots: the four
 * daily-loop screens plus a More sheet for everything else in nav.ts, so the
 * bar never crowds below a 44px tap target.
 */
const PRIMARY_HREFS = ["/today", "/approve", "/duel", "/wallet"];

export function TabBar({ awaitingApproval = false }: { awaitingApproval?: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet when the route changes — adjusted during render, not in an
  // effect. React documents this exact case: an effect would paint the new page
  // with the old sheet still open and then close it in a second render, which
  // is the cascading render the compiler rejects and which you can see as a
  // flash of the menu over the page you just navigated to. Setting state during
  // render of the SAME component is allowed and re-runs before anything paints.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMoreOpen(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("keydown", onKey);
    if (moreOpen) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [moreOpen]);

  const primary = PRIMARY_HREFS.map((href) => NAV.find((n) => n.href === href)).filter(
    (n): n is (typeof NAV)[number] => Boolean(n),
  );
  const overflow = NAV.filter((n) => !PRIMARY_HREFS.includes(n.href));
  const onOverflowRoute = overflow.some((n) => pathname.startsWith(n.href));

  return (
    <>
      {/* Floats above the content as a frosted pill, Glocal Web App.dc.html. */}
      <nav
        aria-label="Main"
        className="gl-glass fixed inset-x-2.5 z-30 grid grid-cols-5 gap-1 rounded-[22px] border border-line p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)] md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
      >
        {primary.map((item) => {
          const Icon = navIcon(item.href);
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-2xl py-1.5 text-[10px] font-medium transition-colors ${
                active ? "bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--lit-edge)]" : "text-ink-muted"
              }`}
            >
              <Icon className={`h-[20px] w-[20px] ${active ? "text-accent-bright" : ""}`} />
              <span>{item.label === "The Duel" ? "Duel" : item.label}</span>
              {item.href === "/approve" && awaitingApproval && (
                <span className="absolute right-[28%] top-1.5 h-1.5 w-1.5 rounded-full bg-accent-bright shadow-[0_0_8px_rgba(245,133,16,0.9)]" />
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="Everything else"
          className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-2xl py-1.5 text-[10px] font-medium transition-colors ${
            moreOpen || onOverflowRoute ? "bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--lit-edge)]" : "text-ink-muted"
          }`}
        >
          <MenuIcon className={`h-[20px] w-[20px] ${moreOpen || onOverflowRoute ? "text-accent-bright" : ""}`} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />
          <div
            className="gl-glass gl-sheet absolute inset-x-0 bottom-0 rounded-t-[26px] border-t border-line p-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <div className="mb-3 px-1 text-base font-semibold text-ink">Everything else</div>
            <div className="grid grid-cols-2 gap-2">
              {overflow.map((item) => {
                const Icon = navIcon(item.href);
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col gap-2 rounded-2xl border px-4 py-3.5 text-sm font-medium text-ink transition-colors [background-image:var(--card-sheen)] ${
                      active ? "border-[var(--lit-edge)] bg-accent-soft" : "border-line bg-surface-raised hover:border-ink-faint"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] text-accent-bright" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
