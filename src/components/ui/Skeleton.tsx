/**
 * The pieces every loading screen is built from.
 *
 * There used to be one skeleton, shaped like Today, serving all thirteen
 * dashboard routes. Navigating to Wallet painted a row of metric chips and two
 * cards, then threw that away and drew something completely different. The
 * swap is the "blink" -- not the waiting, the fact that what arrives
 * contradicts what was promised a moment earlier.
 *
 * So the shape lives with the page it belongs to, and this file holds only the
 * parts. The `skeleton` class in globals.css carries the colour and the 180ms
 * delay; nothing here animates on its own.
 */

/** One grey bar. Sized by the caller, because only the caller knows the shape. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />;
}

/** A card-shaped block, matching the real cards' border and padding. */
export function SkeletonCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-card border border-line bg-surface-raised p-6 ${className}`}>
      {children}
    </div>
  );
}

/**
 * The frame every dashboard page shares: the same width, the same rhythm, and
 * the same header block, so only the body below it has to differ.
 *
 * `aria-busy` and the visually-hidden "Loading" are what a screen reader gets;
 * grey rectangles tell it nothing.
 */
export function SkeletonPage({
  children,
  wide = true,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto space-y-8 sm:space-y-10 ${
        wide ? "max-w-5xl 2xl:max-w-6xl" : "max-w-4xl 2xl:max-w-5xl"
      }`}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>
      <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-7 w-56" />
          <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-3 w-28 shrink-0" />
      </div>
      {children}
    </div>
  );
}
