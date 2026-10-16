import type { CompanyArtifact } from "@/api/artifacts";
import { stateChipFor, type StateChip } from "@/lib/state-chip";

/**
 * The single status a card may show (HIS-2659 item 2).
 *
 * This is a *thin adapter* over the house vocabulary in `lib/state-chip`
 * (`stateChipFor`) and nothing more. The previous revision carried its own
 * dictionary — tones `red`/`orange`/`green`/`grey` with invented labels such as
 * `Gefaald`, `Te keuren`, `Nieuw` and `Archief`. That was the rejected route:
 * the page must speak the same language as the work-product chips that already
 * exist in the repo, not a second one next to it.
 *
 * Consequences of aligning exactly on `stateChipFor`:
 * - `reviewState`/`status = changes_requested` -> failure (red)
 * - `status = failed | unhealthy | down`       -> failure (red)
 * - `reviewState = needs_board_review` or
 *   `status = ready_for_review`                -> review (orange)
 * - `status = pending | opening`               -> progress (dashed)
 * - an approved/resting artifact gets **no chip**: in the house vocabulary a
 *   completed work product stays quiet.
 * - an artifact that carries none of these fields gets **no chip** either; we
 *   never invent a state for a payload the projection has not filled in yet
 *   (HIS-2660 fills them in; until then "geen chip" is the approved result).
 */

export type ArtifactStatusTone = StateChip["tone"];

export interface ArtifactStatus {
  tone: ArtifactStatusTone;
  /** Chip label, taken verbatim from the house vocabulary. */
  label: string;
  /** Dashed outline for in-progress states, as `stateChipFor` decides. */
  dashed?: boolean;
  /** Machine-readable derivation, asserted in tests and shown in Expert Mode. */
  reason: string;
}

/** Failure (red) first, then review (orange), then the quiet tones. */
export const ARTIFACT_STATUS_PRIORITY: ArtifactStatusTone[] = [
  "failure",
  "review",
  "progress",
  "success",
  "neutral",
];

/** A state field may be a plain string or a nested object (`{ state }` / `{ value }`). */
function stateValue(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return stateValue(record.state ?? record.value ?? record.status);
  }
  return "";
}

function field(artifact: CompanyArtifact, ...keys: string[]): unknown {
  const record = artifact as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * The single status for a card, or `null` when the house vocabulary has nothing
 * to say about this artifact (no chip).
 */
export function artifactStatus(artifact: CompanyArtifact): ArtifactStatus | null {
  const health = stateValue(field(artifact, "healthStatus"));
  const own = stateValue(field(artifact, "status"));
  const review = stateValue(field(artifact, "reviewState", "review"));

  // `stateChipFor` reads an unhealthy service from its `status` argument, so an
  // unhealthy artifact is fed in there rather than through a private branch.
  const status = health === "unhealthy" ? "unhealthy" : own;

  const chip = stateChipFor("artifact", status || null, review || null);
  if (!chip) return null;

  // The reason must name the field that actually decided the chip, so it is
  // resolved in the same order `stateChipFor` checks its conditions — a card
  // showing "Review" may not claim `status=pending` as its cause.
  const decidedBy = (): string => {
    if (review === "changes_requested") return `reviewState=${review}`;
    if (own === "changes_requested") return `status=${own}`;
    if (review === "needs_board_review") return `reviewState=${review}`;
    if (own === "ready_for_review") return `status=${own}`;
    if (health === "unhealthy") return `healthStatus=${health}`;
    return `status=${own}`;
  };

  return {
    tone: chip.tone,
    label: chip.label,
    ...(chip.dashed ? { dashed: true } : {}),
    reason: decidedBy(),
  };
}

/** Red or orange: the artifact needs a human before it is useful. */
export function artifactNeedsAttention(artifact: CompanyArtifact): boolean {
  const status = artifactStatus(artifact);
  return status?.tone === "failure" || status?.tone === "review";
}

export interface ArtifactPrioritySummary {
  /** Failure tone count (red). */
  failure: number;
  /** Review tone count (orange). */
  review: number;
  total: number;
  /** Artifacts that need action, most urgent first. */
  attention: { artifact: CompanyArtifact; status: ArtifactStatus }[];
}

/** Counts for the priority panel, derived from the loaded page only (no extra API call). */
export function summarizeArtifactStatuses(artifacts: CompanyArtifact[]): ArtifactPrioritySummary {
  const summary: ArtifactPrioritySummary = { failure: 0, review: 0, total: artifacts.length, attention: [] };
  for (const artifact of artifacts) {
    const status = artifactStatus(artifact);
    if (!status) continue;
    if (status.tone === "failure") summary.failure += 1;
    if (status.tone === "review") summary.review += 1;
    if (status.tone === "failure" || status.tone === "review") {
      summary.attention.push({ artifact, status });
    }
  }
  summary.attention.sort((a, b) => {
    const byTone =
      ARTIFACT_STATUS_PRIORITY.indexOf(a.status.tone) - ARTIFACT_STATUS_PRIORITY.indexOf(b.status.tone);
    if (byTone !== 0) return byTone;
    return a.artifact.title.localeCompare(b.artifact.title);
  });
  return summary;
}
