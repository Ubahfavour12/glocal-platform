"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";
import { GlocalMark } from "@/components/brand/Logo";

/** Web navigation, UI Plan §2.1. Desktop-only; the mobile drawer mirrors it. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line-soft bg-surface lg:flex xl:w-64">
      <div className="px-5 pb-6 pt-6">
        <div className="flex items-center gap-2.5">
          <GlocalMark className="h-7 w-7 shrink-0 text-ink" title="Glocal" />
          <span className="font-mono text-sm font-semibold tracking-wide text-ink">
            glocal<span className="text-accent-bright">.</span>
          </span>
        </div>
        <div className="datalabel mt-1">autonomous marketing</div>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
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
      <div className="mt-auto px-5 pb-5">
        <div className="datalabel">preview mode</div>
        <div className="mt-1 text-xs text-ink-faint">Fund your wallet to go live</div>
      </div>
    </aside>
  );
}
