import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Card-shaped loading placeholder (HIS-2659 item 8).
 *
 * This is a line-by-line mirror of {@link ArtifactCard}, *including the parts
 * that are conditional in the loaded card* (the status chip and the origin
 * line). Reserving those rows is what keeps the first paint stable: after Deel
 * B almost every card carries a chip, and a card that is taller than its
 * placeholder makes the grid jump when the data lands.
 *
 * The class list on each line is the class list of the real element, so the
 * two only stay in sync if they are edited together.
 *   card body      -> `flex flex-1 flex-col gap-1 p-3`
 *   chip row       -> `flex min-h-5 items-center` around the chip's own box
 *   title          -> `h-5 text-sm leading-5`
 *   meta row       -> `flex min-h-4 items-center gap-1.5`
 *   origin line    -> `text-(length:--text-micro)`
 *   action row     -> `mt-1.5 flex items-center gap-1.5` with `h-9` buttons
 */
export const ARTIFACT_GRID_CLASS = "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3";

/**
 * A placeholder bar that carries the same *text line box* as the line it
 * stands in for.
 *
 * The meta and origin lines of a real card are `--text-micro` text, so their
 * height is a line box (16.5px) and not the `h-4` (16px) that the spacing
 * scale suggests. An invisible label inside the bar reproduces that box
 * exactly, which is what makes the reservation pixel-true without a raw pixel
 * value (the token gate rejects arbitrary bracket values, so a fixed height in
 * tenths of a pixel is not an option).
 */
function TextLineSkeleton({ className, label }: { className?: string; label: string }) {
  return (
    <Skeleton className={cn("text-(length:--text-micro)", className)}>
      <span className="invisible">{label}</span>
    </Skeleton>
  );
}

export function ArtifactCardSkeleton() {
  return (
    <div
      data-testid="artifact-card-skeleton"
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-1 p-3">
        {/* chip row (loaded card: `flex min-h-5 items-center`). The chip itself
            is `px-2 py-0.5` + 1px border + one `--text-micro` line box, so the
            placeholder copies that box instead of guessing `h-5`: an `h-5`
            pill is 2.5px shorter and the row would grow on load. */}
        <div className="flex min-h-5 items-center">
          <Skeleton className="inline-flex w-24 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-(length:--text-micro) font-medium">
            <span className="invisible">Status</span>
          </Skeleton>
        </div>
        {/* title (loaded card: `h-5` title line) */}
        <Skeleton className="h-5 w-3/4" />
        {/* meta row (loaded card: `flex min-h-4 items-center gap-1.5`) */}
        <div className="flex min-h-4 items-center gap-1.5">
          <TextLineSkeleton className="w-1/2" label="Document" />
        </div>
        {/* origin line (loaded card: `text-(length:--text-micro)`) */}
        <TextLineSkeleton className="w-2/5" label="Bron" />
        {/* action row (loaded card: two `size="sm"` buttons = h-9) */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <Skeleton className="h-9 w-full sm:w-20" />
          <Skeleton className="h-9 w-full sm:w-28" />
        </div>
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

/**
 * Placeholder for the RECENTE ARTIFACTS shelf. One row per rendered artifact,
 * built from the same paddings as {@link ArtifactRecentList} (`px-3 py-2`) and
 * the same content boxes as one of its rows: a status chip (which decides the
 * row height when it is there), a `text-sm` title line and the two
 * `--text-micro` meta lines on the right.
 */
export function ArtifactRecentListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul
      data-testid="artifact-recent-skeleton"
      aria-hidden="true"
      className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card"
    >
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-2 px-3 py-2">
          {/* The chip sets the row height (22.5px), so the placeholder copies
              its box rather than guessing `h-5` (see ArtifactCardSkeleton). */}
          <Skeleton className="inline-flex w-20 shrink-0 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-(length:--text-micro) font-medium">
            <span className="invisible">Status</span>
          </Skeleton>
          <Skeleton className="h-5 flex-1" />
          <TextLineSkeleton className="hidden w-28 shrink-0 sm:block" label="Document · 12 kB" />
          <TextLineSkeleton className="w-24 shrink-0" label="13 okt 2026" />
        </li>
      ))}
    </ul>
  );
}
