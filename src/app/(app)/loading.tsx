import { Skeleton, SkeletonCard, SkeletonPage } from "@/components/ui/Skeleton";

/**
 * The fallback for dashboard routes that have no skeleton of their own.
 *
 * DELIBERATELY SHAPELESS. The previous version of this file was shaped like
 * Today -- a five-chip metric row and two side-by-side cards -- and served all
 * thirteen routes in the group. Opening Wallet drew Today's layout and then
 * replaced it wholesale, which is what the blink between pages actually was.
 *
 * A skeleton that matches is worth writing, and the busiest routes have one.
 * For the rest, a header and two plain blocks is the most that can be promised
 * without promising something false.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage>
      <SkeletonCard>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-4/5" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-4 h-4 w-3/4" />
      </SkeletonCard>
    </SkeletonPage>
  );
}
