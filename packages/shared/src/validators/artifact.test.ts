import { describe, expect, it } from "vitest";
import { companyArtifactsQuerySchema, companyArtifactsResponseSchema } from "./artifact.js";

const issue = {
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "PAP-1",
  title: "Build artifacts",
};

const artifact = {
  id: "document:22222222-2222-4222-8222-222222222222",
  source: "document",
  mediaKind: "document",
  title: "Plan",
  previewText: "Artifact preview",
  contentType: "text/markdown",
  contentPath: null,
  openPath: null,
  downloadPath: null,
  issue,
  project: null,
  createdByAgent: null,
  createdAt: "2026-06-06T11:00:00.000Z",
  updatedAt: "2026-06-06T12:00:00.000Z",
  href: "/PAP/issues/PAP-1#document-plan",
  byteSize: 1024,
  originalFilename: "plan.md",
  summary: null,
  status: null,
  reviewState: null,
  healthStatus: null,
  isPrimary: null,
  provider: null,
  createdByRunId: null,
  issueId: issue.id,
  projectId: null,
};

describe("companyArtifactsQuerySchema", () => {
  it("defaults to the flat artifact query with a limit of 50", () => {
    expect(companyArtifactsQuerySchema.parse({})).toMatchObject({
      kind: "all",
      groupBy: "none",
      sort: "createdAt:desc",
      limit: 50,
    });
  });

  it("coerces the limit from a query string and rejects values above the maximum", () => {
    expect(companyArtifactsQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(() => companyArtifactsQuerySchema.parse({ limit: "101" })).toThrow();
    expect(() => companyArtifactsQuerySchema.parse({ limit: "0" })).toThrow();
  });

  it("accepts both createdAt sort directions and rejects anything else", () => {
    expect(companyArtifactsQuerySchema.parse({ sort: "createdAt:asc" }).sort).toBe("createdAt:asc");
    expect(companyArtifactsQuerySchema.parse({ sort: "createdAt:desc" }).sort).toBe("createdAt:desc");
    expect(() => companyArtifactsQuerySchema.parse({ sort: "updatedAt:desc" })).toThrow();
  });

  it("accepts grouped artifact query parameters", () => {
    expect(
      companyArtifactsQuerySchema.parse({
        groupBy: "parent_task",
        groupIssueId: issue.id,
        kind: "video",
        q: "render",
      }),
    ).toMatchObject({
      groupBy: "parent_task",
      groupIssueId: issue.id,
      kind: "video",
      q: "render",
    });
  });

  it("rejects invalid grouped artifact query parameters", () => {
    expect(() => companyArtifactsQuerySchema.parse({ groupBy: "agent" })).toThrow();
    expect(() => companyArtifactsQuerySchema.parse({ groupIssueId: "PAP-1" })).toThrow();
  });
});

describe("companyArtifactsResponseSchema", () => {
  it("accepts grouped artifact responses with selected group metadata", () => {
    const group = {
      id: `task:${issue.id}`,
      groupBy: "task",
      issue,
      title: issue.title,
      count: 1,
      mediaKinds: ["document"],
      previewArtifacts: [artifact],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z",
      href: `/PAP/artifacts?groupBy=task&groupIssueId=${issue.id}`,
    };

    expect(
      companyArtifactsResponseSchema.parse({
        artifacts: [artifact],
        groups: [group],
        selectedGroup: group,
        nextCursor: null,
      }),
    ).toMatchObject({
      artifacts: [artifact],
      groups: [group],
      selectedGroup: group,
      nextCursor: null,
    });
  });

  it("requires createdAt on every artifact and on every group", () => {
    const withoutCreatedAt: Record<string, unknown> = { ...artifact };
    delete withoutCreatedAt.createdAt;
    expect(() =>
      companyArtifactsResponseSchema.parse({ artifacts: [withoutCreatedAt], nextCursor: null }),
    ).toThrow();

    expect(() =>
      companyArtifactsResponseSchema.parse({
        artifacts: [],
        groups: [{ id: `task:${issue.id}`, groupBy: "task", issue, title: issue.title, count: 0, mediaKinds: [], previewArtifacts: [], updatedAt: artifact.updatedAt, href: "/PAP/artifacts" }],
        nextCursor: null,
      }),
    ).toThrow();
  });

  it("carries the size, type and failure state of an artifact in one response", () => {
    const failed = {
      ...artifact,
      id: "work_product:33333333-3333-4333-8333-333333333333",
      source: "work_product",
      mediaKind: "video",
      contentType: "video/mp4",
      byteSize: 2048,
      healthStatus: "failed",
      reviewState: "pending",
      status: "failed",
      isPrimary: true,
      provider: "paperclip",
      createdByRunId: "44444444-4444-4444-8444-444444444444",
      issueId: issue.id,
      projectId: "55555555-5555-4555-8555-555555555555",
    };

    const parsed = companyArtifactsResponseSchema.parse({
      artifacts: [failed],
      nextCursor: "eyJ2IjoyfQ",
    });

    expect(parsed.artifacts[0]).toMatchObject({
      createdAt: artifact.createdAt,
      byteSize: 2048,
      contentType: "video/mp4",
      healthStatus: "failed",
      reviewState: "pending",
      isPrimary: true,
      createdByRunId: "44444444-4444-4444-8444-444444444444",
    });
    expect(parsed.nextCursor).toBe("eyJ2IjoyfQ");
  });
});
