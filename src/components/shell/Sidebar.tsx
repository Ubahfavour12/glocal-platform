"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";
import { navIcon } from "./navIcons";
import { GlocalMark } from "@/components/brand/Logo";

/**
 * Desktop navigation, Glocal Web App.dc.html `hasSidebar`. Every destination
 * carries the same icon it has on the tablet rail and the phone tab bar; the
 * active one is lit with the accent so it reads at a glance from across a desk.
 */
export function Sidebar({ awaitingApproval = false }: { awaitingApproval?: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="gl-glass hidden w-60 shrink-0 flex-col border-r border-line-soft lg:flex xl:w-64">
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-center gap-2.5">
          <GlocalMark className="h-7 w-7 shrink-0 text-ink" title="Glocal" />
          <span className="text-[17px] font-semibold tracking-[-0.03em] text-ink">
            glocal<span className="text-accent-bright">.</span>
          </span>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = navIcon(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent-soft font-semibold text-ink shadow-[inset_0_0_0_1px_var(--lit-edge)]"
                  : "text-ink-muted hover:bg-surface-raised hover:text-ink"
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-accent shadow-[0_0_12px_rgba(245,133,16,0.9)]"
                />
              )}
              <Icon className={`h-[17px] w-[17px] shrink-0 ${active ? "text-accent-bright" : "text-ink-faint"}`} />
              <span className="flex-1">{item.label}</span>
              {item.href === "/approve" && awaitingApproval && (
                <span className="h-2 w-2 rounded-full bg-accent-bright shadow-[0_0_10px_rgba(245,133,16,0.9)]" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mx-3 mb-4 mt-auto rounded-2xl border border-line bg-surface-raised px-4 py-3 [background-image:var(--card-sheen)]">
        <div className="flex items-center gap-2">
          <span className="gl-orb h-2 w-2 rounded-full" />
          <span className="text-xs text-ink-muted">Agent running nightly</span>
        </div>
        <div className="mt-1 text-xs text-ink-faint">Tomorrow&rsquo;s plan arrives at 18:00</div>
      </div>
    </aside>
  );
}
