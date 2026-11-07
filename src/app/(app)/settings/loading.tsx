import { Skeleton, SkeletonCard, SkeletonPage } from "@/components/ui/Skeleton";

/** Matches settings/page.tsx: a stack of independent setting cards. */
export default function SettingsLoading() {
  return (
    <SkeletonPage>
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
          <Skeleton className="mt-5 h-9 w-36" />
        </SkeletonCard>
      ))}
    </SkeletonPage>
  );
}
