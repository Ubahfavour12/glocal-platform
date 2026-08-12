/**
 * Shared dashboard loading state. Every page in this group is a server
 * component that waits on Supabase, so without this the screen stays blank
 * during navigation and the app feels broken on a slow connection.
 *
 * A skeleton that mirrors the real layout (header, metric row, cards) reads as
 * "loading" rather than "empty", and because it matches the shape of what
 * arrives, the content does not jump when it lands.
 */
function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-overlay ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-5xl 2xl:max-w-6xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="mt-2 h-7 w-56" />
          <Shimmer className="mt-2 h-3 w-72 max-w-full" />
        </div>
        <Shimmer className="h-8 w-20" />
      </div>

      {/* metric row */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface-raised px-4 py-3">
            <Shimmer className="h-3 w-16" />
            <Shimmer className="mt-3 h-6 w-24" />
            <Shimmer className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>

      {/* content cards */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface-raised p-5">
            <Shimmer className="h-3 w-20" />
            <Shimmer className="mt-4 h-4 w-full" />
            <Shimmer className="mt-2 h-4 w-4/5" />
            <Shimmer className="mt-6 h-9 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
