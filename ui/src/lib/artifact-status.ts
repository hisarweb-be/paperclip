import type { CompanyArtifact } from "@/api/artifacts";
import { artifactCreatedAt } from "@/lib/artifact-display";

/**
 * One derived status per artifact card (HIS-2659 item 2).
 *
 * Priority is fixed: red beats orange beats green beats grey, so a card never
 * shows two competing messages. Every input is optional in the current
 * projection (HIS-2660 fills them in); when an artifact carries none of them we
 * return `null` and the card renders without a chip instead of inventing a
 * state.
 */

export type ArtifactStatusTone = "red" | "orange" | "green" | "grey";

export interface ArtifactStatus {
  tone: ArtifactStatusTone;
  /** Dutch chip label, shown on the card. */
  label: string;
  /** Machine-readable derivation, asserted in tests and shown in Expert Mode. */
  reason: string;
}

export const ARTIFACT_STATUS_PRIORITY: ArtifactStatusTone[] = ["red", "orange", "green", "grey"];

export const ARTIFACT_NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

const TERMINAL_STATES: Record<string, string> = {
  failed: "Gefaald",
  interrupted: "Onderbroken",
  cancelled: "Geannuleerd",
};

const HEALTH_STATES: Record<string, string> = {
  error: "Fout",
  unhealthy: "Ongezond",
};

const REVIEW_STATES: Record<string, string> = {
  pending: "Te keuren",
  revision_requested: "Herziening nodig",
  changes_requested: "Herziening nodig",
};

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

function hasBlockedAction(artifact: CompanyArtifact): boolean {
  const blocker = field(artifact, "blocker");
  if (!blocker || typeof blocker !== "object") return false;
  const record = blocker as Record<string, unknown>;
  const action = stateValue("unblockAction" in record ? record.unblockAction : undefined);
  const scope = stateValue(record.scope);
  return Boolean(scope && (action || record.unblockAction === true));
}

/** True when the artifact carries any status-bearing metadata at all. */
function hasStatusMetadata(artifact: CompanyArtifact): boolean {
  const record = artifact as unknown as Record<string, unknown>;
  if (
    ["status", "reviewState", "turnTerminalState", "healthStatus", "blocker", "isPrimary"].some(
      (key) => record[key] !== undefined && record[key] !== null,
    )
  ) {
    return true;
  }
  return artifactCreatedAt(artifact) !== null;
}

/**
 * The single status for a card, or `null` when the projection has told us
 * nothing yet (keeps pre-HIS-2660 payloads chip-free).
 */
export function artifactStatus(
  artifact: CompanyArtifact,
  now: number = Date.now(),
): ArtifactStatus | null {
  const terminal = stateValue(field(artifact, "turnTerminalState", "terminalState"));
  if (TERMINAL_STATES[terminal]) {
    return {
      tone: "red",
      label: TERMINAL_STATES[terminal],
      reason: `turnTerminalState=${terminal}`,
    };
  }

  const health = stateValue(field(artifact, "healthStatus"));
  if (HEALTH_STATES[health]) {
    return { tone: "red", label: HEALTH_STATES[health], reason: `healthStatus=${health}` };
  }

  const review = stateValue(field(artifact, "reviewState", "review"));
  if (REVIEW_STATES[review]) {
    return { tone: "orange", label: REVIEW_STATES[review], reason: `reviewState=${review}` };
  }

  if (hasBlockedAction(artifact)) {
    return { tone: "orange", label: "Actie nodig", reason: "blocker=unblockAction" };
  }

  if (!hasStatusMetadata(artifact)) return null;

  const status = stateValue(field(artifact, "status"));
  const created = artifactCreatedAt(artifact);
  const isNew = created !== null && now >= created && now - created < ARTIFACT_NEW_WINDOW_MS;

  if (status === "active" && (review === "" || review === "none") && isNew) {
    return { tone: "green", label: "Nieuw", reason: "status=active" };
  }

  if (isNew) return { tone: "grey", label: "Recent", reason: "recently-created" };
  return { tone: "grey", label: "Archief", reason: "archived" };
}

/** Red or orange: the artifact needs a human before it is useful. */
export function artifactNeedsAttention(artifact: CompanyArtifact, now?: number): boolean {
  const status = artifactStatus(artifact, now);
  return status?.tone === "red" || status?.tone === "orange";
}

export interface ArtifactPrioritySummary {
  red: number;
  orange: number;
  green: number;
  grey: number;
  total: number;
  /** Artifacts that need action, most urgent first. */
  attention: { artifact: CompanyArtifact; status: ArtifactStatus }[];
}

/** Counts for the priority panel, derived from the loaded page only (no extra API call). */
export function summarizeArtifactStatuses(
  artifacts: CompanyArtifact[],
  now?: number,
): ArtifactPrioritySummary {
  const summary: ArtifactPrioritySummary = {
    red: 0,
    orange: 0,
    green: 0,
    grey: 0,
    total: artifacts.length,
    attention: [],
  };
  for (const artifact of artifacts) {
    const status = artifactStatus(artifact, now);
    if (!status) continue;
    summary[status.tone] += 1;
    if (status.tone === "red" || status.tone === "orange") {
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
