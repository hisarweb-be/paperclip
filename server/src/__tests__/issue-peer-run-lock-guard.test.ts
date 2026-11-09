import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";
import { runHoldsIssueLock } from "../services/issue-run-lock.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const issueRef = { id: "i1", companyId: "c1", executionRunId: "r1" };
const baseRun = {
  id: "r1",
  companyId: "c1",
  runtimeMode: "legacy",
  status: "running",
  contextSnapshot: { issueId: "i1" },
  nativeIssueId: null,
  resultJson: null,
};

function run(overrides: Record<string, unknown>) {
  return { ...baseRun, ...overrides } as unknown as Parameters<typeof runHoldsIssueLock>[1];
}

describe("runHoldsIssueLock", () => {
  it.each(["queued", "running", "scheduled_retry"])("holds while the run is %s", (status) => {
    expect(runHoldsIssueLock(issueRef, run({ status }))).toBe(true);
  });

  it.each(["succeeded", "failed", "cancelled", "timed_out"])("does not hold for a plain %s run", (status) => {
    expect(runHoldsIssueLock(issueRef, run({ status }))).toBe(false);
  });

  it("does not hold without a run", () => {
    expect(runHoldsIssueLock(issueRef, null)).toBe(false);
  });

  it("holds for an explicit continuation retry claim", () => {
    expect(
      runHoldsIssueLock(
        issueRef,
        run({ status: "failed", contextSnapshot: { issueId: "i1", explicitUserContinuation: true } }),
      ),
    ).toBe(true);
  });

  it("holds for an acknowledged native Stop", () => {
    expect(
      runHoldsIssueLock(
        issueRef,
        run({
          status: "cancelled",
          nativeIssueId: "i1",
          resultJson: {
            cancelledByActorType: "user",
            cancelledByUserId: "u1",
            nativeCancellation: {
              schema: "paperclip.native-cancellation.v1",
              runId: "r1",
              companyId: "c1",
              issueId: "i1",
              scope: "run",
              reasonCode: "cancellation_run_only",
              dispatchState: "acknowledged",
              dispatched: true,
              intentAuditId: "a1",
              acknowledgementAuditId: "a2",
            },
          },
        }),
      ),
    ).toBe(true);
  });
});

describeEmbeddedPostgres("issueService.update peerRunLockGuard", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed(runFields: Record<string, unknown>) {
    tempDb ??= await startEmbeddedPostgresTestDatabase("paperclip-peer-run-lock-");
    const db = createDb(tempDb.connectionString);
    const companyId = randomUUID();
    const ownerId = randomUUID();
    const peerId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${randomUUID().replace(/[^a-f]/g, "").slice(0, 4).toUpperCase().padEnd(4, "X")}`,
      requireBoardApprovalForNewAgents: false,
    });
    for (const [id, name] of [[ownerId, "Owner"], [peerId, "Peer"]] as const) {
      await db.insert(agents).values({
        id,
        companyId,
        name,
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
    }
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Locked",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: ownerId,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId: ownerId,
      ...runFields,
    } as never);
    return { db, issueId, ownerId, peerId, runId };
  }

  // The owner acquires the issue after the route's first check: the claim is
  // written directly, as the lock holder would, before the guarded write lands.
  async function claim(db: ReturnType<typeof createDb>, issueId: string, runId: string) {
    await db.update(issues).set({ checkoutRunId: runId, executionRunId: runId }).where(eq(issues.id, issueId));
  }

  it("rejects a guarded peer write once the owner holds a live run claim", async () => {
    const { db, issueId, peerId, runId } = await seed({ status: "running" });
    await claim(db, issueId, runId);
    await expect(
      issueService(db).update(issueId, { status: "todo", actorAgentId: peerId, peerRunLockGuard: true }),
    ).rejects.toMatchObject({ details: { code: "issue_write_assignee_run_lock" } });
    const row = await db.select().from(issues).where(eq(issues.id, issueId)).then((rows) => rows[0]);
    expect(row).toMatchObject({ status: "in_progress", checkoutRunId: runId, executionRunId: runId });
  }, 30_000);

  it("lets an unguarded write through", async () => {
    const { db, issueId, peerId, runId } = await seed({ status: "running" });
    await claim(db, issueId, runId);
    const updated = await issueService(db).update(issueId, { status: "todo", actorAgentId: peerId });
    expect(updated?.status).toBe("todo");
  }, 30_000);

  it("lets a guarded peer write through when the run is terminal", async () => {
    const { db, issueId, peerId, runId } = await seed({ status: "succeeded" });
    await claim(db, issueId, runId);
    const updated = await issueService(db).update(issueId, {
      status: "todo",
      actorAgentId: peerId,
      peerRunLockGuard: true,
    });
    expect(updated?.status).toBe("todo");
  }, 30_000);

  it("rejects a guarded peer write under an explicit continuation retry claim", async () => {
    const { db, issueId, peerId, runId } = await seed({ status: "failed", runtimeMode: "legacy" });
    await db
      .update(heartbeatRuns)
      .set({ contextSnapshot: { issueId, explicitUserContinuation: true } })
      .where(eq(heartbeatRuns.id, runId));
    await claim(db, issueId, runId);
    await expect(
      issueService(db).update(issueId, { status: "todo", actorAgentId: peerId, peerRunLockGuard: true }),
    ).rejects.toMatchObject({ details: { code: "issue_write_assignee_run_lock" } });
  }, 30_000);

  it("lets the assignee write with the guard set", async () => {
    const { db, issueId, ownerId, runId } = await seed({ status: "running" });
    await claim(db, issueId, runId);
    const updated = await issueService(db).update(issueId, {
      title: "Renamed",
      actorAgentId: ownerId,
      peerRunLockGuard: true,
    });
    expect(updated?.title).toBe("Renamed");
  }, 30_000);
});
