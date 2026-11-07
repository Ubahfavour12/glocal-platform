import { Skeleton, SkeletonCard, SkeletonPage } from "@/components/ui/Skeleton";

/** Matches wallet/page.tsx: the balance and rate pair, then the funding card. */
export default function WalletLoading() {
  return (
    <SkeletonPage>
      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <SkeletonCard>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-9 w-40" />
          <Skeleton className="mt-6 h-3 w-full" />
          <Skeleton className="mt-2 h-2 w-full rounded-full" />
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-8 w-32" />
          <Skeleton className="mt-3 h-3 w-5/6" />
        </SkeletonCard>
      </div>
      <SkeletonCard>
        <Skeleton className="h-3 w-20" />
        <div className="mt-4 flex items-end gap-3">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-40" />
        </div>
        <Skeleton className="mt-5 h-16 w-full" />
      </SkeletonCard>
    </SkeletonPage>
  );
}
