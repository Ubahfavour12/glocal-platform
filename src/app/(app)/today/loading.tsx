import { Skeleton, SkeletonCard, SkeletonPage } from "@/components/ui/Skeleton";

/** Matches today/page.tsx: five metric chips, two cards, the pipeline bar. */
export default function TodayLoading() {
  return (
    <SkeletonPage>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface-raised px-4 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonCard key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-6 h-9 w-32" />
          </SkeletonCard>
        ))}
      </div>
      <SkeletonCard>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-2 w-full rounded-full" />
        <Skeleton className="mt-3 h-4 w-3/4" />
      </SkeletonCard>
    </SkeletonPage>
  );
}
