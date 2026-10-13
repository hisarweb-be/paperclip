import { describe, expect, it } from "vitest";
import type { CompanyArtifact } from "@/api/artifacts";
import {
  artifactByteSize,
  artifactByteSizeLabel,
  artifactContentType,
  artifactCreatedAt,
  artifactCreatedByRunId,
  artifactDateTimeLabel,
  artifactDownloadHref,
  artifactFilename,
  artifactIsPrimary,
  artifactMediaKindLabel,
  artifactMetaParts,
  artifactOpenHref,
  artifactOriginLabel,
  artifactSortTime,
  artifactTimestamp,
  createdAtText,
} from "./artifact-display";

/** Local noon so the nl-BE label is identical in every timezone. */
const LOCAL_NOON_2026_10_13 = new Date(2026, 9, 13, 12, 0, 0, 0).toISOString();

function artifact(overrides: Record<string, unknown> = {}): CompanyArtifact {
  return {
    id: "art-1",
    source: "attachment",
    mediaKind: "image",
    title: "Hero shot",
    previewText: null,
    contentType: "image/png",
    contentPath: "/files/art-1.png",
    openPath: null,
    downloadPath: null,
    issue: { id: "issue-1", identifier: "HIS-123", title: "Landing visuals" },
    project: null,
    createdByAgent: null,
    updatedAt: "2026-10-01T09:00:00.000Z",
    href: "/issues/HIS-123#attachment-art-1",
    ...overrides,
  } as CompanyArtifact;
}

describe("artifactFilename", () => {
  it("prefers the uploaded filename over the stored filename and the title", () => {
    expect(
      artifactFilename(
        artifact({ originalFilename: "hero-final.png", filename: "stored.png", title: "Hero shot" }),
      ),
    ).toBe("hero-final.png");
    expect(artifactFilename(artifact({ filename: "stored.png" }))).toBe("stored.png");
    expect(artifactFilename(artifact())).toBe("Hero shot");
  });

  it("falls back to a placeholder instead of an empty heading", () => {
    expect(artifactFilename(artifact({ title: "   " }))).toBe("Zonder titel");
    expect(artifactFilename(artifact({ title: "", originalFilename: "" }))).toBe("Zonder titel");
  });
});

describe("open and download targets", () => {
  it("prefers the producer's open path and falls back to the content path", () => {
    expect(artifactOpenHref(artifact({ openPath: "/api/attachments/a1/content" }))).toBe(
      "/api/attachments/a1/content",
    );
    expect(artifactOpenHref(artifact())).toBe("/files/art-1.png");
    expect(artifactOpenHref(artifact({ contentPath: null }))).toBe("");
  });

  it("rejects hostile or unusable targets instead of rendering them", () => {
    expect(artifactOpenHref(artifact({ openPath: "javascript:alert(1)" }))).toBe("/files/art-1.png");
    expect(artifactOpenHref(artifact({ openPath: "//evil.example/x", contentPath: null }))).toBe("");
    expect(artifactOpenHref(artifact({ contentPath: "file:///etc/passwd" }))).toBe("");
  });

  it("appends ?download=1 to the content path when no download path exists", () => {
    expect(artifactDownloadHref(artifact({ downloadPath: "/files/art-1.png?download=1" }))).toBe(
      "/files/art-1.png?download=1",
    );
    expect(artifactDownloadHref(artifact())).toBe("/files/art-1.png?download=1");
    expect(artifactDownloadHref(artifact({ contentPath: "/files/report.csv?v=2" }))).toBe(
      "/files/report.csv?v=2&download=1",
    );
    expect(artifactDownloadHref(artifact({ contentPath: null, downloadPath: null }))).toBe("");
  });
});

describe("artifactByteSize", () => {
  it("reads byteSize, then the legacy size fields, and ignores junk", () => {
    expect(artifactByteSize(artifact({ byteSize: 1900 }))).toBe(1900);
    expect(artifactByteSize(artifact({ sizeBytes: 2048 }))).toBe(2048);
    expect(artifactByteSize(artifact({ contentLength: 512 }))).toBe(512);
    expect(artifactByteSize(artifact({ byteSize: "1900" }))).toBeNull();
    expect(artifactByteSize(artifact({ byteSize: -1 }))).toBeNull();
    expect(artifactByteSize(artifact())).toBeNull();
  });

  it("formats with Dutch separators and stops at B/kB/MB", () => {
    expect(artifactByteSizeLabel(512)).toBe("512 B");
    expect(artifactByteSizeLabel(2048)).toBe("2 kB");
    expect(artifactByteSizeLabel(1900)).toBe("1,9 kB");
    expect(artifactByteSizeLabel(3 * 1024 * 1024)).toBe("3 MB");
    expect(artifactByteSizeLabel(4_500_000)).toBe("4,3 MB");
    expect(artifactByteSizeLabel(null)).toBe("");
  });
});

describe("artifactDateTimeLabel", () => {
  it("renders a Dutch date and keeps the colon between hour and minute", () => {
    const label = artifactDateTimeLabel(new Date(2026, 9, 13, 2, 14).toISOString());
    expect(label).toBe("13 okt 02:14");
    expect(label).not.toContain(",");
  });

  it("returns an empty string for missing or unparseable timestamps", () => {
    expect(artifactDateTimeLabel(null)).toBe("");
    expect(artifactDateTimeLabel("not a date")).toBe("");
  });
});

describe("artifactSortTime", () => {
  it("prefers createdAt, falls back to updatedAt, then to 0", () => {
    expect(
      artifactSortTime(artifact({ createdAt: "2026-10-13T12:00:00.000Z" })),
    ).toBe(Date.parse("2026-10-13T12:00:00.000Z"));
    expect(artifactSortTime(artifact())).toBe(Date.parse("2026-10-01T09:00:00.000Z"));
    expect(artifactSortTime(artifact({ updatedAt: "" }))).toBe(0);
  });

  it("never passes the update time off as the creation time", () => {
    expect(createdAtText(artifact())).toBe("");
    expect(artifactCreatedAt(artifact())).toBeNull();
    expect(artifactCreatedAt(artifact({ createdAt: LOCAL_NOON_2026_10_13 }))).toBe(
      Date.parse(LOCAL_NOON_2026_10_13),
    );
  });
});

describe("artifactMetaParts", () => {
  it("lists kind, size and the creation time in that order", () => {
    const parts = artifactMetaParts(
      artifact({ byteSize: 1900, createdAt: new Date(2026, 9, 13, 2, 14).toISOString() }),
    );
    expect(parts.map((part) => part.key)).toEqual(["kind", "size", "time"]);
    expect(parts.map((part) => part.label)).toEqual(["Afbeelding", "1,9 kB", "Aangemaakt 13 okt 02:14"]);
  });

  it("labels the update time as Bewerkt while the projection has no createdAt", () => {
    const parts = artifactMetaParts(artifact({ updatedAt: new Date(2026, 9, 13, 2, 14).toISOString() }));
    expect(parts.map((part) => part.label)).toEqual(["Afbeelding", "Bewerkt 13 okt 02:14"]);
  });

  it("drops the time part when no usable timestamp exists", () => {
    const parts = artifactMetaParts(artifact({ updatedAt: null }));
    expect(parts.map((part) => part.key)).toEqual(["kind"]);
  });
});

describe("small display helpers", () => {
  it("labels known media kinds and falls back for unknown ones", () => {
    expect(artifactMediaKindLabel("image")).toBe("Afbeelding");
    expect(artifactMediaKindLabel("video")).toBe("Video");
    expect(artifactMediaKindLabel("document")).toBe("Document");
    expect(artifactMediaKindLabel("text")).toBe("Tekst");
    expect(artifactMediaKindLabel("file")).toBe("Bestand");
    expect(artifactMediaKindLabel("something-new")).toBe("Artifact");
  });

  it("normalises the MIME type for the expert panel", () => {
    expect(artifactContentType(artifact({ contentType: "  IMAGE/PNG " }))).toBe("image/png");
    expect(artifactContentType(artifact({ contentType: null }))).toBe("");
  });

  it("builds the origin label from the issue identifier and the author", () => {
    expect(artifactOriginLabel(artifact({ createdByAgent: { id: "a1", name: "Bouwer web" } }))).toBe(
      "HIS-123 · Bouwer web",
    );
    expect(artifactOriginLabel(artifact({ createdByAgentName: "Bouwer SaaS" }))).toBe("HIS-123 · Bouwer SaaS");
    expect(artifactOriginLabel(artifact())).toBe("HIS-123");
    expect(artifactOriginLabel(artifact({ issue: null, createdByAgent: null }))).toBe("");
  });

  it("reads isPrimary and createdByRunId defensively", () => {
    expect(artifactIsPrimary(artifact({ isPrimary: true }))).toBe(true);
    expect(artifactIsPrimary(artifact({ isPrimary: "true" }))).toBe(false);
    expect(artifactIsPrimary(artifact())).toBe(false);
    expect(artifactCreatedByRunId(artifact({ createdByRunId: "run-9" }))).toBe("run-9");
    expect(artifactCreatedByRunId(artifact({ runId: "run-8" }))).toBe("run-8");
    expect(artifactCreatedByRunId(artifact())).toBe("");
  });

  it("parses timestamps only when they are usable", () => {
    expect(artifactTimestamp("2026-10-13T12:00:00.000Z")).toBe(Date.parse("2026-10-13T12:00:00.000Z"));
    expect(artifactTimestamp("")).toBeNull();
    expect(artifactTimestamp(null)).toBeNull();
    expect(artifactTimestamp("nonsense")).toBeNull();
  });
});
