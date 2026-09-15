"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "./nav";
import { BoltIcon, CheckIcon, MenuIcon, TrophyIcon, WalletIcon } from "@/components/ui/icons";

/**
 * Phone-width bottom tab bar, Glocal Mobile.dc.html. Five slots: the four
 * daily-loop screens plus a More sheet for everything else in nav.ts, so the
 * bar never crowds below a 44px tap target.
 */
const PRIMARY_HREFS = ["/today", "/approve", "/duel", "/wallet"];
const TAB_ICON: Record<string, typeof BoltIcon> = {
  "/today": BoltIcon,
  "/approve": CheckIcon,
  "/duel": TrophyIcon,
  "/wallet": WalletIcon,
};

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
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line-soft bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primary.map((item) => {
          const Icon = TAB_ICON[item.href];
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
                active ? "text-ink" : "text-ink-muted"
              }`}
            >
              <Icon className="h-[21px] w-[21px]" />
              <span>{item.label === "The Duel" ? "Duel" : item.label}</span>
              {item.href === "/approve" && awaitingApproval && (
                <span className="absolute right-[26%] top-1.5 h-1.5 w-1.5 rounded-full bg-accent-bright" />
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="Everything else"
          className={`flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
            moreOpen || onOverflowRoute ? "text-ink" : "text-ink-muted"
          }`}
        >
          <MenuIcon className="h-[21px] w-[21px]" />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line" />
            <div className="grid grid-cols-2 gap-2">
              {overflow.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-ink-faint"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
