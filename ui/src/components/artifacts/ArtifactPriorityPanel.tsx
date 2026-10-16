import { AlertTriangle } from "lucide-react";
import { Link } from "@/lib/router";
import { artifactFilename, artifactOriginLabel } from "@/lib/artifact-display";
import { summarizeArtifactStatuses } from "@/lib/artifact-status";
import type { CompanyArtifact } from "@/api/artifacts";
import { ArtifactStatusChip } from "@/components/artifacts/ArtifactStatusChip";

const MAX_ROWS = 4;

/**
 * Priority panel (HIS-2659: PRIORITEITSPANEEL).
 *
 * Answers "wat vraagt actie?" in the first screen. It renders only when at
 * least one loaded artifact is red or orange, and it is derived entirely from
 * the artifact list we already fetched: opening it costs no extra API call.
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
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <h2 id="artifact-priority-heading" className="text-sm font-semibold text-foreground">
          Aandacht nodig
        </h2>
        <span className="text-(length:--text-micro) text-muted-foreground">
          {summary.attention.length === 1
            ? "1 artifact vraagt actie"
            : `${summary.attention.length} artifacts vragen actie`}
          {summary.failure > 0 ? ` · ${summary.failure} gefaald` : ""}
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {visible.map(({ artifact, status }) => {
          const origin = artifactOriginLabel(artifact);
          return (
            <li key={`${artifact.source}:${artifact.id}`}>
              <Link
                to={artifact.href}
                disableIssueQuicklook
                className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArtifactStatusChip status={status} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">
                  {artifactFilename(artifact)}
                </span>
                {origin ? (
                  <span className="hidden shrink-0 text-(length:--text-micro) text-muted-foreground/70 sm:block">
                    {origin}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {hidden > 0 ? (
        <p className="mt-2 pl-2 text-(length:--text-micro) text-muted-foreground">
          +{hidden} meer verderop in de lijst
        </p>
      ) : null}
    </section>
  );
}
