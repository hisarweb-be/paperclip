// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/router", () => ({
  Link: ({
    to,
    children,
    disableIssueQuicklook,
    ...props
  }: {
    to: string;
    children: ReactNode;
    disableIssueQuicklook?: boolean;
  }) => (
    <a href={to} data-disable-issue-quicklook={disableIssueQuicklook ? "true" : undefined} {...props}>
      {children}
    </a>
  ),
}));

import { ArtifactCard } from "./ArtifactCard";
import { ArtifactCardSkeleton, ArtifactRecentListSkeleton } from "./ArtifactCardSkeleton";
import { ArtifactRecentList } from "./ArtifactRecentList";
import type { CompanyArtifact } from "@/api/artifacts";

/** Local noon, so the rendered nl-BE label is the same in every timezone. */
const LOCAL_NOON_2026_06_01 = new Date(2026, 5, 1, 12, 0, 0, 0).toISOString();

function makeArtifact(overrides: Record<string, unknown> = {}): CompanyArtifact {
  return {
    id: "art-1",
    source: "attachment",
    mediaKind: "image",
    title: "Hero shot",
    previewText: null,
    contentType: "image/png",
    contentPath: "/files/art-1.png",
    openPath: "/files/art-1.png",
    downloadPath: "/files/art-1.png?download=1",
    issue: { id: "issue-1", identifier: "PAP-10306", title: "Landing visuals" },
    project: { id: "proj-1", name: "Paperclip App" },
    createdByAgent: { id: "agent-1", name: "ClaudeCoder" },
    createdAt: LOCAL_NOON_2026_06_01,
    updatedAt: LOCAL_NOON_2026_06_01,
    href: "/issues/PAP-10306#attachment-art-1",
    ...overrides,
  } as CompanyArtifact;
}

describe("ArtifactCard", () => {
  it("renders an image preview with cover image and links to the issue anchor", () => {
    const markup = renderToStaticMarkup(<ArtifactCard artifact={makeArtifact()} />);
    expect(markup).toContain('href="/issues/PAP-10306#attachment-art-1"');
    expect(markup).toContain('data-disable-issue-quicklook="true"');
    expect(markup).toContain('data-media-kind="image"');
    expect(markup).toContain("rounded-lg");
    expect(markup).toContain('src="/files/art-1.png"');
    expect(markup).toContain("object-cover");
    expect(markup).toContain("Hero shot");
  });

  it("shows the filename, the created time and the origin line", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({
          originalFilename: "hero-shot-final.png",
          createdAt: LOCAL_NOON_2026_06_01,
        })}
      />,
    );

    // The uploaded filename wins over the title (HIS-2660 field).
    expect(markup).toContain("hero-shot-final.png");
    expect(markup).not.toContain(">Hero shot<");
    // Creation time, not the update time (HIS-2659 item 3).
    expect(markup).toContain("Aangemaakt 1 jun 12:00");
    expect(markup).not.toContain("Bewerkt");
    expect(markup).toContain("PAP-10306 · ClaudeCoder");
  });

  it("falls back to the update time and a placeholder name", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard artifact={makeArtifact({ title: "", createdByAgent: null })} />,
    );
    expect(markup).toContain("Zonder titel");
    expect(markup).toContain("Bewerkt 1 jun 12:00");
    expect(markup).toContain("PAP-10306");
    expect(markup).not.toContain(" · </p>");
  });

  // ---- acceptance criterion (b): no hover-only action ---------------------

  it("keeps Openen and Downloaden visible and keyboard reachable", () => {
    const markup = renderToStaticMarkup(<ArtifactCard artifact={makeArtifact()} />);

    expect(markup).toContain('aria-label="Openen: Hero shot"');
    expect(markup).toContain('aria-label="Downloaden: Hero shot"');
    expect(markup).toContain(">Openen<");
    expect(markup).toContain(">Downloaden<");
    // The old reveal-on-hover row is gone: nothing that only appears on :hover.
    expect(markup).not.toContain("opacity-0");
    expect(markup).not.toContain("group-hover:opacity-100");
    expect(markup).not.toContain("group-focus-within:opacity-100");
    // Real anchors, so keyboard and touch reach them without a hover state.
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('download=""');
  });

  it("omits open/download actions when no file paths exist (e.g. documents)", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({
          source: "document",
          mediaKind: "document",
          contentPath: null,
          openPath: null,
          downloadPath: null,
          previewText: "Plan body",
        })}
      />,
    );
    expect(markup).not.toContain(">Openen<");
    expect(markup).not.toContain(">Downloaden<");
  });

  // ---- acceptance criterion (c): failure chip, no extra API call ----------
  //
  // The revised criterion reads the failure off the artifact itself
  // (`status = failed` or `healthStatus = unhealthy`), not off a run field:
  // `turnTerminalState` belongs to run finalization and is not on an artifact.

  it("shows a failure chip for a failed artifact without calling the API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const markup = renderToStaticMarkup(
      <ArtifactCard artifact={makeArtifact({ status: "failed" })} />,
    );

    expect(markup).toContain('data-status-tone="failure"');
    expect(markup).toContain('data-testid="artifact-status-chip"');
    expect(markup).toContain('data-tone="failure"');
    expect(markup).toContain('data-reason="status=failed"');
    // The label is the house vocabulary's, shared with the work-product chips.
    expect(markup).toContain("Failed");
    // Derived from the payload we already have: nothing is fetched per card.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("shows a failure chip for an unhealthy artifact too", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard artifact={makeArtifact({ healthStatus: "unhealthy" })} />,
    );
    expect(markup).toContain('data-tone="failure"');
    expect(markup).toContain('data-reason="healthStatus=unhealthy"');
  });

  it("shows at most one chip and renders chip-free for pre-projection payloads", () => {
    // One chip per card even when several status fields are set. Which one wins
    // is the house mapper's decision, not this card's (HIS-2659).
    const withBoth = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({ status: "failed", reviewState: "needs_board_review" })}
      />,
    );
    expect(withBoth.match(/data-testid="artifact-status-chip"/g)?.length).toBe(1);
    expect(withBoth).toContain('data-reason="reviewState=needs_board_review"');

    const bare = renderToStaticMarkup(<ArtifactCard artifact={makeArtifact()} />);
    expect(bare).not.toContain('data-testid="artifact-status-chip"');
    expect(bare).toContain('data-status-tone="none"');
  });

  it("keeps the chip out of the preview box so it cannot cover preview text", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({
          source: "document",
          mediaKind: "document",
          contentType: "text/markdown",
          contentPath: null,
          openPath: null,
          downloadPath: null,
          previewText: "90 dagenplan: 3 betalende klanten tegen 26 december.",
          status: "failed",
        })}
      />,
    );

    const doc = new DOMParser().parseFromString(markup, "text/html");
    const chip = doc.querySelector('[data-testid="artifact-status-chip"]');
    const preview = doc.querySelector(".aspect-video");

    expect(chip).not.toBeNull();
    expect(preview).not.toBeNull();
    // An absolutely positioned chip used to be painted over the preview and hid
    // the first line of the excerpt, so the preview must not contain it.
    expect(preview!.contains(chip!)).toBe(false);
    expect(preview!.textContent).toContain("90 dagenplan");
    expect(doc.body.textContent).toContain("Failed");
  });

  // ---- performance items -------------------------------------------------

  it("reserves the preview box and lazy-loads the image", () => {
    const markup = renderToStaticMarkup(<ArtifactCard artifact={makeArtifact()} />);

    expect(markup).toContain("aspect-video");
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('width="480"');
    expect(markup).toContain('height="270"');
    // The decorative stack layers were removed (audit).
    expect(markup).not.toContain("artifact-stack-layer");
  });

  it("renders a video preview with a video element and play glyph", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({ mediaKind: "video", contentType: "video/mp4", contentPath: "/files/clip.mp4" })}
      />,
    );
    expect(markup).toContain('data-media-kind="video"');
    expect(markup).toContain("<video");
    expect(markup).toContain('preload="metadata"');
  });

  it("renders a falling-back video placeholder when no content path exists", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard artifact={makeArtifact({ mediaKind: "video", contentPath: null })} />,
    );
    expect(markup).toContain('data-media-kind="video"');
    expect(markup).not.toContain("<video");
  });

  it("renders a document preview excerpt", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({
          source: "document",
          mediaKind: "document",
          contentType: "text/markdown",
          contentPath: null,
          previewText: "This is the plan preview excerpt.",
        })}
      />,
    );
    expect(markup).toContain('data-media-kind="document"');
    expect(markup).toContain("This is the plan preview excerpt.");
    expect(markup).toContain("max-h-full");
    expect(markup).toContain("overflow-hidden");
  });

  it("renders a placeholder for empty artifacts without an image or video", () => {
    const markup = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({ mediaKind: "empty", contentType: null, contentPath: null, previewText: null })}
      />,
    );
    expect(markup).toContain('data-media-kind="empty"');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<video");
  });

  // ---- video thumbnail behaviour (unchanged) -----------------------------

  const mountedContainers: HTMLDivElement[] = [];
  const mountedRoots: ReturnType<typeof createRoot>[] = [];

  function mount(contentPath: string) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedContainers.push(container);
    mountedRoots.push(root);
    flushSync(() => {
      root.render(
        <ArtifactCard
          artifact={makeArtifact({ mediaKind: "video", contentType: "video/mp4", contentPath })}
        />,
      );
    });
    return container;
  }

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      flushSync(() => root.unmount());
    }
    for (const container of mountedContainers.splice(0)) {
      container.remove();
    }
  });

  it("seeks video previews after metadata loads so a thumbnail frame is painted", () => {
    const container = mount("/files/clip.mp4");

    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.dataset.frameReady).toBe("false");

    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA,
    });

    flushSync(() => {
      video.dispatchEvent(new Event("loadedmetadata", { bubbles: true }));
    });

    expect(video.currentTime).toBe(0.05);

    flushSync(() => {
      video.dispatchEvent(new Event("seeked", { bubbles: true }));
    });

    expect(video.dataset.frameReady).toBe("true");
  });

  it("seeks into clips and resets thumbnail state when the source changes", () => {
    const container = mount("/first.mp4");
    const first = container.querySelector("video")!;
    Object.defineProperty(first, "duration", { value: 8 });
    flushSync(() => first.dispatchEvent(new Event("loadedmetadata")));
    expect(first.currentTime).toBe(1);
    flushSync(() => first.dispatchEvent(new Event("seeked")));
    expect(first.dataset.frameReady).toBe("true");

    flushSync(() => {
      mountedRoots[0].render(
        <ArtifactCard artifact={makeArtifact({ mediaKind: "video", contentPath: "/short.mp4" })} />,
      );
    });

    const next = container.querySelector("video")!;
    expect(next).not.toBe(first);
    expect(next.dataset.frameReady).toBe("false");
    Object.defineProperty(next, "duration", { value: 0.2 });
    flushSync(() => next.dispatchEvent(new Event("loadedmetadata")));
    expect(next.currentTime).toBe(0.05);
    expect(next.autoplay).toBe(false);
    expect(next.muted).toBe(true);
  });

  it("reveals video previews if the browser does not report seek completion", () => {
    vi.useFakeTimers();
    try {
      const container = mount("/files/clip.mp4");

      const video = container.querySelector("video") as HTMLVideoElement;
      expect(video.dataset.frameReady).toBe("false");

      flushSync(() => {
        video.dispatchEvent(new Event("loadedmetadata", { bubbles: true }));
      });

      expect(video.currentTime).toBe(0.05);
      expect(video.dataset.frameReady).toBe("false");

      flushSync(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(video.dataset.frameReady).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Card body = the last child of the card root (`article` / skeleton wrapper). */
function bodyOf(markup: string, rootSelector: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const root = host.querySelector(rootSelector) as HTMLElement;
  expect(root).not.toBeNull();
  return root.lastElementChild as HTMLElement;
}

describe("ArtifactCardSkeleton", () => {
  it("reserves the same rows as a loaded card that carries a chip and an origin line", () => {
    // A card that renders *every* conditional row: a failure chip
    // (`status = failed`) and the origin line (`issue.identifier · agent`).
    const cardMarkup = renderToStaticMarkup(
      <ArtifactCard artifact={makeArtifact({ status: "failed" })} />,
    );
    const skeletonMarkup = renderToStaticMarkup(<ArtifactCardSkeleton />);

    expect(cardMarkup).toContain('data-status-tone="failure"');
    expect(cardMarkup).toContain("PAP-10306 · ClaudeCoder");

    const cardBody = bodyOf(cardMarkup, '[data-testid="artifact-card"]');
    const skeletonBody = bodyOf(skeletonMarkup, '[data-testid="artifact-card-skeleton"]');

    // Same body rhythm, so the two only differ in their contents.
    expect(cardBody.className).toBe("flex flex-1 flex-col gap-1 p-3");
    expect(skeletonBody.className).toBe(cardBody.className);

    // chip row + title + meta row + origin line + action row.
    expect(cardBody.children.length).toBe(5);
    expect(skeletonBody.children.length).toBe(cardBody.children.length);

    // Each row of the card keeps its height in the placeholder: chip row
    // (min-h-5), title (h-5), meta row (min-h-4), action row (h-9 buttons).
    expect((cardBody.children[0] as HTMLElement).className).toContain("min-h-5");
    expect((skeletonBody.children[0] as HTMLElement).className).toContain("min-h-5");
    expect((cardBody.children[1] as HTMLElement).className).toContain("h-5");
    expect(skeletonBody.children[1].className).toContain("h-5");
    expect((cardBody.children[2] as HTMLElement).className).toContain("min-h-4");
    expect((skeletonBody.children[2] as HTMLElement).className).toContain("min-h-4");
    expect((cardBody.children[4] as HTMLElement).className).toContain("mt-1.5");
    expect(skeletonBody.children[4].className).toContain("mt-1.5");
    for (const placeholder of skeletonBody.children[4].children) {
      expect((placeholder as HTMLElement).className).toContain("h-9");
    }
  });

  it("gives the chip placeholder the chip's own box, not a guessed height", () => {
    // The real chip is a `--text-micro` line box (16.5px) plus `py-0.5` and a
    // 1px border = 22.5px. An `h-5` placeholder (20px) would make the row grow
    // by 2.5px per card as soon as the data lands. Copying the chip's own box
    // classes is what makes the reservation exact; the line box comes from an
    // invisible label, so no raw pixel value is needed.
    const cardMarkup = renderToStaticMarkup(
      <ArtifactCard artifact={makeArtifact({ status: "failed" })} />,
    );
    const skeletonBody = bodyOf(
      renderToStaticMarkup(<ArtifactCardSkeleton />),
      '[data-testid="artifact-card-skeleton"]',
    );

    const host = document.createElement("div");
    host.innerHTML = cardMarkup;
    const chip = host.querySelector('[data-testid="artifact-status-chip"]') as HTMLElement;
    const chipRow = skeletonBody.children[0] as HTMLElement;
    const placeholder = chipRow.firstElementChild as HTMLElement;

    // The placeholder is the chip's own box: every box class that decides the
    // height (padding, border, line box) is shared, so the two cannot drift.
    const boxClasses = ["inline-flex", "items-center", "rounded-full", "border", "px-2", "py-0.5"];
    for (const boxClass of boxClasses) {
      expect(chip.className.split(/\s+/)).toContain(boxClass);
      expect(placeholder.className.split(/\s+/)).toContain(boxClass);
    }
    expect(chip.className).toContain("text-(length:--text-micro)");
    expect(placeholder.className).toContain("text-(length:--text-micro)");
    // Both pin the line box to the font size, so the height is the same number.
    expect(chip.className).toContain("leading-none");
    expect(placeholder.className).toContain("leading-none");
    // The placeholder is invisible but keeps the text, which is what gives it
    // the line box of a real chip label.
    expect(placeholder.className).toContain("invisible");
    expect(placeholder.textContent?.length).toBeGreaterThan(0);
  });

  it("reserves the meta and origin lines with a text line box, not a bare h-4", () => {
    // Both lines are `--text-micro` text in the loaded card, so their box is a
    // line box (16.5px) rather than the 16px of `h-4`.
    const skeletonBody = bodyOf(
      renderToStaticMarkup(<ArtifactCardSkeleton />),
      '[data-testid="artifact-card-skeleton"]',
    );
    const metaRow = skeletonBody.children[2] as HTMLElement;
    const originLine = skeletonBody.children[3] as HTMLElement;

    expect(metaRow.className).toContain("min-h-4");
    expect(metaRow.className).toContain("items-center");
    for (const line of [metaRow.firstElementChild as HTMLElement, originLine]) {
      expect(line.className).toContain("text-(length:--text-micro)");
      const label = line.querySelector("span") as HTMLElement;
      expect(label.className).toContain("invisible");
      expect(label.textContent?.length).toBeGreaterThan(0);
    }
  });

  it("keeps the reserved rows even when the payload has no status fields yet", () => {
    // Before Deel B lands the real cards show neither chip nor origin, so the
    // skeleton is deliberately the *taller* of the two: shrinking later is a
    // cheaper mistake than pushing the grid down.
    const plainCard = bodyOf(
      renderToStaticMarkup(<ArtifactCard artifact={makeArtifact({ issue: null, createdByAgent: null })} />),
      '[data-testid="artifact-card"]',
    );
    const skeletonBody = bodyOf(
      renderToStaticMarkup(<ArtifactCardSkeleton />),
      '[data-testid="artifact-card-skeleton"]',
    );
    expect(skeletonBody.children.length).toBeGreaterThan(plainCard.children.length);
  });

  it("mirrors the recent shelf rows so the shelf does not change height on load", () => {
    const markup = renderToStaticMarkup(<ArtifactRecentListSkeleton />);
    const host = document.createElement("div");
    host.innerHTML = markup;
    const rows = host.querySelectorAll('[data-testid="artifact-recent-skeleton"] > li');
    expect(rows.length).toBe(5);
    // Same row padding as the real shelf: `px-3 py-2`.
    for (const row of rows) {
      expect((row as HTMLElement).className).toContain("px-3");
      expect((row as HTMLElement).className).toContain("py-2");
    }

    // The real row, with the chip that sets its height.
    const realHost = document.createElement("div");
    realHost.innerHTML = renderToStaticMarkup(
      <ArtifactRecentList
        artifacts={Array.from({ length: 5 }, (_, index) =>
          makeArtifact({ id: `art-${index}`, status: "failed" }),
        )}
      />,
    );
    const realRow = realHost.querySelector(
      '[data-testid="artifact-recent-list"] > li > a',
    ) as HTMLElement;
    const skeletonRow = rows[0] as HTMLElement;

    // Same number of boxes per row: chip, title, meta (sm and up), time.
    expect(skeletonRow.children.length).toBe(realRow.children.length);

    // And the chip placeholder copies the chip's own box, so the row keeps its
    // 22.5px content instead of shrinking to the 20px of an `h-5` guess.
    const chip = realRow.querySelector('[data-testid="artifact-status-chip"]') as HTMLElement;
    const placeholder = skeletonRow.firstElementChild as HTMLElement;
    for (const boxClass of ["inline-flex", "items-center", "rounded-full", "border", "px-2", "py-0.5"]) {
      expect(chip.className.split(/\s+/)).toContain(boxClass);
      expect(placeholder.className.split(/\s+/)).toContain(boxClass);
    }
    expect(placeholder.className).toContain("text-(length:--text-micro)");
  });
});
