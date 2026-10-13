import { cn } from "@/lib/utils";
import type { ArtifactStatus, ArtifactStatusTone } from "@/lib/artifact-status";

/**
 * The single status chip a card may show (HIS-2659 item 2).
 *
 * The backdrop is intentionally opaque-ish: the chip sits on top of an image or
 * video frame, so a translucent tone fill alone would not stay readable.
 */
const TONE_CLASSES: Record<ArtifactStatusTone, string> = {
  red: "border-rose-500/40 text-rose-700 dark:text-rose-300",
  orange: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  green: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  grey: "border-border text-muted-foreground",
};

const DOT_CLASSES: Record<ArtifactStatusTone, string> = {
  red: "bg-rose-500",
  orange: "bg-amber-500",
  green: "bg-emerald-500",
  grey: "bg-muted-foreground/50",
};

export function ArtifactStatusChip({
  status,
  className,
}: {
  status: ArtifactStatus;
  className?: string;
}) {
  return (
    <span
      data-testid="artifact-status-chip"
      data-tone={status.tone}
      data-reason={status.reason}
      title={status.reason}
      aria-label={`Status: ${status.label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background/90 px-2 py-0.5 text-(length:--text-micro) font-medium shadow-sm backdrop-blur-sm",
        TONE_CLASSES[status.tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[status.tone])} />
      {status.label}
    </span>
  );
}
