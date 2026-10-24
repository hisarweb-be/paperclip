import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, companyMemberships, createDb, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import type { StorageService } from "../storage/types.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat-context execution review tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issue heartbeat-context execution review", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let app!: ReturnType<typeof createApp>;
  let companyId!: string;
  const executorAgentId = randomUUID();
  const reviewerAgentId = randomUUID();

  function executionState(overrides: Record<string, unknown> = {}) {
    return {
      status: "pending",
      currentStageId: null,
      currentStageIndex: 0,
      currentStageType: "review",
      currentParticipant: { type: "agent", agentId: reviewerAgentId, userId: null },
      returnAssignee: { type: "agent", agentId: executorAgentId, userId: null },
      reviewRequest: null,
      completedStageIds: [],
      lastDecisionId: null,
      lastDecisionOutcome: null,
      monitor: null,
      changesRequestedCount: 0,
      ...overrides,
    };
  }

  function createStorage(): StorageService {
    return {
      provider: "local_disk",
      putFile: vi.fn(async () => {
        throw new Error("Unexpected storage.putFile call in execution review route test");
      }),
      getObject: vi.fn(async () => {
        throw new Error("Unexpected storage.getObject call in execution review route test");
      }),
      headObject: vi.fn(async () => ({ exists: false })),
      deleteObject: vi.fn(async () => undefined),
    };
  }

  function createApp(targetCompanyId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "cloud-user-1",
        companyIds: [targetCompanyId],
        memberships: [{ companyId: targetCompanyId, membershipRole: "owner", status: "active" }],
        source: "cloud_tenant",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes(db, createStorage()));
    app.use(errorHandler);
    return app;
  }

  async function createIssue(): Promise<string> {
    const res = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: `Execution review context ${randomUUID()}`,
        description: "HIS-2579 route test",
        status: "todo",
      });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body.id, JSON.stringify(res.body)).toBeTruthy();
    return res.body.id;
  }

  async function setIssueState(
    issueId: string,
    status: string,
    executionStateValue: Record<string, unknown> | null,
  ) {
    await db
      .update(issues)
      .set({
        status,
        assigneeAgentId: reviewerAgentId,
        ...(executionStateValue ? { executionState: executionStateValue } : {}),
      })
      .where(eq(issues.id, issueId));
  }

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-execution-review-");
    db = createDb(tempDb.connectionString);
    companyId = randomUUID();
    app = createApp(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Execution review tenant",
      issuePrefix: "EXR",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "cloud-user-1",
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await db.insert(agents).values([
      { id: executorAgentId, companyId, name: "Executor agent", status: "active" },
      { id: reviewerAgentId, companyId, name: "Reviewer agent", status: "active" },
    ]);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("exposes executionReview with the frozen executor for an in_review execution issue", async () => {
    const issueId = await createIssue();
    await setIssueState(issueId, "in_review", executionState());

    const res = await request(app).get(`/api/issues/${issueId}/heartbeat-context`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.issue.executionReview).toMatchObject({
      state: "pending",
      currentStageType: "review",
      currentParticipant: { type: "agent", agentId: reviewerAgentId },
      executorAgentId,
      lastDecisionOutcome: null,
      changesRequestedCount: 0,
    });
    expect(res.body.issue.executionReview.instruction).toContain("reviewer");
    expect(res.body.issue.executionReview.instruction).toContain("executor");
  });

  it("omits executionReview when an in_review issue has no execution state", async () => {
    const issueId = await createIssue();
    await setIssueState(issueId, "in_review", null);

    const res = await request(app).get(`/api/issues/${issueId}/heartbeat-context`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.issue.executionReview).toBeUndefined();
  });

  it("omits executionReview when the issue is not in review", async () => {
    const issueId = await createIssue();
    await setIssueState(issueId, "in_progress", executionState());

    const res = await request(app).get(`/api/issues/${issueId}/heartbeat-context`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.issue.executionReview).toBeUndefined();
  });

  it("omits executorAgentId when the return assignee is not an agent", async () => {
    const issueId = await createIssue();
    await setIssueState(
      issueId,
      "in_review",
      executionState({
        returnAssignee: { type: "user", userId: "cloud-user-1", agentId: null },
      }),
    );

    const res = await request(app).get(`/api/issues/${issueId}/heartbeat-context`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.issue.executionReview).toBeDefined();
    expect(res.body.issue.executionReview.executorAgentId).toBeNull();
  });
});
