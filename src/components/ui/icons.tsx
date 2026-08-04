/**
 * A small, consistent line-icon set (Phase 3 polish). Stroke-based, inherit
 * currentColor, 24px viewBox, default h-4 w-4. Kept deliberately restrained so
 * the dashboard reads as one considered product, never clip-art. One accent,
 * hairline weight, matching the mono/editorial design language.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ className = "h-4 w-4", children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </Svg>
);

export const CursorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 3l7 17 2.2-6.8L20 11 4 3Z" />
  </Svg>
);

export const BagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 2 3.5 6V20a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V6L18 2Z" />
    <path d="M3.5 6h17" />
    <path d="M15.5 10a3.5 3.5 0 0 1-7 0" />
  </Svg>
);

export const TrendIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </Svg>
);

export const TrophyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
    <path d="M10 15.5V18M14 15.5V18M8 21h8" />
  </Svg>
);

export const CrownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7l4.5 3.2L12 4l4.5 6.2L21 7l-1.6 11H4.6L3 7Z" />
  </Svg>
);

export const FlagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4" />
    <path d="M5 4c3-1.5 6 1.5 9 0l-1.8 4.2L14 12c-3 1.5-6-1.5-9 0" />
  </Svg>
);

export const WalletIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h12v4" />
    <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" />
    <path d="M21 11h-4a2 2 0 0 0 0 4h4v-4Z" />
  </Svg>
);

export const ArrowInIcon = (p: IconProps) => (
  <Svg {...p}>
    <line x1="17" y1="7" x2="7" y2="17" />
    <polyline points="16 17 7 17 7 8" />
  </Svg>
);

export const ArrowOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="8 7 17 7 17 16" />
  </Svg>
);

export const ReceiptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3v18l2-1 2 1 3-1.5L17 21l2-1V3l-2 1-3-1.5L11 4 9 3 7 4 5 3Z" />
    <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 5v5h-5" />
    <path d="M3 19v-5h5" />
    <path d="M19.4 9A8 8 0 0 0 6 6.3L3 9M21 15l-3 2.7A8 8 0 0 1 4.6 15" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
    <path d="M16 3v3M8 3v3M3.5 9h17" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" />
    <polyline points="9 12 11 14 15 10" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <line x1="9" y1="5" x2="9" y2="19" />
    <line x1="15" y1="5" x2="15" y2="19" />
  </Svg>
);

export const CoinsIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3" />
    <path d="M15 11.3c2.3.4 4 1.5 4 2.7 0 1.7-2.7 3-6 3-1.3 0-2.6-.2-3.6-.6" />
  </Svg>
);

export const FacebookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H6.5v4H9v7h4v-7h2.6l.9-4H13V7a1 1 0 0 1 1-1h2V3Z" />
  </Svg>
);

export const InstagramIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="3.8" />
    <circle cx="17" cy="7" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const TikTokIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 3v11.2a3.2 3.2 0 1 1-3.2-3.2" />
    <path d="M10.5 3c.4 3 2.4 5 6 5.2" />
  </Svg>
);
