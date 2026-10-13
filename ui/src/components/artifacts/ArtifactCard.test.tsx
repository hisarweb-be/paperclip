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

  // ---- acceptance criterion (c): red chip, no extra API call --------------

  it("shows a red chip for a failed run without calling the API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const markup = renderToStaticMarkup(
      <ArtifactCard artifact={makeArtifact({ turnTerminalState: "failed" })} />,
    );

    expect(markup).toContain('data-status-tone="red"');
    expect(markup).toContain('data-testid="artifact-status-chip"');
    expect(markup).toContain('data-tone="red"');
    expect(markup).toContain('data-reason="turnTerminalState=failed"');
    expect(markup).toContain("Gefaald");
    // Derived from the payload we already have: nothing is fetched per card.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("shows at most one chip and renders chip-free for pre-projection payloads", () => {
    const withReview = renderToStaticMarkup(
      <ArtifactCard
        artifact={makeArtifact({ turnTerminalState: "failed", reviewState: "pending", status: "active" })}
      />,
    );
    expect(withReview.match(/data-testid="artifact-status-chip"/g)?.length).toBe(1);
    expect(withReview).toContain('data-tone="red"');

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
          turnTerminalState: "failed",
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
    expect(doc.body.textContent).toContain("Gefaald");
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
