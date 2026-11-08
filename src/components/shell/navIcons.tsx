import {
  CheckIcon,
  ClockIcon,
  DocIcon,
  LayersIcon,
  LeafIcon,
  PulseIcon,
  RocketIcon,
  SlidersIcon,
  SparkleIcon,
  TrophyIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/ui/icons";

/**
 * One icon per destination in nav.ts, shared by the sidebar, the tablet rail,
 * the phone tab bar and its More sheet, so a screen is recognised by the same
 * glyph on every device. A destination without an entry falls back to Layers.
 */
export const NAV_ICON: Record<string, typeof PulseIcon> = {
  "/today": PulseIcon,
  "/approve": CheckIcon,
  "/duel": TrophyIcon,
  "/pipeline": LayersIcon,
  "/leads": UsersIcon,
  "/organic": LeafIcon,
  "/wallet": WalletIcon,
  "/statement": DocIcon,
  "/upgrade": RocketIcon,
  "/studio": SparkleIcon,
  "/activity": ClockIcon,
  "/settings": SlidersIcon,
};

export function navIcon(href: string) {
  return NAV_ICON[href] ?? LayersIcon;
}
