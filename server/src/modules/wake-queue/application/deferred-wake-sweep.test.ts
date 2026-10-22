import { describe, expect, it, vi } from "vitest";
import {
  DEFERRED_WAKE_SWEEP_LIMIT,
  DEFERRED_WAKE_SWEEP_STALE_AFTER_MS,
  createSweepDeferredIssueExecutionWakes,
} from "./deferred-wake-sweep.js";
import type {
  DeferredWakeSweepIssue,
  DeferredWakeSweeper,
  DeferredWakeSweepIssueResult,
} from "./ports.js";
import type { PostCommitEffect, RunSummary } from "./types.js";

const NOW = new Date("2026-10-20T03:05:00.000Z");

function candidate(issueId: string, overrides: Partial<DeferredWakeSweepIssue> = {}): DeferredWakeSweepIssue {
  return {
    companyId: "company-1",
    issueId,
    wakeCount: 2,
    oldestRequestedAt: new Date("2026-10-19T08:49:35.563Z"),
    ...overrides,
  };
}

function promotedRun(id: string): RunSummary {
  return {
    id,
    companyId: "company-1",
    agentId: "agent-1",
    invocationSource: "assignment",
    triggerDetail: "system",
    wakeupRequestId: "wake-1",
  };
}

/**
 * A sweeper stub. `drainIssue` decides the per-issue outcome directly, because
 * the decision itself lives in the domain and the drain in `runReleaseDrain`;
 * this file only owes the pass's own bookkeeping.
 */
function sweeperStub(opts: {
  candidates?: DeferredWakeSweepIssue[];
  outcome?: (issueId: string) => DeferredWakeSweepIssueResult | Promise<DeferredWakeSweepIssueResult>;
} = {}) {
  const listStaleDeferredWakeIssues = vi.fn(async () => opts.candidates ?? []);
  const drainIssue = vi.fn(async (input: { issueId: string }) => {
    if (!opts.outcome) return { action: "missing" } as const;
    return opts.outcome(input.issueId);
  });
  return {
    sweeper: {
      listStaleDeferredWakeIssues,
      drainIssue,
    } as unknown as DeferredWakeSweeper,
    listStaleDeferredWakeIssues,
    drainIssue,
  };
}

describe("createSweepDeferredIssueExecutionWakes", () => {
  it("promotes a parked wake on a free issue and returns the drain's post-commit effects", async () => {
    const effect: PostCommitEffect = { kind: "run_queued", run: promotedRun("run-promoted") };
    const { sweeper } = sweeperStub({
      candidates: [candidate("issue-1")],
      outcome: () => ({
        action: "drained",
        outcome: { kind: "promoted", run: promotedRun("run-promoted") },
        postCommitEffects: [effect],
      }),
    });
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    const { result, postCommitEffects } = await pass({ now: NOW });

    expect(result).toMatchObject({
      scanned: 1,
      drained: 1,
      promoted: 1,
      cancelled: 0,
      skipped: 0,
      failed: 0,
      promotedRunIds: ["run-promoted"],
    });
    expect(postCommitEffects).toEqual([effect]);
  });

  it("skips an issue whose execution path is still live, without resuming anything", async () => {
    const { sweeper, drainIssue } = sweeperStub({
      candidates: [candidate("issue-1")],
      outcome: () => ({ action: "skipped", reason: "live_execution_path" }),
    });
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    const { result, postCommitEffects } = await pass({ now: NOW });

    expect(result).toMatchObject({
      scanned: 1,
      drained: 0,
      promoted: 0,
      skipped: 1,
      failed: 0,
      skipReasons: { live_execution_path: 1 },
    });
    expect(result.promotedRunIds).toEqual([]);
    // Exactly one attempt per issue per pass: a live path costs one read and
    // no second promotion attempt.
    expect(drainIssue).toHaveBeenCalledTimes(1);
    expect(postCommitEffects).toEqual([]);
  });

  it("cancels the parked wakes of a terminal issue and records their ids", async () => {
    const { sweeper } = sweeperStub({
      candidates: [candidate("issue-done")],
      outcome: () => ({
        action: "cancelled",
        wakeIds: ["wake-1", "wake-2"],
        reason: "deferred wake parked on a terminal task has no reopen authority",
      }),
    });
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    const { result } = await pass({ now: NOW });

    expect(result).toMatchObject({ cancelled: 2, promoted: 0, skipped: 0 });
    expect(result.cancelledWakeIds).toEqual(["wake-1", "wake-2"]);
  });

  it("counts a lost promotion race as no promotion, so a concurrent delivery cannot be doubled", async () => {
    // The wake was claimed between the candidate read and the drain; the drain
    // empties the queue without promoting. The pass must report zero promoted
    // run ids here, because the delivery that won already owns the run.
    const { sweeper, drainIssue } = sweeperStub({
      candidates: [candidate("issue-1")],
      outcome: () => ({
        action: "drained",
        outcome: { kind: "released" },
        postCommitEffects: [],
      }),
    });
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    const { result } = await pass({ now: NOW });

    expect(result).toMatchObject({ drained: 1, promoted: 0 });
    expect(result.promotedRunIds).toEqual([]);
    expect(drainIssue).toHaveBeenCalledTimes(1);
  });

  it("keeps sweeping after one issue fails and reports it in the counters", async () => {
    const { sweeper } = sweeperStub({
      candidates: [candidate("issue-broken"), candidate("issue-2")],
      outcome: (issueId) => {
        if (issueId === "issue-broken") throw new Error("lock timeout");
        return {
          action: "drained",
          outcome: { kind: "promoted", run: promotedRun("run-2") },
          postCommitEffects: [],
        };
      },
    });
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    const { result } = await pass({ now: NOW });

    expect(result).toMatchObject({ scanned: 2, failed: 1, promoted: 1 });
    expect(result.promotedRunIds).toEqual(["run-2"]);
  });

  it("counts an issue that disappeared between the read and the lock as missing", async () => {
    const { sweeper } = sweeperStub({
      candidates: [candidate("issue-gone")],
      outcome: () => ({ action: "missing" }),
    });
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    const { result } = await pass({ now: NOW });

    expect(result).toMatchObject({ scanned: 1, skipped: 1, failed: 0 });
    expect(result.skipReasons).toEqual({ issue_missing: 1 });
  });

  it("uses the stale threshold and bounded limit by default and forwards the override", async () => {
    const { sweeper, listStaleDeferredWakeIssues } = sweeperStub();
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    await pass({ now: NOW });
    expect(listStaleDeferredWakeIssues).toHaveBeenLastCalledWith({
      now: NOW,
      staleAfterMs: DEFERRED_WAKE_SWEEP_STALE_AFTER_MS,
      limit: DEFERRED_WAKE_SWEEP_LIMIT,
    });

    await pass({ now: NOW, staleAfterMs: 10_000, limit: 3 });
    expect(listStaleDeferredWakeIssues).toHaveBeenLastCalledWith({
      now: NOW,
      staleAfterMs: 10_000,
      limit: 3,
    });
  });

  it("scopes the pass to a company only when one is given", async () => {
    const { sweeper, listStaleDeferredWakeIssues } = sweeperStub();
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    await pass({ now: NOW });
    expect(listStaleDeferredWakeIssues).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ companyId: expect.anything() }),
    );

    await pass({ now: NOW, companyId: "company-7" });
    expect(listStaleDeferredWakeIssues).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: "company-7" }),
    );
  });

  it("does nothing at all when no issue holds a stale parked wake", async () => {
    const { sweeper, drainIssue } = sweeperStub({ candidates: [] });
    const pass = createSweepDeferredIssueExecutionWakes({ sweeper });

    const { result, postCommitEffects } = await pass({ now: NOW });

    expect(result).toMatchObject({ scanned: 0, drained: 0, promoted: 0, failed: 0 });
    expect(postCommitEffects).toEqual([]);
    expect(drainIssue).not.toHaveBeenCalled();
  });
});
