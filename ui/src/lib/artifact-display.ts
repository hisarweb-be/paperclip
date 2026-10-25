import type { CompanyArtifact } from "@/api/artifacts";
import { artifactUrl } from "@/lib/artifact-card-data";

/**
 * Display helpers for the artifacts surfaces (HIS-2659).
 *
 * The artifacts projection is being extended (HIS-2660) with richer producer
 * metadata (`createdAt`, `originalFilename`, `byteSize`, `reviewState`,
 * `isPrimary`). Every helper here reads those fields defensively and falls back
 * to the pre-existing contract, so the page renders correctly before and after
 * the projection lands.
 */

const MEDIA_KIND_LABELS: Record<string, string> = {
  image: "Afbeelding",
  video: "Video",
  document: "Document",
  text: "Tekst",
  file: "Bestand",
  empty: "Artifact",
};

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("nl-BE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const BYTE_FORMAT = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 1 });

function loose(artifact: CompanyArtifact): Record<string, unknown> {
  return artifact as unknown as Record<string, unknown>;
}

/** Non-empty string field, trimmed; empty when the producer omitted it. */
function text(artifact: CompanyArtifact, ...keys: string[]): string {
  const record = loose(artifact);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numeric(artifact: CompanyArtifact, ...keys: string[]): number | null {
  const record = loose(artifact);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

/** Epoch millis of an ISO timestamp, or null when absent/unparseable. */
export function artifactTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Raw `createdAt` string, "" before HIS-2660 ships the field. */
export function createdAtText(artifact: CompanyArtifact): string {
  return text(artifact, "createdAt");
}

/**
 * Creation time, epoch millis. `null` before HIS-2660 ships `createdAt`; we do
 * not silently fall back to `updatedAt` because "created" would then be a lie.
 */
export function artifactCreatedAt(artifact: CompanyArtifact): number | null {
  return artifactTimestamp(createdAtText(artifact));
}

/**
 * Sort key for "newest first". Uses `createdAt` (HIS-2659 item 3) and falls
 * back to `updatedAt` so pre-projection payloads keep a stable order.
 */
export function artifactSortTime(artifact: CompanyArtifact): number {
  return (
    artifactCreatedAt(artifact) ?? artifactTimestamp(artifact.updatedAt) ?? 0
  );
}

/** `13 okt 02:14`, or "" when the timestamp is unusable. */
export function artifactDateTimeLabel(value: string | null | undefined): string {
  const timestamp = artifactTimestamp(value);
  if (timestamp === null) return "";
  // Compose from parts to drop the locale's comma between date and time
  // ("13 okt, 02:14" -> "13 okt 02:14") while keeping the colon that separates
  // hour and minute; only the comma literal becomes a space.
  return DATE_TIME_FORMAT.formatToParts(new Date(timestamp))
    .map((part) =>
      part.type === "literal" ? part.value.replace(",", " ").replace(/\s+/g, " ") : part.value,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function artifactMediaKindLabel(mediaKind: string): string {
  return MEDIA_KIND_LABELS[mediaKind] ?? MEDIA_KIND_LABELS.empty;
}

/** `512 B` / `1,9 kB` / `3,4 MB`, or "" when the size is unknown. */
export function artifactByteSizeLabel(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${BYTE_FORMAT.format(bytes / 1024)} kB`;
  return `${BYTE_FORMAT.format(bytes / (1024 * 1024))} MB`;
}

/** Producer-declared size, if the projection exposes it. */
export function artifactByteSize(artifact: CompanyArtifact): number | null {
  return numeric(artifact, "byteSize", "sizeBytes", "contentLength");
}

/** Human name of the artifact: the uploaded filename wins over the title. */
export function artifactFilename(artifact: CompanyArtifact): string {
  return text(artifact, "originalFilename", "filename") || artifact.title?.trim() || "Zonder titel";
}

/** MIME type, trimmed and lowercased, for the expert panel. */
export function artifactContentType(artifact: CompanyArtifact): string {
  return text(artifact, "contentType").toLowerCase();
}

/**
 * Where "Openen" goes: the producer's open path, else the stored content path.
 * Both are validated by {@link artifactUrl} so a hostile metadata value can
 * never become a `javascript:` link.
 */
export function artifactOpenHref(artifact: CompanyArtifact): string {
  return artifactUrl(text(artifact, "openPath")) || artifactUrl(artifact.contentPath);
}

/** Where "Downloaden" goes: the download path, else the content path forced to download. */
export function artifactDownloadHref(artifact: CompanyArtifact): string {
  const explicit = artifactUrl(text(artifact, "downloadPath"));
  if (explicit) return explicit;
  const content = artifactUrl(artifact.contentPath);
  if (!content) return "";
  return `${content}${content.includes("?") ? "&" : "?"}download=1`;
}

export interface ArtifactMetaPart {
  key: string;
  label: string;
}

/**
 * Card meta line: kind, size and time, in that order, skipping the parts the
 * projection does not know yet. The time is the creation time when the
 * projection provides it (HIS-2659 item 3) and the update time otherwise.
 */
export function artifactMetaParts(artifact: CompanyArtifact): ArtifactMetaPart[] {
  const parts: ArtifactMetaPart[] = [
    { key: "kind", label: artifactMediaKindLabel(artifact.mediaKind) },
  ];
  const size = artifactByteSizeLabel(artifactByteSize(artifact));
  if (size) parts.push({ key: "size", label: size });
  const created = createdAtText(artifact);
  if (created) {
    parts.push({ key: "time", label: `Aangemaakt ${artifactDateTimeLabel(created)}` });
  } else {
    const updated = artifactDateTimeLabel(artifact.updatedAt);
    if (updated) parts.push({ key: "time", label: `Bewerkt ${updated}` });
  }
  return parts;
}

/** `HIS-123 · Bouwer web`, skipping whichever half is missing. */
export function artifactOriginLabel(artifact: CompanyArtifact): string {
  const identifier = artifact.issue?.identifier?.trim() ?? "";
  const author =
    text(artifact, "createdByAgentName") || artifact.createdByAgent?.name?.trim() || "";
  return [identifier, author].filter(Boolean).join(" · ");
}

/** True when the projection flags this artifact as the primary output of its run. */
export function artifactIsPrimary(artifact: CompanyArtifact): boolean {
  return loose(artifact).isPrimary === true;
}

/** Run that produced the artifact, for the expert panel. */
export function artifactCreatedByRunId(artifact: CompanyArtifact): string {
  return text(artifact, "createdByRunId", "runId");
}
