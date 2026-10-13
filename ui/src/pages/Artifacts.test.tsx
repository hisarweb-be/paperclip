// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Artifacts } from "./Artifacts";
import type { CompanyArtifact, CompanyArtifactGroup } from "../api/artifacts";

const companyState = vi.hoisted(() => ({
  selectedCompanyId: "company-1",
}));

const breadcrumbState = vi.hoisted(() => ({
  setBreadcrumbs: vi.fn(),
}));

const artifactsApiMock = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => companyState,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => breadcrumbState,
}));

vi.mock("../api/artifacts", () => ({
  artifactsApi: artifactsApiMock,
}));

// Render the menu inline (no radix portal / pointer-capture) so option clicks
// are deterministic in jsdom.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    ...rest
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("../components/artifacts/ArtifactCard", () => ({
  ArtifactCard: ({ artifact }: { artifact: CompanyArtifact }) => (
    <article data-testid="artifact-card">{artifact.title}</article>
  ),
  ArtifactPreview: ({ artifact }: { artifact: CompanyArtifact }) => (
    <div data-testid="artifact-preview">{artifact.title}</div>
  ),
}));

type ObserverCallback = IntersectionObserverCallback;

let latestObserverCallback: ObserverCallback | null = null;

class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];

  constructor(callback: ObserverCallback) {
    latestObserverCallback = callback;
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

/**
 * The projection is being extended (HIS-2660), so the extra status fields are
 * passed through the overrides bag rather than through the shared type.
 */
function sampleArtifact(overrides: Record<string, unknown> = {}): CompanyArtifact {
  return {
    id: "artifact-1",
    source: "document",
    mediaKind: "document",
    title: "Launch Brief",
    previewText: "launch brief preview",
    contentType: "text/markdown",
    contentPath: null,
    openPath: null,
    downloadPath: null,
    issue: { id: "issue-1", identifier: "PAP-42", title: "Ship launch" },
    project: null,
    createdByAgent: null,
    updatedAt: "2026-06-01T00:00:00.000Z",
    href: "/PAP/issues/PAP-42#document-brief",
    ...overrides,
  } as CompanyArtifact;
}

function sampleGroup(overrides: Partial<CompanyArtifactGroup> = {}): CompanyArtifactGroup {
  return {
    id: "task:issue-1",
    groupBy: "task",
    issue: { id: "issue-1", identifier: "PAP-42", title: "Ship launch" },
    title: "Ship launch",
    count: 3,
    mediaKinds: ["document"],
    previewArtifacts: [sampleArtifact()],
    updatedAt: "2026-06-01T00:00:00.000Z",
    href: "/PAP/artifacts?groupBy=task&groupIssueId=issue-1",
    ...overrides,
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A promise we resolve by hand, to hold the page in its loading state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForAssertion(assertion: () => void, attempts = 50) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

/** Exposes the current location so navigation assertions stay deterministic. */
function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location-probe">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderArtifacts(container: HTMLDivElement, initialEntries: string[] = ["/artifacts"]) {
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  flushSync(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Artifacts />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { root, queryClient };
}

function click(element: Element) {
  flushSync(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("Artifacts page", () => {
  let container: HTMLDivElement;
  let originalIntersectionObserver: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    breadcrumbState.setBreadcrumbs.mockReset();
    artifactsApiMock.list.mockReset();
    latestObserverCallback = null;
    originalIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    window.IntersectionObserver = originalIntersectionObserver as typeof IntersectionObserver;
    container.remove();
  });

  it("requests the flat artifact grid by default with the audited page size", async () => {
    artifactsApiMock.list.mockResolvedValue({ artifacts: [sampleArtifact()], nextCursor: null });

    const { root } = renderArtifacts(container);

    await waitForAssertion(() => {
      expect(artifactsApiMock.list).toHaveBeenCalledWith("company-1", {
        kind: "all",
        q: undefined,
        groupBy: "none",
        groupIssueId: undefined,
        limit: 50,
        cursor: undefined,
      });
    });

    // Header: title, promise and the search box the user actually needs.
    expect(container.querySelector("h1")?.textContent).toBe("Artifacts");
    expect(container.textContent).toContain("Alles wat je taken hebben opgeleverd.");
    expect(container.querySelector('input[aria-label="Zoek in artifacts"]')).not.toBeNull();

    // Filters are behind a disclosure, not in the entry view (item 6).
    const disclosure = container.querySelector('[data-testid="artifact-filter-disclosure"]');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.tagName.toLowerCase()).toBe("details");
    const filterTabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(filterTabs).toEqual(["Alles", "Afbeeldingen", "Video", "Documenten", "Tekst", "Bestanden"]);
    expect(disclosure?.contains(container.querySelector('[role="tab"]'))).toBe(true);

    flushSync(() => {
      root.unmount();
    });
  });

  it("debounces artifact search into the artifacts API", async () => {
    artifactsApiMock.list.mockResolvedValue({ artifacts: [sampleArtifact()], nextCursor: null });

    const { root } = renderArtifacts(container);

    const input = container.querySelector('input[aria-label="Zoek in artifacts"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    flushSync(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeSetter.call(input, "launch");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 200 ms debounce (audit P1), so a slightly longer wait must see the call.
    await new Promise((resolve) => setTimeout(resolve, 260));

    await waitForAssertion(() => {
      expect(artifactsApiMock.list).toHaveBeenLastCalledWith("company-1", {
        kind: "all",
        q: "launch",
        groupBy: "none",
        groupIssueId: undefined,
        limit: 50,
        cursor: undefined,
      });
    });

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps the artifacts grid max-width constrained and left aligned", async () => {
    artifactsApiMock.list.mockResolvedValue({ artifacts: [sampleArtifact()], nextCursor: null });

    const { root } = renderArtifacts(container);

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="artifact-card"]')).not.toBeNull();
    });

    const pageShell = container.firstElementChild as HTMLElement | null;
    expect(pageShell?.className).toContain("max-w-6xl");
    expect(pageShell?.className).not.toContain("mx-auto");

    flushSync(() => {
      root.unmount();
    });
  });

  it("fetches the next artifact page when the sentinel intersects", async () => {
    artifactsApiMock.list
      .mockResolvedValueOnce({
        artifacts: [sampleArtifact({ id: "artifact-1", title: "First Artifact" })],
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        artifacts: [sampleArtifact({ id: "artifact-2", title: "Second Artifact" })],
        nextCursor: null,
      });

    const { root } = renderArtifacts(container);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("First Artifact");
      expect(latestObserverCallback).not.toBeNull();
    });

    // The sentinel is paged in well before the user reaches the end (600 px).
    expect(container.querySelector('[data-testid="artifact-load-more"]')).not.toBeNull();

    latestObserverCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    await waitForAssertion(() => {
      expect(artifactsApiMock.list).toHaveBeenLastCalledWith("company-1", {
        kind: "all",
        q: undefined,
        groupBy: "none",
        groupIssueId: undefined,
        limit: 50,
        cursor: "cursor-2",
      });
      expect(container.textContent).toContain("Second Artifact");
    });

    flushSync(() => {
      root.unmount();
    });
  });

  it("switches grouping via the expert panel control and refetches flat artifacts", async () => {
    artifactsApiMock.list.mockImplementation((_companyId: string, params?: { groupBy?: string }) => {
      if (params?.groupBy === "none") {
        return Promise.resolve({ artifacts: [sampleArtifact()], nextCursor: null });
      }
      return Promise.resolve({ artifacts: [], groups: [sampleGroup()], nextCursor: null });
    });

    const { root } = renderArtifacts(container, ["/artifacts?groupBy=task"]);

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="artifact-group-card"]')).not.toBeNull();
    });

    // Grouping is an expert affordance (item 6): the control lives in Expert Mode.
    const expertPanel = container.querySelector('[data-testid="artifact-expert-mode"]');
    expect(expertPanel).not.toBeNull();
    const groupControl = container.querySelector(
      '[data-testid="artifact-group-control"]',
    ) as HTMLElement;
    expect(expertPanel?.contains(groupControl)).toBe(true);
    expect(groupControl.getAttribute("data-group-by")).toBe("task");

    const noneOption = container.querySelector(
      '[data-testid="artifact-group-option-none"]',
    ) as HTMLButtonElement;
    expect(noneOption).not.toBeNull();
    click(noneOption);

    await waitForAssertion(() => {
      expect(artifactsApiMock.list).toHaveBeenLastCalledWith("company-1", {
        kind: "all",
        q: undefined,
        groupBy: "none",
        groupIssueId: undefined,
        limit: 50,
        cursor: undefined,
      });
      expect(container.querySelector('[data-testid="artifact-card"]')).not.toBeNull();
      expect(
        container.querySelector('[data-testid="artifact-group-control"]')?.getAttribute("data-group-by"),
      ).toBe("none");
    });

    flushSync(() => {
      root.unmount();
    });
  });

  it("renders stack cards from a grouped URL with count metadata", async () => {
    artifactsApiMock.list.mockResolvedValue({
      artifacts: [],
      groups: [sampleGroup({ count: 4 })],
      nextCursor: null,
    });

    const { root } = renderArtifacts(container, ["/artifacts?groupBy=task"]);

    await waitForAssertion(() => {
      expect(artifactsApiMock.list).toHaveBeenCalledWith("company-1", {
        kind: "all",
        q: undefined,
        groupBy: "task",
        groupIssueId: undefined,
        limit: 50,
        cursor: undefined,
      });
      const card = container.querySelector('[data-testid="artifact-group-card"]') as HTMLElement;
      expect(card).not.toBeNull();
      expect(card.getAttribute("data-count")).toBe("4");
      expect(card.getAttribute("data-stacked")).toBe("true");
      expect(card.getAttribute("href")).toBe("/artifacts?groupBy=task&groupIssueId=issue-1");
      expect(card.textContent).toContain("4 artifacts");
    });

    flushSync(() => {
      root.unmount();
    });
  });

  it("opens a stack from the URL and shows the back affordance and artifacts", async () => {
    artifactsApiMock.list.mockResolvedValue({
      artifacts: [sampleArtifact({ title: "Stacked Artifact" })],
      selectedGroup: sampleGroup(),
      nextCursor: null,
    });

    const { root } = renderArtifacts(container, [
      "/artifacts?groupBy=task&groupIssueId=issue-1",
    ]);

    await waitForAssertion(() => {
      expect(artifactsApiMock.list).toHaveBeenCalledWith("company-1", {
        kind: "all",
        q: undefined,
        groupBy: "task",
        groupIssueId: "issue-1",
        limit: 50,
        cursor: undefined,
      });
      expect(container.querySelector('[data-testid="artifact-stack-back"]')).not.toBeNull();
      expect(
        (container.querySelector('[data-testid="artifact-stack-back"]') as HTMLAnchorElement).getAttribute("href"),
      ).toBe("/artifacts?groupBy=task");
      expect(container.textContent).toContain("Stacked Artifact");
      expect(container.querySelector('[data-testid="artifact-card"]')).not.toBeNull();
    });

    flushSync(() => {
      root.unmount();
    });
  });

  it("preserves the media filter when grouping", async () => {
    artifactsApiMock.list.mockResolvedValue({
      artifacts: [],
      groups: [sampleGroup()],
      nextCursor: null,
    });

    const { root } = renderArtifacts(container, ["/artifacts?kind=image&groupBy=task"]);

    await waitForAssertion(() => {
      expect(artifactsApiMock.list).toHaveBeenCalledWith("company-1", {
        kind: "image",
        q: undefined,
        groupBy: "task",
        groupIssueId: undefined,
        limit: 50,
        cursor: undefined,
      });
    });

    flushSync(() => {
      root.unmount();
    });
  });

  // ---- priority panel (acceptance criterion a + c) ------------------------

  it("puts the priority panel with a red chip in the first screen without an extra API call", async () => {
    artifactsApiMock.list.mockResolvedValue({
      artifacts: [
        sampleArtifact({ id: "artifact-ok", title: "Fine Artifact" }),
        sampleArtifact({
          id: "artifact-failed",
          title: "Broken Render",
          turnTerminalState: "failed",
          createdAt: "2026-06-02T09:00:00.000Z",
        }),
      ],
      nextCursor: null,
    });

    const { root } = renderArtifacts(container);

    await waitForAssertion(() => {
      const panel = container.querySelector('[data-testid="artifact-priority-panel"]');
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("data-red")).toBe("1");
      expect(panel?.textContent).toContain("Aandacht nodig");
      expect(panel?.textContent).toContain("Broken Render");
      expect(panel?.textContent).toContain("1 artifact vraagt actie");
    });

    const chip = container.querySelector(
      '[data-testid="artifact-priority-panel"] [data-testid="artifact-status-chip"]',
    );
    expect(chip?.getAttribute("data-tone")).toBe("red");
    expect(chip?.getAttribute("data-reason")).toBe("turnTerminalState=failed");

    // Panel order: it sits directly under the header, so it is on the first
    // screen at 1440x900 and costs no extra request (criterion a + c).
    const panel = container.querySelector('[data-testid="artifact-priority-panel"]') as HTMLElement;
    const header = container.querySelector("h1") as HTMLElement;
    expect(Boolean(header.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(artifactsApiMock.list).toHaveBeenCalledTimes(1);

    flushSync(() => {
      root.unmount();
    });
  });

  it("hides the priority panel when no artifact needs attention", async () => {
    artifactsApiMock.list.mockResolvedValue({
      artifacts: [sampleArtifact({ createdAt: "2026-06-02T09:00:00.000Z" })],
      nextCursor: null,
    });

    const { root } = renderArtifacts(container);

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="artifact-card"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="artifact-priority-panel"]')).toBeNull();

    flushSync(() => {
      root.unmount();
    });
  });

  // ---- recent artifacts (item 3) -----------------------------------------

  it("lists recent artifacts newest first by createdAt", async () => {
    artifactsApiMock.list.mockResolvedValue({
      artifacts: [
        sampleArtifact({ id: "old", title: "Oudste", createdAt: "2026-05-01T08:00:00.000Z" }),
        sampleArtifact({ id: "new", title: "Nieuwste", createdAt: "2026-06-03T08:00:00.000Z" }),
        sampleArtifact({ id: "mid", title: "Middelste", createdAt: "2026-05-20T08:00:00.000Z" }),
      ],
      nextCursor: null,
    });

    const { root } = renderArtifacts(container);

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="artifact-recent-list"]')).not.toBeNull();
    });

    const recent = container.querySelector('[data-testid="artifact-recent-list"]') as HTMLElement;
    const recentText = recent.textContent ?? "";
    const order = ["Nieuwste", "Middelste", "Oudste"].map((title) => recentText.indexOf(title));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);

    // createdAt, not updatedAt, is what the row shows (item 3).
    expect(recentText).toMatch(/3 jun/);
    expect(container.textContent).toContain("Gesorteerd op: nieuwste eerst");

    flushSync(() => {
      root.unmount();
    });
  });

  // ---- loading + empty state (criteria d + e) ----------------------------

  it("renders card-shaped skeletons while the first page loads", async () => {
    const pending = deferred<{ artifacts: CompanyArtifact[]; nextCursor: string | null }>();
    artifactsApiMock.list.mockReturnValue(pending.promise);

    const { root } = renderArtifacts(container);

    const skeletonGrid = container.querySelector('[data-testid="artifact-card-skeleton-grid"]');
    expect(skeletonGrid).not.toBeNull();
    expect(skeletonGrid?.querySelectorAll('[data-testid="artifact-card-skeleton"]').length).toBe(6);
    // Card-shaped, so the first data paint reserves the same height (criterion e).
    expect(skeletonGrid?.className).toContain("md:grid-cols-2");
    expect(skeletonGrid?.className).toContain("xl:grid-cols-3");

    pending.resolve({ artifacts: [sampleArtifact()], nextCursor: null });

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="artifact-card-skeleton-grid"]')).toBeNull();
      expect(container.querySelector('[data-testid="artifact-card"]')).not.toBeNull();
    });

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows exactly one empty state and its action resets the filters", async () => {
    artifactsApiMock.list.mockImplementation((_companyId: string, params?: { kind?: string }) =>
      Promise.resolve({
        artifacts: params?.kind === "all" ? [sampleArtifact()] : [],
        nextCursor: null,
      }),
    );

    const { root } = renderArtifacts(container, ["/artifacts?kind=image"]);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Nog geen afbeeldingen");
      expect(artifactsApiMock.list).toHaveBeenCalledWith("company-1", {
        kind: "image",
        q: undefined,
        groupBy: "none",
        groupIssueId: undefined,
        limit: 50,
        cursor: undefined,
      });
    });

    // Criterion d: exactly one empty state, not the old five variants.
    expect(countOccurrences(container.textContent ?? "", "Nog geen afbeeldingen")).toBe(1);

    const action = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Toon alles",
    ) as HTMLButtonElement;
    expect(action).toBeDefined();
    click(action);

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe("/artifacts");
      expect(artifactsApiMock.list).toHaveBeenLastCalledWith("company-1", {
        kind: "all",
        q: undefined,
        groupBy: "none",
        groupIssueId: undefined,
        limit: 50,
        cursor: undefined,
      });
      expect(container.querySelector('[data-testid="artifact-card"]')).not.toBeNull();
    });

    flushSync(() => {
      root.unmount();
    });
  });

  it("sends a first-time visitor to their tasks from the empty state", async () => {
    artifactsApiMock.list.mockResolvedValue({ artifacts: [], nextCursor: null });

    const { root } = renderArtifacts(container);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Nog geen artifacts");
    });

    const action = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Naar taken",
    ) as HTMLButtonElement;
    expect(action).toBeDefined();
    click(action);

    // Router state updates are transitions, so the probe re-renders a tick later.
    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe("/issues");
    });

    flushSync(() => {
      root.unmount();
    });
  });
});
