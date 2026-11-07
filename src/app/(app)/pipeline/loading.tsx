import { Skeleton, SkeletonCard, SkeletonPage } from "@/components/ui/Skeleton";

/** Matches pipeline/page.tsx: a narrower column of ranked concepts. */
export default function PipelineLoading() {
  return (
    <SkeletonPage wide={false}>
      <SkeletonCard>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-2 w-full rounded-full" />
      </SkeletonCard>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface-raised p-5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
