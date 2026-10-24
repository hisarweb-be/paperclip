import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentRuntimeState,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { createPostgresDeferredWakeSweeper } from "../modules/wake-queue/adapters/postgres.js";
import type {
  LockedIssueExecution,
  ReleaseTransactionResult,
} from "../modules/wake-queue/application/ports.js";
import type {
  WakeQueueHost,
  WakeQueueTransaction,
} from "../modules/wake-queue/application/ports.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres deferred-wake sweep tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const NOW = new Date("2026-10-20T03:05:00.000Z");
const STALE_AFTER_MS = 2 * 60 * 1000;
/** Older than the stale threshold, so the pass is allowed to pick it up. */
const PARKED_AT = new Date(NOW.getTime() - 18 * 60 * 60 * 1000);
/** Inside the stale threshold: still a wake waiting behind a live run. */
const FRESH_AT = new Date(NOW.getTime() - 10 * 1000);

const RELEASED: ReleaseTransactionResult = {
  outcome: { kind: "released" },
  postCommitEffects: [],
};

/** The drain callback the sweeper hands the adapter; stubbed so the test owns what it returns. */
type DrainFn = (
  locked: LockedIssueExecution,
  ports: { host: WakeQueueHost; transaction: WakeQueueTransaction },
) => Promise<ReleaseTransactionResult>;

function releaseDrainMock() {
  return vi.fn<DrainFn>(async () => RELEASED);
}

describeEmbeddedPostgres("deferred wake sweeper", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId!: string;
  let agentId!: string;
  let issuePrefix!: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("deferred-wake-sweep-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  beforeEach(async () => {
    companyId = randomUUID();
    agentId = randomUUID();
    issuePrefix = `D${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Deferred Agent",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
  });

  afterEach(async () => {
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function sweeper() {
    return createPostgresDeferredWakeSweeper(db, {
      resolveResponsibleUserId: async () => null,
      getRoutineEnv: async () => null,
      resolveSessionBeforeForWakeup: async () => null,
    } as unknown as Parameters<typeof createPostgresDeferredWakeSweeper>[1]);
  }

  async function seedIssue(opts: {
    status?: string;
    executionRunId?: string | null;
    issueNumber?: number;
  } = {}) {
    const issueId = randomUUID();
    const issueNumber = opts.issueNumber ?? 1;
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Parked deferred wake",
      status: opts.status ?? "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: opts.executionRunId ?? null,
      issueNumber,
      identifier: `${issuePrefix}-${issueNumber}`,
    });
    return issueId;
  }

  async function seedRun(opts: {
    issueId: string;
    status: "succeeded" | "failed" | "running" | "queued" | "cancelled";
    finishedAt?: Date | null;
  }) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: opts.status,
      finishedAt: opts.finishedAt ?? (opts.status === "running" || opts.status === "queued" ? null : PARKED_AT),
      contextSnapshot: { issueId: opts.issueId, taskId: opts.issueId, wakeReason: "issue_assigned" },
    });
    return runId;
  }

  async function seedDeferredWake(opts: {
    issueId: string;
    requestedAt?: Date;
    requestedByActorType?: "agent" | "user" | "system";
    reason?: string;
  }) {
    const wakeId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeId,
      companyId,
      agentId,
      source: "assignment",
      reason: opts.reason ?? "issue_assigned",
      status: "deferred_issue_execution",
      requestedAt: opts.requestedAt ?? PARKED_AT,
      requestedByActorType: opts.requestedByActorType ?? "agent",
      requestedByActorId: agentId,
      payload: { issueId: opts.issueId },
    });
    return wakeId;
  }

  async function wakeRow(wakeId: string) {
    return db
      .select({
        status: agentWakeupRequests.status,
        runId: agentWakeupRequests.runId,
        finishedAt: agentWakeupRequests.finishedAt,
        error: agentWakeupRequests.error,
      })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeId))
      .then((rows) => rows[0] ?? null);
  }

  it("lists only issues whose parked wake is older than the stale threshold", async () => {
    const staleIssue = await seedIssue({ issueNumber: 1 });
    const freshIssue = await seedIssue({ issueNumber: 2 });
    await seedDeferredWake({ issueId: staleIssue, requestedAt: PARKED_AT });
    await seedDeferredWake({ issueId: freshIssue, requestedAt: FRESH_AT });

    const listed = await sweeper().listStaleDeferredWakeIssues({
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
      limit: 50,
    });

    expect(listed.map((row) => row.issueId)).toEqual([staleIssue]);
    expect(listed[0]).toMatchObject({ companyId, wakeCount: 1 });
  });

  it("groups per issue, oldest first, and respects the bounded limit", async () => {
    const oldest = await seedIssue({ issueNumber: 1 });
    const middle = await seedIssue({ issueNumber: 2 });
    const newest = await seedIssue({ issueNumber: 3 });
    await seedDeferredWake({ issueId: middle, requestedAt: new Date(PARKED_AT.getTime() + 60_000) });
    await seedDeferredWake({ issueId: middle, requestedAt: new Date(PARKED_AT.getTime() + 120_000) });
    await seedDeferredWake({ issueId: newest, requestedAt: new Date(PARKED_AT.getTime() + 180_000) });
    await seedDeferredWake({ issueId: oldest, requestedAt: PARKED_AT });

    const listed = await sweeper().listStaleDeferredWakeIssues({
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
      limit: 2,
    });

    expect(listed.map((row) => row.issueId)).toEqual([oldest, middle]);
    expect(listed[1]?.wakeCount).toBe(2);
  });

  it("drains a free issue and hands the drain the latest terminal run", async () => {
    const issueId = await seedIssue();
    const failedRunId = await seedRun({ issueId, status: "failed" });
    const latestRunId = await seedRun({
      issueId,
      status: "succeeded",
      finishedAt: new Date(PARKED_AT.getTime() + 1000),
    });
    await seedDeferredWake({ issueId });
    const drain = releaseDrainMock();

    const outcome = await sweeper().drainIssue({ companyId, issueId, now: NOW }, drain);

    expect(outcome).toMatchObject({ action: "drained" });
    expect(drain).toHaveBeenCalledTimes(1);
    const [locked] = drain.mock.calls[0]!;
    expect(locked.run.id).toBe(latestRunId);
    expect(locked.run.id).not.toBe(failedRunId);
    expect(locked.primaryIssue.id).toBe(issueId);
  });

  it("does not list a wake that is still inside the stale threshold", async () => {
    const issueId = await seedIssue();
    await seedRun({ issueId, status: "succeeded" });
    await seedDeferredWake({ issueId, requestedAt: FRESH_AT });

    const listed = await sweeper().listStaleDeferredWakeIssues({
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
      limit: 50,
    });

    expect(listed).toEqual([]);
  });

  it("skips while a run for the issue is still on the execution path", async () => {
    const issueId = await seedIssue();
    await seedRun({ issueId, status: "succeeded" });
    await seedRun({ issueId, status: "running" });
    await seedDeferredWake({ issueId });
    const drain = releaseDrainMock();

    const outcome = await sweeper().drainIssue({ companyId, issueId, now: NOW }, drain);

    expect(outcome).toEqual({ action: "skipped", reason: "live_execution_path" });
    expect(drain).not.toHaveBeenCalled();
  });

  it("skips while the issue lock still points at a live run", async () => {
    const issueId = await seedIssue();
    const lockRunId = await seedRun({ issueId, status: "queued" });
    await db.update(issues).set({ executionRunId: lockRunId }).where(eq(issues.id, issueId));
    await seedDeferredWake({ issueId });
    const drain = releaseDrainMock();

    const outcome = await sweeper().drainIssue({ companyId, issueId, now: NOW }, drain);

    expect(outcome).toEqual({ action: "skipped", reason: "live_execution_path" });
    expect(drain).not.toHaveBeenCalled();
  });

  it("cancels the parked wakes of a done issue with a reason and a finishedAt", async () => {
    const issueId = await seedIssue({ status: "done" });
    await seedRun({ issueId, status: "succeeded" });
    const wakeId = await seedDeferredWake({ issueId });
    const drain = releaseDrainMock();

    const outcome = await sweeper().drainIssue({ companyId, issueId, now: NOW }, drain);

    expect(outcome).toMatchObject({ action: "cancelled", wakeIds: [wakeId] });
    expect(drain).not.toHaveBeenCalled();
    expect(await wakeRow(wakeId)).toMatchObject({
      status: "cancelled",
      finishedAt: NOW,
      runId: null,
    });
    expect((await wakeRow(wakeId))?.error).toContain("no reopen authority");
  });

  it("leaves a done issue alone when a wake still carries reopen authority", async () => {
    const issueId = await seedIssue({ status: "done" });
    await seedRun({ issueId, status: "succeeded" });
    const userWakeId = await seedDeferredWake({ issueId, requestedByActorType: "user" });
    const agentWakeId = await seedDeferredWake({ issueId });

    const outcome = await sweeper().drainIssue({ companyId, issueId, now: NOW }, releaseDrainMock());

    expect(outcome).toEqual({ action: "skipped", reason: "terminal_issue" });
    expect((await wakeRow(userWakeId))?.status).toBe("deferred_issue_execution");
    expect((await wakeRow(agentWakeId))?.status).toBe("deferred_issue_execution");
  });

  it("skips a card that an open blocking dependency still gates", async () => {
    const issueId = await seedIssue();
    const blockerId = await seedIssue({ issueNumber: 2 });
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerId,
      relatedIssueId: issueId,
      type: "blocks",
    });
    await seedRun({ issueId, status: "succeeded" });
    await seedDeferredWake({ issueId });
    const drain = releaseDrainMock();

    const outcome = await sweeper().drainIssue({ companyId, issueId, now: NOW }, drain);

    expect(outcome).toEqual({ action: "skipped", reason: "dependency_blocked" });
    expect(drain).not.toHaveBeenCalled();
  });

  it("skips when another wake for the same issue is already in flight", async () => {
    const issueId = await seedIssue();
    await seedRun({ issueId, status: "succeeded" });
    await seedDeferredWake({ issueId });
    await db.insert(agentWakeupRequests).values({
      id: randomUUID(),
      companyId,
      agentId,
      source: "automation",
      reason: "issue_assigned",
      status: "queued",
      requestedAt: new Date(NOW.getTime() - 1000),
      payload: { issueId },
    });
    const drain = releaseDrainMock();

    const outcome = await sweeper().drainIssue({ companyId, issueId, now: NOW }, drain);

    expect(outcome).toEqual({ action: "skipped", reason: "other_wake_in_flight" });
    expect(drain).not.toHaveBeenCalled();
  });

  it("never promotes the same wake twice: a wake that left the deferred status is not drained again", async () => {
    const issueId = await seedIssue();
    await seedRun({ issueId, status: "succeeded" });
    const wakeId = await seedDeferredWake({ issueId });

    // First pass: the drain is reached, and the promotion it performs takes the
    // wake off the deferred status (this is the compare-and-set
    // `finalizePromotedWake` applies inside the real drain).
    const firstDrain = vi.fn(async () => {
      await db
        .update(agentWakeupRequests)
        .set({ status: "claimed", runId: randomUUID(), updatedAt: NOW })
        .where(eq(agentWakeupRequests.id, wakeId));
      return {
        outcome: { kind: "promoted", run: promotedRun() },
        postCommitEffects: [],
      } satisfies ReleaseTransactionResult;
    });
    expect(await sweeper().drainIssue({ companyId, issueId, now: NOW }, firstDrain))
      .toMatchObject({ action: "drained" });
    expect(firstDrain).toHaveBeenCalledTimes(1);

    // Second pass, as a concurrent delivery would see it: the queue holds no
    // deferred wake any more, so the drain is never reached again.
    const secondDrain = releaseDrainMock();
    expect(await sweeper().drainIssue({ companyId, issueId, now: NOW }, secondDrain))
      .toEqual({ action: "skipped", reason: "no_deferred_wakes" });
    expect(secondDrain).not.toHaveBeenCalled();
  });

  it("returns missing when the issue row is gone between the read and the lock", async () => {
    const drain = releaseDrainMock();
    const outcome = await sweeper().drainIssue(
      { companyId, issueId: randomUUID(), now: NOW },
      drain,
    );
    expect(outcome).toEqual({ action: "missing" });
    expect(drain).not.toHaveBeenCalled();
  });

  function promotedRun() {
    return {
      id: randomUUID(),
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      wakeupRequestId: null,
    };
  }
});
