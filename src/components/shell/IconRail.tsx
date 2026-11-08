"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";
import { navIcon } from "./navIcons";
import { GlocalMark } from "@/components/brand/Logo";

/**
 * Tablet-width nav rail, Glocal Web App.dc.html `hasRail`. Between the phone
 * tab bar and the full desktop sidebar there's room for every destination at
 * once, so the rail lists all of them as icon-and-label tiles.
 */
export function IconRail({ awaitingApproval = false }: { awaitingApproval?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="gl-glass hidden w-[84px] shrink-0 flex-col items-center border-r border-line-soft py-3.5 md:flex lg:hidden">
      <GlocalMark className="h-7 w-7 shrink-0 text-ink" title="Glocal" />
      <nav className="mt-4 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = navIcon(item.href);
          const label = item.label === "The Duel" ? "Duel" : item.label === "Strategy Studio" ? "Studio" : item.label;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex w-[66px] shrink-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center text-[10px] font-medium leading-tight transition-colors ${
                active
                  ? "bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--lit-edge)]"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              <Icon className={`h-[19px] w-[19px] ${active ? "text-accent-bright" : "text-ink-faint"}`} />
              <span>{label}</span>
              {item.href === "/approve" && awaitingApproval && (
                <span className="absolute right-[13px] top-1.5 h-1.5 w-1.5 rounded-full bg-accent-bright shadow-[0_0_8px_rgba(245,133,16,0.9)]" />
              )}
            </Link>
          );
        })}
      </nav>
      <span className="gl-orb mt-2 h-2 w-2 rounded-full" title="Agent running" />
    </aside>
  );
}
