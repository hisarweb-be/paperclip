import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Queue ageing test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres queue ageing tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fn();
}

describeEmbeddedPostgres("heartbeat queued run ageing", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousAgeUpMin = process.env.PAPERCLIP_QUEUE_AGE_UP_MIN;

  beforeAll(async () => {
    // One minute per class step keeps the fixtures readable: a run that waited
    // five minutes is five classes older.
    process.env.PAPERCLIP_QUEUE_AGE_UP_MIN = "1";
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-queue-ageing-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 30_000);

  afterEach(async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runs = await db.select({ status: heartbeatRuns.status, id: heartbeatRuns.id }).from(heartbeatRuns);
      if (!runs.some((run) => run.status === "queued" || run.status === "running")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const runIds = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .then((runs) => runs.map((run) => run.id));
    await Promise.all(runIds.map((runId) => heartbeat.waitForRunExecutionDrain(runId)));
    mockAdapterExecute.mockReset();
    mockAdapterExecute.mockImplementation(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      summary: "Queue ageing test run.",
      provider: "test",
      model: "test-model",
    }));
    runningProcesses.clear();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await db.delete(environmentLeases).catch(() => undefined);
    await db.delete(companySkills);
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        // Company skill seeding can still be in flight right after the insert,
        // so clear both tables inside the retry.
        await db.delete(companySkills);
        await db.delete(companies);
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  afterAll(async () => {
    if (previousAgeUpMin === undefined) {
      delete process.env.PAPERCLIP_QUEUE_AGE_UP_MIN;
    } else {
      process.env.PAPERCLIP_QUEUE_AGE_UP_MIN = previousAgeUpMin;
    }
    await tempDb?.cleanup();
  });

  async function seedAgent(maxConcurrentRuns = 1) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "QueueAgeingAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          wakeOnDemand: true,
          maxConcurrentRuns,
        },
      },
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function insertQueuedRun(input: {
    companyId: string;
    agentId: string;
    issueId: string;
    createdAt: Date;
    reason?: string;
  }) {
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId: input.companyId,
      agentId: input.agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: input.reason ?? "issue_assigned",
      payload: { issueId: input.issueId },
      status: "queued",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: input.reason ?? "assignment",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId,
      createdAt: input.createdAt,
      contextSnapshot: {
        issueId: input.issueId,
        wakeReason: input.reason ?? "issue_assigned",
      },
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
    return runId;
  }

  async function readRun(runId: string) {
    return db
      .select({
        status: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  it("lets a waiting todo run overtake newer in_progress work once it ages up", async () => {
    const { companyId, agentId } = await seedAgent();
    const todoIssueId = randomUUID();
    const inProgressIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: todoIssueId,
        companyId,
        title: "Long waiting todo card",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
      },
      {
        id: inProgressIssueId,
        companyId,
        title: "Fresh in progress card",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
      },
    ]);

    const now = Date.now();
    // Five classes of ageing against a fresh rank-0 wake: the todo run must win.
    const todoRunId = await insertQueuedRun({
      companyId,
      agentId,
      issueId: todoIssueId,
      createdAt: new Date(now - 5 * 60_000),
    });
    const inProgressRunId = await insertQueuedRun({
      companyId,
      agentId,
      issueId: inProgressIssueId,
      createdAt: new Date(now - 1_000),
    });

    await heartbeat.resumeQueuedRuns();

    const todoRunStarted = await waitForCondition(async () => (await readRun(todoRunId))?.startedAt != null);
    expect(todoRunStarted).toBe(true);
    const inProgressRun = await readRun(inProgressRunId);
    expect(inProgressRun?.startedAt ?? null).toBeNull();
    expect(inProgressRun?.status).toBe("queued");
  }, 40_000);

  it("keeps in_progress work first while the todo run is still inside AGE_UP_MIN", async () => {
    const { companyId, agentId } = await seedAgent();
    const todoIssueId = randomUUID();
    const inProgressIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: todoIssueId,
        companyId,
        title: "Young todo card",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
      },
      {
        id: inProgressIssueId,
        companyId,
        title: "Fresh in progress card",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
      },
    ]);

    const now = Date.now();
    // Both younger than one age-up interval: the class rank must still decide.
    const todoRunId = await insertQueuedRun({
      companyId,
      agentId,
      issueId: todoIssueId,
      createdAt: new Date(now - 20_000),
    });
    const inProgressRunId = await insertQueuedRun({
      companyId,
      agentId,
      issueId: inProgressIssueId,
      createdAt: new Date(now - 10_000),
    });

    await heartbeat.resumeQueuedRuns();

    const inProgressRunStarted = await waitForCondition(
      async () => (await readRun(inProgressRunId))?.startedAt != null,
    );
    expect(inProgressRunStarted).toBe(true);
    const todoRun = await readRun(todoRunId);
    expect(todoRun?.startedAt ?? null).toBeNull();
    expect(todoRun?.status).toBe("queued");
  }, 40_000);

  it("never ages a dependency-blocked run past ready work", async () => {
    const { companyId, agentId } = await seedAgent();
    const blockerId = randomUUID();
    const blockedIssueId = randomUUID();
    const readyIssueId = randomUUID();
    const inProgressIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: blockerId,
        companyId,
        title: "Unresolved blocker",
        status: "in_progress",
        priority: "high",
        responsibleUserId: "responsible-user",
      },
      {
        id: blockedIssueId,
        companyId,
        title: "Blocked card waiting for a day",
        status: "blocked",
        priority: "medium",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
      },
      {
        id: readyIssueId,
        companyId,
        title: "Ready todo card",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
      },
      {
        id: inProgressIssueId,
        companyId,
        title: "Fresh in progress card",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        responsibleUserId: "responsible-user",
      },
    ]);
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerId,
      relatedIssueId: blockedIssueId,
      type: "blocks",
    });

    const now = Date.now();
    const blockedRunId = await insertQueuedRun({
      companyId,
      agentId,
      issueId: blockedIssueId,
      createdAt: new Date(now - 24 * 60 * 60_000),
    });
    const readyRunId = await insertQueuedRun({
      companyId,
      agentId,
      issueId: readyIssueId,
      createdAt: new Date(now - 30_000),
    });
    const inProgressRunId = await insertQueuedRun({
      companyId,
      agentId,
      issueId: inProgressIssueId,
      createdAt: new Date(now - 1_000),
    });

    await heartbeat.resumeQueuedRuns();

    const inProgressRunStarted = await waitForCondition(
      async () => (await readRun(inProgressRunId))?.startedAt != null,
    );
    expect(inProgressRunStarted).toBe(true);
    const blockedRun = await readRun(blockedRunId);
    expect(blockedRun?.startedAt ?? null).toBeNull();
    expect(blockedRun?.status).not.toBe("running");
    const readyRun = await readRun(readyRunId);
    expect(readyRun?.startedAt ?? null).toBeNull();
  }, 40_000);
});
