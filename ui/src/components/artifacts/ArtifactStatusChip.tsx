import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { chipCssVar } from "@/lib/state-chip";
import type { ArtifactStatus } from "@/lib/artifact-status";

/**
 * The single status chip a card may show (HIS-2659 item 2).
 *
 * It renders with the house recipe — `.status-chip` plus a local `--sc` hue —
 * exactly like the work-product chips in `RichWorkProductCard`, so an artifact
 * and an issue work product in the same tone are visually the same object. The
 * previous revision carried a private rose/amber/emerald palette; that was the
 * rejected route.
 */
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
        "status-chip inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-(length:--text-micro) font-medium leading-none",
        status.dashed && "border-dashed",
        className,
      )}
      style={{ "--sc": `var(${chipCssVar(status.tone)})` } as CSSProperties}
    >
      {status.label}
    </span>
  );
}

/**
 * The chip's own box, rendered invisibly.
 *
 * The chip row is *always* present in a card so that a chip appearing cannot
 * change the card's height (HIS-2659, CLS criterion: "reserveer de chipruimte
 * in de kaartromp met een vaste hoogte"). Copying this exact box — rather than
 * guessing `h-5` — is what makes the reservation pixel-true: `px-2 py-0.5` plus
 * a 1px border plus a `--text-micro` line box is taller than `h-5`.
 *
 * The skeleton uses the same component, so the reserved box and the loaded box
 * cannot drift apart.
 */
export function ArtifactStatusChipPlaceholder() {
  return (
    <span
      aria-hidden="true"
      className="invisible inline-flex shrink-0 items-center rounded-full border border-transparent px-2 py-0.5 text-(length:--text-micro) font-medium leading-none"
    >
      Status
    </span>
  );
}
