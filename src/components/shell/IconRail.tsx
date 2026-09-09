"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";
import { GlocalMark } from "@/components/brand/Logo";

/**
 * Tablet-width nav rail, Glocal Web App.dc.html `hasRail`. Between the phone
 * tab bar and the full desktop sidebar there's room for every nav item at
 * once, so the rail lists all of them as compact label tiles rather than
 * picking a primary subset.
 */
export function IconRail({ awaitingApproval = false }: { awaitingApproval?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[78px] shrink-0 flex-col items-center border-r border-line-soft bg-surface py-3.5 md:flex lg:hidden">
      <GlocalMark className="h-7 w-7 shrink-0 text-ink" title="Glocal" />
      <nav className="mt-4 flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex w-[60px] shrink-0 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center text-[10.5px] font-medium leading-tight transition-colors ${
                active ? "bg-surface-overlay text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              <span>{item.label}</span>
              {item.href === "/approve" && awaitingApproval && (
                <span className="absolute right-[9px] top-1 h-1.5 w-1.5 rounded-full bg-accent-bright" />
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
