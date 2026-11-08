import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hoistModuleGraph } from "./helpers/hoist-module-graph.js";

const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getComment: vi.fn(),
  updateComment: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(async ({ action }: { action: string }) => ({
    action, allowed: action === "issue:read", reason: "allow_default", explanation: "Fixture task is readable",
  })),
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(),
  wakeup: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockFeedbackService = vi.hoisted(() => ({
  listIssueVotesForUser: vi.fn(async () => []),
  saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
}));
const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(async () => ({
    id: "instance-settings-1",
    general: { censorUsernameInLogs: false, feedbackDataSharingPreference: "prompt" },
  })),
  getExperimental: vi.fn(async () => ({ enableExternalObjects: false })),
  listCompanyIds: vi.fn(async () => ["company-1"]),
}));
const mockIssueReferenceService = vi.hoisted(() => ({
  deleteCommentSource: vi.fn(async () => undefined),
  deleteDocumentSource: vi.fn(async () => undefined),
  diffIssueReferenceSummary: vi.fn(() => ({
    addedReferencedIssues: [],
    removedReferencedIssues: [],
    currentReferencedIssues: [],
  })),
  emptySummary: vi.fn(() => ({ outbound: [], inbound: [] })),
  listIssueReferenceSummary: vi.fn(async () => ({ outbound: [], inbound: [] })),
  syncComment: vi.fn(async () => undefined),
  syncDocument: vi.fn(async () => undefined),
  syncIssue: vi.fn(async () => undefined),
}));
const mockExternalObjectService = vi.hoisted(() => ({
  getIssueSummaries: vi.fn(async () => ({ summaries: {} })),
  listForIssue: vi.fn(async () => []),
  refreshIssueObjects: vi.fn(async () => []),
  syncCommentSafely: vi.fn(async () => undefined),
  syncDocumentSafely: vi.fn(async () => undefined),
  syncIssueSafely: vi.fn(async () => undefined),
}));

function registerModuleMocks() {
  vi.doMock("@paperclipai/shared/telemetry", () => ({
    trackAgentTaskCompleted: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));
  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
  }));
  vi.doMock("../services/access.js", () => ({ accessService: () => mockAccessService }));
  vi.doMock("../services/activity-log.js", () => ({ logActivity: mockLogActivity }));
  vi.doMock("../services/feedback.js", () => ({ feedbackService: () => mockFeedbackService }));
  vi.doMock("../services/heartbeat.js", () => ({ heartbeatService: () => mockHeartbeatService }));
  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));
  vi.doMock("../services/issues.js", () => ({ issueService: () => mockIssueService }));
  vi.doMock("../services/external-objects.js", () => ({
    externalObjectService: () => mockExternalObjectService,
  }));
  vi.doMock("../services/index.js", () => ({
    companyService: () => ({ getById: vi.fn(async () => ({ id: "company-1" })) }),
    accessService: () => mockAccessService,
    agentService: () => ({ getById: vi.fn(async () => null) }),
    companySkillService: () => ({ completeTestRunForIssue: vi.fn(async () => null) }),
    documentAnnotationService: () => ({}),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => mockFeedbackService,
    goalService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
    instanceSettingsService: () => mockInstanceSettingsService,
    issueApprovalService: () => ({}),
    issueRecoveryActionService: () => ({
      getActiveForIssue: vi.fn(async () => null),
      listActiveForIssues: vi.fn(async () => new Map()),
    }),
    issueReferenceService: () => mockIssueReferenceService,
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => ({}),
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({ syncRunStatusForIssue: vi.fn(async () => undefined) }),
    workProductService: () => ({}),
  }));
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: ISSUE_ID,
    companyId: "company-1",
    status: "in_progress",
    assigneeAgentId: AGENT_ID,
    assigneeUserId: null,
    projectId: null,
    parentId: null,
    executionRunId: "run-1",
    identifier: "PAP-42",
    title: "Edit comment",
    ...overrides,
  };
}

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: "comment-1",
    companyId: "company-1",
    issueId: ISSUE_ID,
    authorAgentId: null,
    authorUserId: "local-board",
    body: "Original text",
    deletedAt: null,
    createdAt: new Date("2026-04-11T15:01:00.000Z"),
    updatedAt: new Date("2026-04-11T15:01:00.000Z"),
    ...overrides,
  };
}

const BOARD_ACTOR = {
  type: "board",
  userId: "local-board",
  companyIds: ["company-1"],
  source: "local_implicit",
  isInstanceAdmin: false,
};

describe("issue comment edit route", () => {
  const routeModules = hoistModuleGraph(registerModuleMocks, async () => {
    const [{ issueRoutes }, { errorHandler }] = await Promise.all([
      vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    ]);
    return { issueRoutes, errorHandler };
  });

  function createApp(actor: Record<string, unknown> = BOARD_ACTOR) {
    const { issueRoutes, errorHandler } = routeModules.value;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          // Awaitable directly (run secret redaction) and via orderBy.
          where: vi.fn(() => Object.assign(Promise.resolve([]), { orderBy: vi.fn(async () => []) })),
        })),
      })),
    };
    app.use("/api", issueRoutes(db as any, {} as any));
    app.use(errorHandler);
    return app;
  }

  function patchComment(body: unknown, actor?: Record<string, unknown>, commentId = "comment-1") {
    return request(createApp(actor))
      .patch(`/api/issues/${ISSUE_ID}/comments/${commentId}`)
      .send(body as object);
  }

  let storedBody: string;

  beforeEach(() => {
    vi.clearAllMocks();
    storedBody = "Original text";
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.getComment.mockImplementation(async () => makeComment({ body: storedBody }));
    mockIssueService.updateComment.mockImplementation(async (_id: string, body: string) => {
      storedBody = body;
      return makeComment({ body, updatedAt: new Date("2026-04-11T15:10:00.000Z") });
    });
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: AGENT_ID,
      status: "running",
      contextSnapshot: { issueId: ISSUE_ID },
    });
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockResolvedValue({ id: "run-1", companyId: "company-1", agentId: AGENT_ID });
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "run-2" });
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("lets a board user edit their own comment, logs the previous body and re-wakes the assignee", async () => {
    const res = await patchComment({ body: "  Updated text  " });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: "comment-1",
      body: "Updated text",
      wakeup: { runId: "run-2", interruptedRunId: null },
    });
    expect(mockIssueService.updateComment).toHaveBeenCalledWith("comment-1", "Updated text");
    expect(mockIssueReferenceService.syncComment).toHaveBeenCalledWith("comment-1");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.comment_edited",
        entityId: ISSUE_ID,
        details: expect.objectContaining({ commentId: "comment-1", previousBody: "Original text" }),
      }),
    );
    expect(mockHeartbeatService.cancelRun).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({
        reason: "issue_commented",
        payload: expect.objectContaining({ issueId: ISSUE_ID, commentId: "comment-1", mutation: "comment_edited" }),
      }),
    );
  });

  it("cancels the active run first when interrupt is requested", async () => {
    const res = await patchComment({ body: "Stop and redo", interrupt: true });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith(
      "run-1",
      "Interrupted by edited board comment",
      expect.anything(),
    );
    expect(res.body.wakeup).toEqual({ runId: "run-2", interruptedRunId: "run-1" });
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({ payload: expect.objectContaining({ interruptedRunId: "run-1" }) }),
    );
  });

  it("does not wake the assignee when wake is false or the issue is done", async () => {
    const quiet = await patchComment({ body: "Typo fix", wake: false });
    expect(quiet.status).toBe(200);
    expect(mockIssueService.updateComment).toHaveBeenCalledTimes(1);

    mockIssueService.getById.mockResolvedValue(makeIssue({ status: "done" }));
    const done = await patchComment({ body: "Another typo fix" });
    expect(done.status).toBe(200);
    expect(mockIssueService.updateComment).toHaveBeenCalledTimes(2);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("keeps the saved edit when the wakeup fails", async () => {
    mockHeartbeatService.wakeup.mockRejectedValue(new Error("wake failed"));

    const res = await patchComment({ body: "Updated text" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ body: "Updated text", wakeup: { runId: null } });
    expect(mockIssueService.updateComment).toHaveBeenCalledWith("comment-1", "Updated text");
  });

  it("skips the write and the wakeup when the text is unchanged", async () => {
    const res = await patchComment({ body: "Original text  " });

    expect(res.status).toBe(200);
    expect(mockIssueService.updateComment).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("rejects a comment written by another user with 403", async () => {
    mockIssueService.getComment.mockResolvedValue(makeComment({ authorUserId: "other-user" }));

    const res = await patchComment({ body: "Hijack" });

    expect(res.status).toBe(403);
    expect(mockIssueService.updateComment).not.toHaveBeenCalled();
  });

  it("rejects an agent-authored comment with 403", async () => {
    mockIssueService.getComment.mockResolvedValue(makeComment({ authorAgentId: AGENT_ID, authorUserId: null }));

    const res = await patchComment({ body: "Rewrite agent output" });

    expect(res.status).toBe(403);
    expect(mockIssueService.updateComment).not.toHaveBeenCalled();
  });

  it("rejects a deleted comment with 409", async () => {
    mockIssueService.getComment.mockResolvedValue(
      makeComment({ body: "", deletedAt: new Date("2026-04-11T15:05:00.000Z") }),
    );

    const res = await patchComment({ body: "Bring it back" });

    expect(res.status).toBe(409);
    expect(mockIssueService.updateComment).not.toHaveBeenCalled();
  });

  it("rejects an empty or too long body with 400", async () => {
    const empty = await patchComment({ body: "   " });
    const missing = await patchComment({});
    const tooLong = await patchComment({ body: "x".repeat(100_001) });

    expect(empty.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(mockIssueService.updateComment).not.toHaveBeenCalled();
  });

  it("returns 404 for a comment that belongs to another issue", async () => {
    mockIssueService.getComment.mockResolvedValue(
      makeComment({ issueId: "33333333-3333-4333-8333-333333333333" }),
    );

    const res = await patchComment({ body: "Wrong issue" });

    expect(res.status).toBe(404);
    expect(mockIssueService.updateComment).not.toHaveBeenCalled();
  });

  it("rejects non-board actors with 403", async () => {
    const res = await patchComment(
      { body: "Agent edit" },
      { type: "agent", agentId: AGENT_ID, companyId: "company-1", runId: null, source: "agent_key" },
    );

    expect(res.status).toBe(403);
    expect(mockIssueService.getComment).not.toHaveBeenCalled();
    expect(mockIssueService.updateComment).not.toHaveBeenCalled();
  });
});
