import { describe, expect, it } from "vitest";
import {
  DEFERRED_WAKE_SWEEP_TERMINAL_ISSUE_CANCEL_REASON,
  decideDeferredWakeSweep,
  isOperatorCancelledWakeSource,
  type DeferredWakeSweepFacts,
} from "./deferred-wake-sweep.js";

const t0 = new Date("2026-10-19T08:49:35.563Z");
const t1 = new Date("2026-10-19T08:52:42.657Z");

function facts(overrides: Partial<DeferredWakeSweepFacts> = {}): DeferredWakeSweepFacts {
  return {
    issueStatus: "in_progress",
    liveRunId: null,
    liveLockRunId: null,
    latestRun: { id: "run-1", status: "succeeded", finishedAt: t0 },
    latestRunOperatorCancelled: false,
    inFlightWakeCount: 0,
    dependencyBlocked: false,
    deferredWakes: [
      { id: "wake-1", requestedAt: t0, canReopenTerminalIssue: false },
      { id: "wake-2", requestedAt: t1, canReopenTerminalIssue: false },
    ],
    ...overrides,
  };
}

describe("decideDeferredWakeSweep", () => {
  it("drains every parked wake when the issue has no live execution path", () => {
    expect(decideDeferredWakeSweep(facts())).toEqual({
      kind: "drain",
      wakeIds: ["wake-1", "wake-2"],
    });
  });

  it("does nothing when the issue holds no deferred wakes", () => {
    expect(decideDeferredWakeSweep(facts({ deferredWakes: [] }))).toEqual({
      kind: "skip",
      reason: "no_deferred_wakes",
    });
  });

  it("skips while a run for the issue is still on the execution path", () => {
    expect(decideDeferredWakeSweep(facts({ liveRunId: "run-live" }))).toEqual({
      kind: "skip",
      reason: "live_execution_path",
    });
  });

  it("skips while a live lock still points at a running owner", () => {
    expect(decideDeferredWakeSweep(facts({ liveLockRunId: "run-owner" }))).toEqual({
      kind: "skip",
      reason: "live_execution_path",
    });
  });

  it("skips when another wake for the same issue is already in flight", () => {
    expect(decideDeferredWakeSweep(facts({ inFlightWakeCount: 1 }))).toEqual({
      kind: "skip",
      reason: "other_wake_in_flight",
    });
  });

  it("skips when the issue is blocked by dependencies", () => {
    expect(decideDeferredWakeSweep(facts({ issueStatus: "blocked", dependencyBlocked: true }))).toEqual({
      kind: "skip",
      reason: "dependency_blocked",
    });
  });

  it("skips when no finished run can be replayed", () => {
    expect(decideDeferredWakeSweep(facts({ latestRun: null }))).toEqual({
      kind: "skip",
      reason: "no_finishing_run",
    });
  });

  it("skips after an operator cancelled the last run", () => {
    expect(
      decideDeferredWakeSweep(
        facts({
          latestRun: { id: "run-1", status: "cancelled", finishedAt: t1 },
          latestRunOperatorCancelled: true,
        }),
      ),
    ).toEqual({ kind: "skip", reason: "operator_cancelled" });
  });

  it("drains again when a wake arrived after the operator cancelled the run", () => {
    const later = new Date(t1.getTime() + 60_000);
    expect(
      decideDeferredWakeSweep(
        facts({
          latestRun: { id: "run-1", status: "cancelled", finishedAt: t1 },
          latestRunOperatorCancelled: true,
          deferredWakes: [{ id: "wake-1", requestedAt: later, canReopenTerminalIssue: false }],
        }),
      ),
    ).toEqual({ kind: "drain", wakeIds: ["wake-1"] });
  });

  it("cancels the parked wakes of a completed issue instead of resurrecting it", () => {
    for (const issueStatus of ["done", "cancelled"]) {
      expect(decideDeferredWakeSweep(facts({ issueStatus }))).toEqual({
        kind: "cancel",
        wakeIds: ["wake-1", "wake-2"],
        reason: DEFERRED_WAKE_SWEEP_TERMINAL_ISSUE_CANCEL_REASON,
      });
    }
  });

  it("leaves the wakes of a completed issue alone when one may reopen it", () => {
    expect(
      decideDeferredWakeSweep(
        facts({
          issueStatus: "done",
          deferredWakes: [
            { id: "wake-1", requestedAt: t0, canReopenTerminalIssue: false },
            { id: "wake-2", requestedAt: t1, canReopenTerminalIssue: true },
          ],
        }),
      ),
    ).toEqual({ kind: "skip", reason: "terminal_issue" });
  });
});

describe("isOperatorCancelledWakeSource", () => {
  it("recognises an operator interrupt", () => {
    expect(
      isOperatorCancelledWakeSource({
        status: "cancelled",
        errorCode: "operator_interrupted",
        resultJson: null,
      }),
    ).toBe(true);
  });

  it("recognises a user or board cancellation in the run result", () => {
    expect(
      isOperatorCancelledWakeSource({
        status: "cancelled",
        errorCode: null,
        resultJson: { cancelledByActorType: "board" },
      }),
    ).toBe(true);
  });

  it("does not treat a system cancellation or a non-cancelled run as operator intent", () => {
    expect(
      isOperatorCancelledWakeSource({
        status: "cancelled",
        errorCode: null,
        resultJson: { cancelledByActorType: "system" },
      }),
    ).toBe(false);
    expect(
      isOperatorCancelledWakeSource({
        status: "succeeded",
        errorCode: "operator_interrupted",
        resultJson: null,
      }),
    ).toBe(false);
  });
});
