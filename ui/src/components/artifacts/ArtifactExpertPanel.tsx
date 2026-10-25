import { useState } from "react";
import { Check, ChevronRight, Copy, Layers } from "lucide-react";
import type { CompanyArtifact, ArtifactGroupBy } from "@/api/artifacts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { artifactByteSize, artifactContentType, artifactFilename } from "@/lib/artifact-display";
import { artifactStatus } from "@/lib/artifact-status";
import { cn } from "@/lib/utils";

export interface ArtifactExpertPanelProps {
  artifacts: CompanyArtifact[];
  groupBy: ArtifactGroupBy;
  onSelectGroupBy: (value: ArtifactGroupBy) => void;
  limit: number;
  nextCursor: string | null;
  loadedPages: number;
}

export const ARTIFACT_GROUP_OPTIONS: { value: ArtifactGroupBy; label: string }[] = [
  { value: "none", label: "Geen" },
  { value: "task", label: "Per taak" },
  { value: "parent_task", label: "Per bovenliggende taak" },
];

export function artifactGroupByLabel(value: ArtifactGroupBy): string {
  return ARTIFACT_GROUP_OPTIONS.find((option) => option.value === value)?.label ?? "Geen";
}

function looseText(artifact: CompanyArtifact, key: string): string {
  const value = (artifact as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * Expert Mode (HIS-2659 item 9).
 *
 * Everything a normal user does not need, but a builder debugging the
 * projection does: the raw field set per artifact, the paging state of the
 * infinite query, the grouping control (moved out of the toolbar, item 6) and
 * a copy button for the whole API answer.
 */
export function ArtifactExpertPanel({
  artifacts,
  groupBy,
  onSelectGroupBy,
  limit,
  nextCursor,
  loadedPages,
}: ArtifactExpertPanelProps) {
  const [copied, setCopied] = useState(false);

  const copyAnswer = async () => {
    const payload = JSON.stringify(
      {
        groupBy,
        limit,
        loadedPages,
        nextCursor,
        artifacts,
      },
      null,
      2,
    );
    try {
      await copyTextToClipboard(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details
      data-testid="artifact-expert-mode"
      className="group rounded-lg border border-border bg-card"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          className="h-4 w-4 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        Expertmodus
        <span className="text-(length:--text-micro) text-muted-foreground/70">
          ruwe velden, groepering en paginatie
        </span>
      </summary>

      <div className="space-y-4 border-t border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`Groeperen (nu: ${artifactGroupByLabel(groupBy)})`}
                title="Groeperen"
                data-testid="artifact-group-control"
                data-group-by={groupBy}
                className={cn("shrink-0", groupBy !== "none" && "bg-accent")}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Groeperen per</DropdownMenuLabel>
              {ARTIFACT_GROUP_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  data-testid={`artifact-group-option-${option.value}`}
                  aria-selected={groupBy === option.value}
                  onSelect={() => onSelectGroupBy(option.value)}
                  className="justify-between"
                >
                  {option.label}
                  {groupBy === option.value ? <Check className="h-3.5 w-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button type="button" variant="outline" size="sm" onClick={() => void copyAnswer()}>
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? "Gekopieerd" : "Kopieer API-antwoord"}
          </Button>

          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-(length:--text-micro) text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <dt>groupBy</dt>
              <dd className="font-mono text-foreground/80">{groupBy}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>limit</dt>
              <dd className="font-mono text-foreground/80">{limit}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>pages</dt>
              <dd className="font-mono text-foreground/80">{loadedPages}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>cursor</dt>
              <dd className="font-mono text-foreground/80">{nextCursor ?? "—"}</dd>
            </div>
          </dl>
        </div>

        {artifacts.length === 0 ? (
          <p className="text-(length:--text-micro) text-muted-foreground">
            Geen artifacts geladen om te tonen.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="artifact-expert-rows">
            {artifacts.map((artifact) => {
              const status = artifactStatus(artifact);
              const bytes = artifactByteSize(artifact);
              return (
                <li
                  key={`${artifact.source}:${artifact.id}`}
                  data-testid="artifact-expert-row"
                  className="rounded-md border border-border/70 bg-muted/20 p-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-xs font-medium text-foreground/85">
                      {artifactFilename(artifact)}
                    </span>
                    {status ? (
                      <span className="font-mono text-(length:--text-micro) text-muted-foreground/70">
                        {status.tone}:{status.reason}
                      </span>
                    ) : null}
                  </div>
                  <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-(length:--text-micro) text-muted-foreground sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted-foreground/70">mime</dt>
                      <dd className="truncate font-mono">{artifactContentType(artifact) || "—"}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted-foreground/70">byteSize</dt>
                      <dd className="font-mono">{bytes === null ? "—" : `${bytes} bytes`}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted-foreground/70">provider</dt>
                      <dd className="truncate font-mono">
                        {looseText(artifact, "provider") || artifact.source || "—"}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted-foreground/70">createdByRunId</dt>
                      <dd className="truncate font-mono">
                        {looseText(artifact, "createdByRunId") || "—"}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted-foreground/70">isPrimary</dt>
                      <dd className="font-mono">
                        {(artifact as unknown as Record<string, unknown>).isPrimary === true
                          ? "true"
                          : "false"}
                      </dd>
                    </div>
                    <div className="flex min-w-0 gap-1.5">
                      <dt className="shrink-0 text-muted-foreground/70">contentPath</dt>
                      <dd className="truncate font-mono">{artifact.contentPath ?? "—"}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
