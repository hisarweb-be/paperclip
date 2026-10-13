import { Link } from "@/lib/router";
import type { CompanyArtifact } from "@/api/artifacts";
import {
  artifactByteSize,
  artifactByteSizeLabel,
  artifactDateTimeLabel,
  artifactFilename,
  artifactMediaKindLabel,
  artifactSortTime,
  createdAtText,
} from "@/lib/artifact-display";
import { artifactStatus } from "@/lib/artifact-status";
import { ArtifactStatusChip } from "@/components/artifacts/ArtifactStatusChip";

const MAX_ROWS = 5;

function timeLabel(artifact: CompanyArtifact): string {
  const created = createdAtText(artifact);
  return artifactDateTimeLabel(created || artifact.updatedAt);
}

/**
 * RECENTE ARTIFACTS (HIS-2659).
 *
 * A compact shelf with the newest artifacts, newest first by `createdAt`. It is
 * a list of links rather than a second card grid on purpose: previews are the
 * expensive part of the grid, so the first screen answers "wat is er nieuw?"
 * without paying for a duplicate set of images.
 */
export function ArtifactRecentList({ artifacts }: { artifacts: CompanyArtifact[] }) {
  const recent = [...artifacts]
    .sort((a, b) => artifactSortTime(b) - artifactSortTime(a))
    .slice(0, MAX_ROWS);
  if (recent.length === 0) return null;

  return (
    <ul
      data-testid="artifact-recent-list"
      className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card"
    >
      {recent.map((artifact) => {
        const status = artifactStatus(artifact);
        const sizeLabel = artifactByteSizeLabel(artifactByteSize(artifact));
        const meta = [artifactMediaKindLabel(artifact.mediaKind), sizeLabel]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={`${artifact.source}:${artifact.id}`}>
            <Link
              to={artifact.href}
              disableIssueQuicklook
              className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {status ? <ArtifactStatusChip status={status} className="shrink-0" /> : null}
              <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">
                {artifactFilename(artifact)}
              </span>
              {meta ? (
                <span className="hidden shrink-0 text-(length:--text-micro) text-muted-foreground/70 sm:block">
                  {meta}
                </span>
              ) : null}
              <span className="shrink-0 text-(length:--text-micro) text-muted-foreground/70">
                {timeLabel(artifact)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
