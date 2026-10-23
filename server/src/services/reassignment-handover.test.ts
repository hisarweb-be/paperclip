import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REASSIGNMENT_HANDOVER_BACKSTOP_MS,
  enforceReassignmentHandoverBackstop,
  reassignmentRunDisposition,
  scheduleReassignmentHandoverBackstop,
  type ReassignmentHandoverBackstopDeps,
} from "./reassignment-handover.js";

function makeDeps(input: {
  status?: string | null;
  cancelStatus?: string | null;
} = {}) {
  const run = input.status === null ? null : { id: "run-1", status: input.status ?? "running" };
  const cancelled =
    input.cancelStatus === null
      ? null
      : { id: "run-1", status: input.cancelStatus ?? "cancelled" };
  const getRun = vi.fn(async () => run);
  const cancelRun = vi.fn(async () => cancelled);
  return { deps: { getRun, cancelRun } as ReassignmentHandoverBackstopDeps, getRun, cancelRun };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("reassignment handover backstop", () => {
  it("keeps a run that already stopped instead of cancelling it", async () => {
    const { deps, cancelRun } = makeDeps({ status: "completed" });

    const result = await enforceReassignmentHandoverBackstop(deps, {
      runId: "run-1",
      issueId: "issue-1",
    });

    expect(result.outcome).toBe("run_finished");
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("does nothing when the run is gone", async () => {
    const { deps, cancelRun } = makeDeps({ status: null });

    const result = await enforceReassignmentHandoverBackstop(deps, {
      runId: "run-1",
      issueId: "issue-1",
    });

    expect(result.outcome).toBe("run_missing");
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("cancels a still running handover as a forced reassignment stop", async () => {
    const { deps, cancelRun } = makeDeps({ status: "running" });

    const result = await enforceReassignmentHandoverBackstop(deps, {
      runId: "run-1",
      issueId: "issue-1",
    });

    expect(result.outcome).toBe("forced_cancel");
    expect(cancelRun).toHaveBeenCalledTimes(1);
    const [runId, reason, options] = cancelRun.mock.calls[0] as unknown as [
      string,
      string,
      { errorCode: string; resultJson: Record<string, unknown>; eventPayload: Record<string, unknown> },
    ];
    expect(runId).toBe("run-1");
    expect(reason).toContain("backstop");
    expect(options.errorCode).toBe("issue_reassigned");
    expect(options.resultJson).toEqual({ reassignmentStopConfirmed: true, forced: true });
    expect(options.eventPayload).toEqual({ issueId: "issue-1", forced: true });
  });

  it("reports an unconfirmed cancellation instead of claiming the run stopped", async () => {
    const { deps } = makeDeps({ status: "running", cancelStatus: "running" });

    const result = await enforceReassignmentHandoverBackstop(deps, {
      runId: "run-1",
      issueId: "issue-1",
    });

    expect(result.outcome).toBe("cancel_unconfirmed");
    expect(result.status).toBe("running");
  });

  it("arms the backstop ten minutes out and does not hold the process open", async () => {
    vi.useFakeTimers();
    const { deps, getRun, cancelRun } = makeDeps({ status: "running" });

    const handle = scheduleReassignmentHandoverBackstop(deps, {
      runId: "run-1",
      issueId: "issue-1",
    });

    expect(REASSIGNMENT_HANDOVER_BACKSTOP_MS).toBe(10 * 60_000);
    await vi.advanceTimersByTimeAsync(REASSIGNMENT_HANDOVER_BACKSTOP_MS - 1);
    expect(getRun).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(cancelRun).toHaveBeenCalledTimes(1));
    handle.cancel();
  });

  it("can be disarmed before it fires", async () => {
    vi.useFakeTimers();
    const { deps, getRun } = makeDeps({ status: "running" });

    const handle = scheduleReassignmentHandoverBackstop(deps, {
      runId: "run-1",
      issueId: "issue-1",
    });
    handle.cancel();

    await vi.advanceTimersByTimeAsync(REASSIGNMENT_HANDOVER_BACKSTOP_MS);
    expect(getRun).not.toHaveBeenCalled();
  });
});

describe("reassignmentRunDisposition", () => {
  it("hands over a run that already started", () => {
    expect(
      reassignmentRunDisposition({ status: "running", startedAt: new Date("2026-10-20T03:30:00Z") }),
    ).toBe("hand_over");
  });

  it("hands over a queued run that already started once", () => {
    expect(
      reassignmentRunDisposition({ status: "queued", startedAt: new Date("2026-10-20T03:30:00Z") }),
    ).toBe("hand_over");
  });

  it("cancels a run that never started", () => {
    expect(reassignmentRunDisposition({ status: "queued", startedAt: null })).toBe(
      "cancel_never_started",
    );
    expect(reassignmentRunDisposition({ status: "scheduled_retry", startedAt: null })).toBe(
      "cancel_never_started",
    );
  });

  it("keeps a run without a start record when its status is not a wait state", () => {
    // Only queued/scheduled_retry rows are known to hold no work (startedAt is
    // written when a run actually starts). Anything else without a startedAt is
    // unproven, so hand it over instead of throwing work away.
    expect(reassignmentRunDisposition({ status: "running" })).toBe("hand_over");
    expect(reassignmentRunDisposition({ status: "running", startedAt: null })).toBe("hand_over");
  });
});
