import { AlertTriangle } from "lucide-react";
import { Link } from "@/lib/router";
import { artifactFilename } from "@/lib/artifact-display";
import { summarizeArtifactStatuses } from "@/lib/artifact-status";
import type { CompanyArtifact } from "@/api/artifacts";
import { ArtifactStatusChip } from "@/components/artifacts/ArtifactStatusChip";

const MAX_ROWS = 3;

/**
 * The reserved box the priority panel lives in (HIS-2659 criterion e).
 *
 * It is rendered unconditionally — by the loading skeleton and by both loaded
 * states — and it is what makes the panel cost no layout shift. A block that
 * is *inserted* above the recents shelf pushes that shelf down by its own
 * height, and that push is the shift. Reserving the block in the skeleton only
 * does not help: on a list where nothing needs attention the page would then
 * shrink by the same amount, which scores identically. So the box is always
 * there and always the same height, and the panel appears inside it.
 *
 * Item 5 is untouched: with nothing to do there is no panel in the DOM and
 * nothing is visible; the empty slot is 48px of air. That is the trade-off,
 * and it is the right way round — a constant band the eye ignores beats a
 * shelf that jumps while you are reading it.
 *
 * The skeleton renders this same component, so the reserved box and the loaded
 * box cannot drift apart (exactly like `ArtifactStatusChipPlaceholder`).
 */
export function ArtifactPriorityPanelSlot({ artifacts }: { artifacts?: CompanyArtifact[] }) {
  return (
    <div data-testid="artifact-priority-slot" className="h-12">
      {artifacts ? <ArtifactPriorityPanel artifacts={artifacts} /> : null}
    </div>
  );
}

/**
 * Priority panel (HIS-2659: PRIORITEITSPANEEL).
 *
 * Answers "wat vraagt actie?" in the first screen. It renders only when at
 * least one loaded artifact is red or orange (item 5), and it is derived
 * entirely from the artifact list we already fetched, so opening it costs no
 * extra API call.
 *
 * It fills its {@link ArtifactPriorityPanelSlot} exactly (`h-full`) so its
 * contents can never make the reserved box taller, and it stays one line: a
 * strip. The named artifacts are still reachable — their cards carry the same
 * red/orange chip a few rows lower, which is what the list is for.
 */
export function ArtifactPriorityPanel({ artifacts }: { artifacts: CompanyArtifact[] }) {
  const summary = summarizeArtifactStatuses(artifacts);
  if (summary.failure === 0 && summary.review === 0) return null;

  const visible = summary.attention.slice(0, MAX_ROWS);
  const hidden = summary.attention.length - visible.length;

  return (
    <section
      data-testid="artifact-priority-panel"
      data-failure={summary.failure}
      data-review={summary.review}
      aria-labelledby="artifact-priority-heading"
      // `h-full` + `overflow-hidden`: the panel fills its slot and can never
      // grow past it, at any width or zoom. The slot owns the height; the
      // panel only owns its contents.
      className="flex h-full items-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-3 py-2"
    >
      <AlertTriangle
        className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <h2 id="artifact-priority-heading" className="shrink-0 text-sm font-semibold text-foreground">
        Aandacht nodig
      </h2>
      {/* `min-w-0 truncate` (not `shrink-0`): on a narrow screen this is the
          last thing on the row, and an ellipsis is a better outcome than a
          clipped number. On wide screens the list below takes the free space,
          so this never actually shrinks. */}
      <span className="min-w-0 truncate text-(length:--text-micro) text-muted-foreground">
        {summary.attention.length === 1
          ? "1 artifact vraagt actie"
          : `${summary.attention.length} artifacts vragen actie`}
        {summary.failure > 0 ? ` · ${summary.failure} gefaald` : ""}
      </span>

      {/* The named artifacts. Hidden on the narrowest screens: there a single
          line of chips would be clipped anyway, and the count plus the cards
          below already answer the question. `hidden sm:flex` (and not a
          conditional render) also keeps this list in the DOM for tests. */}
      <ul className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:flex">
        {visible.map(({ artifact, status }) => (
          <li key={`${artifact.source}:${artifact.id}`} className="min-w-0">
            <Link
              to={artifact.href}
              disableIssueQuicklook
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArtifactStatusChip status={status} className="shrink-0" />
              <span className="min-w-0 truncate text-xs text-foreground/85">
                {artifactFilename(artifact)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {hidden > 0 ? (
        <span className="ml-auto hidden shrink-0 text-(length:--text-micro) text-muted-foreground sm:block">
          +{hidden} meer
        </span>
      ) : null}
    </section>
  );
}
