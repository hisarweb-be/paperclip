import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
const mockTrackAgentTaskRun = vi.hoisted(() => vi.fn());

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: () => mockTelemetryClient,
}));

vi.mock("@paperclipai/shared/telemetry", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/shared/telemetry")>(
    "@paperclipai/shared/telemetry",
  );
  return {
    ...actual,
    trackAgentTaskRun: mockTrackAgentTaskRun,
  };
});

import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat lock-release-on-reassignment tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat lock release on cross-agent reassignment", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-lock-release-on-reassignment-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 60_000);

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCrossAgentScenario(opts: {
    holderStatus: "queued" | "running";
    /**
     * Seed the state the assignee PATCH leaves behind when it hands a
     * started run over (HIS-3492/HIS-3599): the execution lock fields are
     * cleared while the old owner's started run keeps executing with the
     * issue in its context snapshot. Deferral then has to find the holder
     * through the legacy fallback instead of `issues.executionRunId`.
     */
    postPatchHandover?: boolean;
  }) {
    const companyId = randomUUID();
    const coderAgentId = randomUUID();
    const reviewerAgentId = randomUUID();
    const issueId = randomUUID();
    const holderRunId = randomUUID();
    const wakeupRequestId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });

    await db.insert(agents).values([
      {
        id: coderAgentId,
        companyId,
        name: "Coder",
        role: "engineer",
        status: "idle",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: reviewerAgentId,
        companyId,
        name: "Reviewer",
        role: "engineer",
        status: "idle",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId: coderAgentId,
      source: "assignment",
      status: "queued",
    });

    await db.insert(heartbeatRuns).values({
      id: holderRunId,
      companyId,
      agentId: coderAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: opts.holderStatus,
      wakeupRequestId,
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      ...(opts.postPatchHandover ? { startedAt: new Date() } : {}),
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Cross-agent reassignment race",
      status: "in_review",
      priority: "medium",
      assigneeAgentId: reviewerAgentId,
      ...(opts.postPatchHandover
        ? {}
        : {
            executionRunId: holderRunId,
            executionAgentNameKey: "coder",
            executionLockedAt: new Date(),
          }),
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    return {
      companyId,
      coderAgentId,
      reviewerAgentId,
      issueId,
      holderRunId,
      wakeupRequestId,
    };
  }

  it("defers a cross-agent wake while the holder is still running and leaves the holder alone", async () => {
    const { coderAgentId, reviewerAgentId, issueId, holderRunId, wakeupRequestId } =
      await seedCrossAgentScenario({ holderStatus: "running" });

    const heartbeat = heartbeatService(db);
    const followupRun = await heartbeat.wakeup(reviewerAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });

    expect(followupRun).toBeNull();

    const holder = await db
      .select({
        status: heartbeatRuns.status,
        errorCode: heartbeatRuns.errorCode,
        agentId: heartbeatRuns.agentId,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, holderRunId))
      .then((rows) => rows[0] ?? null);

    expect(holder?.status).toBe("running");
    expect(holder?.errorCode).toBeNull();
    expect(holder?.finishedAt).toBeNull();
    expect(holder?.agentId).toBe(coderAgentId);

    const heldWakeup = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeupRequestId))
      .then((rows) => rows[0] ?? null);

    expect(heldWakeup?.status).toBe("queued");

    const deferred = await db
      .select({ status: agentWakeupRequests.status, agentId: agentWakeupRequests.agentId })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.agentId, reviewerAgentId),
          eq(agentWakeupRequests.status, "deferred_issue_execution"),
        ),
      )
      .then((rows) => rows[0] ?? null);

    expect(deferred).not.toBeNull();

    const issue = await db
      .select({ executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    expect(issue?.executionRunId).toBe(holderRunId);
  });

  // Race-guard regression: the cancel UPDATE for the queued holder is pinned
  // to the exact non-running status that was read just above it. If a worker
  // races in and flips the holder from `queued` → `running` between that
  // SELECT and the cancel UPDATE, the status predicate in the WHERE clause
  // must guarantee zero rows are clobbered. We simulate the race by
  // pre-running the same UPDATE shape against a row that is already
  // `running` (the snapshot we would have read was `queued`); the row must
  // remain untouched, no wake-request cascade fires, and the lock stays
  // owned by the freshly-claimed running holder.
  it("guards the cancel UPDATE WHERE clause against a concurrent claim flip to running", async () => {
    const { coderAgentId, issueId, holderRunId, wakeupRequestId } = await seedCrossAgentScenario({
      holderStatus: "queued",
    });

    const snapshotStatus = "queued" as const;

    // Concurrent worker claims the queued run after the SELECT but before
    // the cancel UPDATE. In production this is a separate transaction
    // flipping the row from queued → running.
    await db
      .update(heartbeatRuns)
      .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(heartbeatRuns.id, holderRunId));

    const cancelled = await db
      .update(heartbeatRuns)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
        error: "Execution lock released after issue reassigned to a different agent",
        errorCode: "lock_released_on_reassignment",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(heartbeatRuns.id, holderRunId),
          eq(heartbeatRuns.status, snapshotStatus),
        ),
      )
      .returning({ id: heartbeatRuns.id });

    expect(cancelled).toHaveLength(0);

    const holder = await db
      .select({
        status: heartbeatRuns.status,
        errorCode: heartbeatRuns.errorCode,
        agentId: heartbeatRuns.agentId,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, holderRunId))
      .then((rows) => rows[0] ?? null);

    expect(holder?.status).toBe("running");
    expect(holder?.errorCode).toBeNull();
    expect(holder?.finishedAt).toBeNull();
    expect(holder?.agentId).toBe(coderAgentId);

    const heldWakeup = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeupRequestId))
      .then((rows) => rows[0] ?? null);
    expect(heldWakeup?.status).toBe("queued");

    const issue = await db
      .select({ executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    expect(issue?.executionRunId).toBe(holderRunId);
  });

  it("cancels a queued holder's run on reassignment and emits agent.task_run for it", async () => {
    const { companyId, coderAgentId, reviewerAgentId, issueId, holderRunId } =
      await seedCrossAgentScenario({ holderStatus: "queued" });

    // Keep the reviewer's queue from auto-claiming/executing the new run
    // during this unit test, matching the pattern used for the sibling
    // reassignment scenario in heartbeat-retry-scheduling.test.ts: cap
    // concurrency at 1, then occupy that one slot with a busy run.
    await db
      .update(agents)
      .set({
        runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      })
      .where(eq(agents.id, reviewerAgentId));
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId,
      agentId: reviewerAgentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: { wakeReason: "test_busy_slot" },
      startedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);
    const newAssigneeRun = await heartbeat.wakeup(reviewerAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });

    expect(newAssigneeRun).not.toBeNull();
    expect(newAssigneeRun?.agentId).toBe(reviewerAgentId);
    expect(newAssigneeRun?.status).toBe("queued");

    const holder = await db
      .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, holderRunId))
      .then((rows) => rows[0] ?? null);

    expect(holder).toEqual({
      status: "cancelled",
      errorCode: "lock_released_on_reassignment",
    });

    // The cancel runs inside enqueueWakeup's transaction, and the run's own
    // required lifecycle work never awaits the telemetry emission, so wait
    // for it here instead of asserting it fired synchronously.
    await vi.waitFor(() => {
      expect(mockTrackAgentTaskRun).toHaveBeenCalledWith(
        mockTelemetryClient,
        expect.objectContaining({
          agentId: coderAgentId,
          state: "cancelled",
        }),
      );
    });
  });

  // HIS-3599 acceptance criterion 2: the assignee PATCH clears the execution
  // lock fields (issues.executionRunId = null) while the handed-over run of
  // the old owner keeps executing with the issue in its context snapshot.
  // The new owner's `issue_assigned` wake must then defer through the legacy
  // fallback (contextSnapshot lookup): no run while the holder is still
  // running, and exactly one run once the holder has finished its turn.
  it("parks the new owner's wake via the legacy fallback and grants exactly one run after the handed-over holder finishes", async () => {
    const { companyId, reviewerAgentId, issueId, holderRunId } =
      await seedCrossAgentScenario({
        holderStatus: "running",
        postPatchHandover: true,
      });

    // Keep the reviewer's queue from auto-claiming/executing the granted run
    // during this test (same pattern as the queued-holder scenario above).
    await db
      .update(agents)
      .set({
        runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      })
      .where(eq(agents.id, reviewerAgentId));
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId,
      agentId: reviewerAgentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: { wakeReason: "test_busy_slot" },
      startedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);

    const reviewerRunsOnIssue = () =>
      db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.agentId, reviewerAgentId),
            sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
          ),
        );

    // (a) Vóór lock-vrijgave: geen run voor de nieuwe eigenaar.
    const blocked = await heartbeat.wakeup(reviewerAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });

    expect(blocked).toBeNull();
    expect(await reviewerRunsOnIssue()).toHaveLength(0);

    const deferred = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.agentId, reviewerAgentId),
          eq(agentWakeupRequests.status, "deferred_issue_execution"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    expect(deferred).not.toBeNull();

    // The handover must leave the started holder alone: still running, no
    // error, not finished.
    const holderDuringHold = await db
      .select({
        status: heartbeatRuns.status,
        errorCode: heartbeatRuns.errorCode,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, holderRunId))
      .then((rows) => rows[0] ?? null);
    expect(holderDuringHold?.status).toBe("running");
    expect(holderDuringHold?.errorCode).toBeNull();
    expect(holderDuringHold?.finishedAt).toBeNull();

    // The deferral ran through the legacy fallback: the lock the PATCH
    // cleared is re-stamped onto the holder found via contextSnapshot.
    const restamped = await db
      .select({ executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(restamped?.executionRunId).toBe(holderRunId);

    // (b) Na lock-vrijgave: precies één run voor de nieuwe eigenaar. The
    // handed-over run finished its turn; the continuation gate refused the
    // next one because the assignee changed, so the execution lock is free.
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded", finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(heartbeatRuns.id, holderRunId));
    await db
      .update(issues)
      .set({ executionRunId: null, executionLockedAt: null, updatedAt: new Date() })
      .where(eq(issues.id, issueId));

    const granted = await heartbeat.wakeup(reviewerAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });

    expect(granted).not.toBeNull();
    expect(granted?.agentId).toBe(reviewerAgentId);

    const reviewerRunsAfter = await reviewerRunsOnIssue();
    expect(reviewerRunsAfter).toHaveLength(1);
    expect(reviewerRunsAfter[0]?.id).toBe(granted?.id);
  });

  // Regression: the queued holder cancelled on reassignment is terminal
  // without ever running, so its finalization-side release drain never fires.
  // A wake that was parked in `deferred_issue_execution` behind that holder's
  // lock must not stay parked: the reassignment path has to run the release
  // drain itself and promote (or retire) the parked wake.
  it("promotes a wake parked in deferred_issue_execution when the queued holder's lock is released on reassignment", async () => {
    const { companyId, coderAgentId, reviewerAgentId, issueId, holderRunId } =
      await seedCrossAgentScenario({ holderStatus: "queued" });

    // Third agent whose wake was parked behind the holder's lock before the
    // reassignment happened.
    const thirdAgentId = randomUUID();
    await db.insert(agents).values({
      id: thirdAgentId,
      companyId,
      name: "Planner",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const deferredWakeId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: deferredWakeId,
      companyId,
      agentId: thirdAgentId,
      source: "automation",
      triggerDetail: "system",
      reason: "issue_assigned",
      status: "deferred_issue_execution",
      requestedByActorType: "user",
      requestedByActorId: "local-board",
      payload: {
        issueId,
        _paperclipWakeContext: {
          issueId,
          taskId: issueId,
          wakeReason: "issue_assigned",
        },
      },
    });

    // Keep both agents' queues from auto-claiming the newly queued runs during
    // this unit test: cap concurrency at 1 and occupy that one slot each, so
    // the assertions below see the queue state and not a finished run.
    await db
      .update(agents)
      .set({ runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } })
      .where(inArray(agents.id, [reviewerAgentId, thirdAgentId]));
    await db.insert(heartbeatRuns).values([
      {
        id: randomUUID(),
        companyId,
        agentId: reviewerAgentId,
        invocationSource: "automation",
        triggerDetail: "system",
        status: "running",
        contextSnapshot: { wakeReason: "test_busy_slot" },
        startedAt: new Date(),
      },
      {
        id: randomUUID(),
        companyId,
        agentId: thirdAgentId,
        invocationSource: "automation",
        triggerDetail: "system",
        status: "running",
        contextSnapshot: { wakeReason: "test_busy_slot" },
        startedAt: new Date(),
      },
    ]);

    const heartbeat = heartbeatService(db);
    await heartbeat.wakeup(reviewerAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "user",
      requestedByActorId: "local-board",
    });

    const holder = await db
      .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, holderRunId))
      .then((rows) => rows[0] ?? null);
    expect(holder).toEqual({
      status: "cancelled",
      errorCode: "lock_released_on_reassignment",
    });

    const parkedWake = await db
      .select({
        status: agentWakeupRequests.status,
        runId: agentWakeupRequests.runId,
        finishedAt: agentWakeupRequests.finishedAt,
      })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, deferredWakeId))
      .then((rows) => rows[0] ?? null);

    // Promoted or retired, but never left parked on the deferred status.
    expect(parkedWake?.status).not.toBe("deferred_issue_execution");
    expect(parkedWake?.runId ?? parkedWake?.finishedAt).not.toBeNull();

    const thirdAgentRuns = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, thirdAgentId));

    const promotedRuns = thirdAgentRuns.filter(
      (run) => (run.contextSnapshot as { issueId?: string } | null)?.issueId === issueId,
    );
    expect(promotedRuns).toHaveLength(1);
    expect(parkedWake?.runId).toBe(promotedRuns[0]!.id);
    expect(promotedRuns[0]!.status).toBe("queued");

    // The drain promotes at most one wake and must not start a second
    // enqueue cycle: the holder stays cancelled and no extra coder run exists.
    const coderRuns = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, coderAgentId));
    expect(coderRuns).toHaveLength(1);
    expect(coderRuns[0]!.status).toBe("cancelled");
  });
});
