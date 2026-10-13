import { Skeleton } from "@/components/ui/skeleton";

/**
 * Card-shaped loading placeholder (HIS-2659 item 8).
 *
 * Same dimensions as {@link ArtifactCard}: `aspect-video` preview, a title
 * line, a meta line and the action row. Reserving the real card height is what
 * keeps the first paint from shifting when the data arrives (CLS).
 */
export const ARTIFACT_GRID_CLASS = "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3";

export function ArtifactCardSkeleton() {
  return (
    <div
      data-testid="artifact-card-skeleton"
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="flex flex-col gap-1.5 p-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="mt-1.5 h-9 w-full sm:w-44" />
      </div>
    </div>
  );
}

export function ArtifactCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className={ARTIFACT_GRID_CLASS} data-testid="artifact-card-skeleton-grid">
      {Array.from({ length: count }, (_, index) => (
        <ArtifactCardSkeleton key={index} />
      ))}
    </div>
  );
}
