import { Skeleton, SkeletonCard, SkeletonPage } from "@/components/ui/Skeleton";

/** Matches duel/page.tsx: one wide scoreboard, then the verdict list. */
export default function DuelLoading() {
  return (
    <SkeletonPage>
      <SkeletonCard>
        <Skeleton className="h-3 w-24" />
        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-lg border border-line-soft p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-3 h-5 w-28" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-5 h-3 w-2/3" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton className="h-3 w-20" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="mt-3 h-4 w-full" />
        ))}
      </SkeletonCard>
    </SkeletonPage>
  );
}
