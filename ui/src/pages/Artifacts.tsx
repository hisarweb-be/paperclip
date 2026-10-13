import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Layers, Package, Search, SlidersHorizontal, X } from "lucide-react";
import type { To } from "react-router-dom";
import {
  artifactsApi,
  type ArtifactGroupBy,
  type ArtifactKindFilter,
} from "../api/artifacts";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { ArtifactCard } from "../components/artifacts/ArtifactCard";
import { ArtifactGroupCard } from "../components/artifacts/ArtifactGroupCard";
import {
  ArtifactCardSkeletonGrid,
  ArtifactRecentListSkeleton,
  ARTIFACT_GRID_CLASS,
} from "../components/artifacts/ArtifactCardSkeleton";
import { ArtifactPriorityPanel } from "../components/artifacts/ArtifactPriorityPanel";
import { ArtifactRecentList } from "../components/artifacts/ArtifactRecentList";
import { ArtifactExpertPanel } from "../components/artifacts/ArtifactExpertPanel";
import { artifactSortTime } from "../lib/artifact-display";
import { useSearchParams, Link, useNavigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Audit P1 (HIS-2659, performance): a bigger page saves round trips on a flat list. */
const ARTIFACTS_PAGE_SIZE = 50;
/** Perceived speed matters more than the last keystroke: 200 ms. */
const SEARCH_DEBOUNCE_MS = 200;

export const ARTIFACT_KIND_FILTERS: { value: ArtifactKindFilter; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "image", label: "Afbeeldingen" },
  { value: "video", label: "Video" },
  { value: "document", label: "Documenten" },
  { value: "text", label: "Tekst" },
  { value: "file", label: "Bestanden" },
];

// Grouping lives in Expert Mode now (HIS-2659 item 6); re-exported so the
// Storybook harness keeps a single definition to render against.
export { ARTIFACT_GROUP_OPTIONS, artifactGroupByLabel } from "@/components/artifacts/ArtifactExpertPanel";

const KIND_VALUES = new Set(ARTIFACT_KIND_FILTERS.map((filter) => filter.value));

function parseGroupBy(value: string | null): ArtifactGroupBy {
  if (value === "none" || value === "task" || value === "parent_task") return value;
  // Default is the flat grid: grouping is an expert affordance, not the entry view.
  return "none";
}

function parseKind(value: string | null): ArtifactKindFilter {
  return value && KIND_VALUES.has(value as ArtifactKindFilter)
    ? (value as ArtifactKindFilter)
    : "all";
}

/**
 * Artifacts (HIS-2659 Deel A).
 *
 * Structure, top to bottom: HEADER / PRIORITEITSPANEEL / RECENTE ARTIFACTS /
 * ALLE ARTIFACTS / EXPERT MODE. The first screen has to answer, within three
 * seconds: what is new, what needs action, what failed, what matters and which
 * artifact to open.
 */
export function Artifacts() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const kind = parseKind(searchParams.get("kind"));
  const query = searchParams.get("q") ?? "";
  const groupBy = parseGroupBy(searchParams.get("groupBy"));
  const groupIssueId = searchParams.get("groupIssueId") ?? undefined;

  const [draftQuery, setDraftQuery] = useState(query);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const grouping = groupBy !== "none";
  const viewingStackList = grouping && !groupIssueId;
  const viewingSelectedStack = grouping && !!groupIssueId;
  const filtering = kind !== "all" || query.length > 0;

  // Keep the search box in sync when the committed query changes from outside
  // (e.g. back/forward navigation or a shared URL), without clobbering in-flight
  // typing (which leaves `query` unchanged until the debounce commits).
  useEffect(() => {
    setDraftQuery((prev) => (prev.trim() === query ? prev : query));
  }, [query]);

  // Debounce the search box into the `q` URL param so searches are shareable.
  useEffect(() => {
    const trimmed = draftQuery.trim();
    if (trimmed === query) return;
    const handle = window.setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (trimmed) next.set("q", trimmed);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draftQuery, query, setSearchParams]);

  const updateParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      });
    },
    [setSearchParams],
  );

  const selectKind = useCallback(
    (value: ArtifactKindFilter) => {
      updateParams((next) => {
        if (value === "all") next.delete("kind");
        else next.set("kind", value);
      });
    },
    [updateParams],
  );

  const selectGroupBy = useCallback(
    (value: ArtifactGroupBy) => {
      updateParams((next) => {
        // Switching the grouping mode always returns to the stack list.
        next.delete("groupIssueId");
        if (value === "none") next.delete("groupBy");
        else next.set("groupBy", value);
      });
    },
    [updateParams],
  );

  // Build a relative `To` that preserves the active filters/search while
  // changing only the grouping selection. A bare query string keeps the current
  // pathname (the company-prefixed /artifacts route) and stays linkable.
  const buildTo = useCallback(
    (mutate: (next: URLSearchParams) => void): To => {
      const next = new URLSearchParams(searchParams);
      mutate(next);
      const serialized = next.toString();
      return serialized ? `?${serialized}` : "?";
    },
    [searchParams],
  );

  const stackTo = useCallback(
    (issueId: string): To =>
      buildTo((next) => {
        if (groupBy !== "none") next.set("groupBy", groupBy);
        next.set("groupIssueId", issueId);
      }),
    [buildTo, groupBy],
  );

  const backToStacksTo = useMemo<To>(
    () =>
      buildTo((next) => {
        next.delete("groupIssueId");
      }),
    [buildTo],
  );

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteQuery({
    queryKey: queryKeys.artifacts.list(selectedCompanyId!, kind, query, groupBy, groupIssueId),
    queryFn: ({ pageParam }) =>
      artifactsApi.list(selectedCompanyId!, {
        kind,
        q: query || undefined,
        groupBy,
        groupIssueId,
        limit: ARTIFACTS_PAGE_SIZE,
        cursor: pageParam,
      }),
    enabled: !!selectedCompanyId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // While a new search runs, keep the previous grid on screen: an empty flash
    // is both a layout shift (CLS) and a worse answer than the previous page.
    placeholderData: query.length > 0 ? keepPreviousData : undefined,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void fetchNextPage();
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const artifacts = useMemo(() => data?.pages.flatMap((page) => page.artifacts) ?? [], [data]);
  const groups = useMemo(
    () => data?.pages.flatMap((page) => page.groups ?? []) ?? [],
    [data],
  );
  const selectedGroup = useMemo(
    () => data?.pages.map((page) => page.selectedGroup).find(Boolean) ?? null,
    [data],
  );
  const nextCursor = data?.pages.at(-1)?.nextCursor ?? null;
  const searching = query.length > 0;

  // Item 3: `createdAt` is the sort key, newest first (falling back to the
  // update time for payloads the projection has not extended yet).
  const sortedArtifacts = useMemo(
    () => [...artifacts].sort((a, b) => artifactSortTime(b) - artifactSortTime(a)),
    [artifacts],
  );

  useEffect(() => {
    if (viewingSelectedStack && selectedGroup) {
      setBreadcrumbs([
        { label: "Artifacts", href: "/artifacts" },
        { label: `${selectedGroup.issue.identifier} · ${selectedGroup.title}` },
      ]);
    } else {
      setBreadcrumbs([{ label: "Artifacts" }]);
    }
  }, [setBreadcrumbs, viewingSelectedStack, selectedGroup]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Package} message="Kies een organisatie om artifacts te bekijken." />;
  }

  const showGroupCards = viewingStackList;
  const itemCount = showGroupCards ? groups.length : sortedArtifacts.length;
  const activeKindLabel =
    ARTIFACT_KIND_FILTERS.find((filter) => filter.value === kind)?.label ?? "Alles";

  // Item 7: exactly one empty state, with a next step that actually works.
  const resetFilters = () => {
    setDraftQuery("");
    updateParams((next) => {
      next.delete("kind");
      next.delete("q");
    });
  };

  const goToTasks = () => navigate("/issues");

  return (
    <div className="w-full max-w-6xl space-y-6">
      {/* HEADER ------------------------------------------------------------ */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Artifacts</h1>
            <p className="text-sm text-muted-foreground">Alles wat je taken hebben opgeleverd.</p>
          </div>
          {!isLoading && itemCount > 0 ? (
            <span className="text-(length:--text-micro) text-muted-foreground/70">
              {showGroupCards
                ? `${itemCount} ${itemCount === 1 ? "stapel" : "stapels"}`
                : `${itemCount} ${itemCount === 1 ? "artifact" : "artifacts"}`}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.currentTarget.value)}
              placeholder="Zoek in artifacts..."
              aria-label="Zoek in artifacts"
              className="h-9 pl-9 pr-9 text-sm"
            />
            {draftQuery.length > 0 ? (
              <button
                type="button"
                onClick={() => setDraftQuery("")}
                aria-label="Zoekopdracht wissen"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Item 6: filters live behind a disclosure, they are not the entry point. */}
          <details
            data-testid="artifact-filter-disclosure"
            className="group shrink-0"
          >
            <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Filters
              {kind !== "all" ? (
                <span className="rounded bg-accent px-1.5 py-0.5 text-(length:--text-micro) text-foreground">
                  {activeKindLabel}
                </span>
              ) : null}
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </summary>
            <div
              className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-2"
              role="tablist"
              aria-label="Filter artifacts op type"
            >
              {ARTIFACT_KIND_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  role="tab"
                  aria-selected={kind === filter.value}
                  onClick={() => selectKind(filter.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    kind === filter.value
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </details>
        </div>
      </header>

      {viewingSelectedStack ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            to={backToStacksTo}
            data-testid="artifact-stack-back"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Alle stapels
          </Link>
          {selectedGroup ? (
            <span className="truncate text-muted-foreground">
              <span className="text-foreground/80">{selectedGroup.issue.identifier}</span>{" "}
              {selectedGroup.title}
            </span>
          ) : null}
        </div>
      ) : null}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {isLoading ? (
        // Item 8 + CLS (HIS-2659): the first paint mirrors the loaded page line
        // for line, shelf and section headings included, with placeholders of
        // the same height as a card that carries a chip. Nothing below the
        // header moves when the data lands. The priority panel is the one part
        // that cannot be reserved: item 5 keeps it invisible when there is
        // nothing to do, so there is no height to reserve for it.
        //
        // The `key`s below are not decoration: React matches the two branches
        // by key, so the very same <section> nodes stay in place and only their
        // contents fill in. Without them React reuses the first skeleton
        // section for the recents shelf, which moves that node up by the height
        // of the section it replaces and shows up as a layout shift.
        <>
          <section key="artifact-recent" aria-labelledby="artifact-recent-heading" className="space-y-2">
            <h2
              id="artifact-recent-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Recente artifacts
            </h2>
            <ArtifactRecentListSkeleton />
          </section>

          <section key="artifact-all" aria-labelledby="artifact-all-heading" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2
                id="artifact-all-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Alle artifacts
              </h2>
            </div>
            <ArtifactCardSkeletonGrid />
          </section>
        </>
      ) : itemCount === 0 ? (
        <EmptyState
          icon={showGroupCards ? Layers : Package}
          title={
            searching
              ? "Geen artifact gevonden"
              : filtering
                ? `Nog geen ${activeKindLabel.toLowerCase()}`
                : "Nog geen artifacts"
          }
          message={
            searching
              ? "Geen enkel artifact matcht deze zoekopdracht."
              : "Zodra je taken iets opleveren, verschijnt het hier."
          }
          action={filtering ? "Toon alles" : "Naar taken"}
          onAction={filtering ? resetFilters : goToTasks}
          hideActionIcon
        />
      ) : (
        <>
          {/* PRIORITEITSPANEEL -------------------------------------------- */}
          {!showGroupCards ? (
            <ArtifactPriorityPanel key="artifact-priority" artifacts={sortedArtifacts} />
          ) : null}

          {/* RECENTE ARTIFACTS ------------------------------------------- */}
          {!showGroupCards && sortedArtifacts.length > 0 ? (
            <section key="artifact-recent" aria-labelledby="artifact-recent-heading" className="space-y-2">
              <h2
                id="artifact-recent-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Recente artifacts
              </h2>
              <ArtifactRecentList artifacts={sortedArtifacts} />
            </section>
          ) : null}

          {/* ALLE ARTIFACTS ---------------------------------------------- */}
          <section key="artifact-all" aria-labelledby="artifact-all-heading" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2
                id="artifact-all-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Alle artifacts
              </h2>
              <span className="text-(length:--text-micro) text-muted-foreground/70">
                Gesorteerd op: nieuwste eerst
              </span>
            </div>

            <div className={ARTIFACT_GRID_CLASS}>
              {showGroupCards
                ? groups.map((group) => (
                    <ArtifactGroupCard key={group.id} group={group} to={stackTo(group.issue.id)} />
                  ))
                : sortedArtifacts.map((artifact) => (
                    <ArtifactCard key={`${artifact.source}:${artifact.id}`} artifact={artifact} />
                  ))}
            </div>

            <div
              ref={loadMoreRef}
              className="flex min-h-10 flex-wrap items-center justify-center gap-3 pb-2 text-xs text-muted-foreground"
            >
              {isFetchingNextPage ? <span>Meer artifacts laden...</span> : null}
              {!isFetchingNextPage && hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchNextPage()}
                  data-testid="artifact-load-more"
                >
                  Meer laden
                </Button>
              ) : null}
              {!isFetchingNextPage && !hasNextPage && isFetching ? (
                <span>Artifacts bijwerken...</span>
              ) : null}
            </div>
          </section>
        </>
      )}

      {/* EXPERT MODE -------------------------------------------------------- */}
      <ArtifactExpertPanel
        artifacts={sortedArtifacts}
        groupBy={groupBy}
        onSelectGroupBy={selectGroupBy}
        limit={ARTIFACTS_PAGE_SIZE}
        nextCursor={nextCursor}
        loadedPages={data?.pages.length ?? 0}
      />
    </div>
  );
}
