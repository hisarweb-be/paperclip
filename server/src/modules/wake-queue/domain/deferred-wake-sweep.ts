/**
 * Periodic backstop for wakes that are parked on `deferred_issue_execution`.
 *
 * The deferred queue is normally drained by `releaseIssueExecutionAndPromote`,
 * which only runs from a run finalization or an explicit event. A wake that
 * misses that one drain stays parked forever: nothing re-reads it, and its
 * presence keeps the issue out of the stranded-recovery lanes because
 * `hasActiveExecutionPath()` counts a deferred wake as a live path.
 *
 * This module owns the pure decision for that backstop. It never promotes a
 * wake itself; the Postgres adapter hands a `drain` decision to the very same
 * `runReleaseDrain` the release path uses, so the promotion, compare-and-set,
 * and comment-liveness rules keep one implementation.
 */

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

export type DeferredWakeSweepWake = {
  id: string;
  requestedAt: Date;
  /**
   * True when the wake carries authority to reopen a completed task: a human
   * comment, an explicit reopen, or an assignee resume intent. Those wakes are
   * left to the drain that a real comment/assignment event triggers, so a
   * finished card is never revived by the sweeper alone.
   */
  canReopenTerminalIssue: boolean;
};

export type DeferredWakeSweepFacts = {
  issueStatus: string;
  /** A run in `queued`/`running`/`scheduled_retry` on this issue, whatever the agent. */
  liveRunId: string | null;
  /** The run holding `issues.executionRunId`, when that run is still live. */
  liveLockRunId: string | null;
  /** The most recent terminal run on the issue; the sweep replays its release. */
  latestRun: { id: string; status: string; finishedAt: Date | null } | null;
  /** True when that latest run was stopped by a board operator or the Stop control. */
  latestRunOperatorCancelled: boolean;
  /** Wakes on the same issue that are still in flight (`queued`/`claimed`). */
  inFlightWakeCount: number;
  /** An open, non-hidden predecessor still lists this issue in a `blocks` relation. */
  dependencyBlocked: boolean;
  deferredWakes: DeferredWakeSweepWake[];
};

export type DeferredWakeSweepSkipReason =
  | "no_deferred_wakes"
  | "terminal_issue"
  | "dependency_blocked"
  | "live_execution_path"
  | "other_wake_in_flight"
  | "operator_cancelled"
  | "no_finishing_run";

export type DeferredWakeSweepDecision =
  | { kind: "drain"; wakeIds: string[] }
  | { kind: "skip"; reason: DeferredWakeSweepSkipReason }
  | { kind: "cancel"; wakeIds: string[]; reason: string };

export const DEFERRED_WAKE_SWEEP_TERMINAL_ISSUE_CANCEL_REASON =
  "Deferred wake parked on a terminal task has no reopen authority";

/**
 * True when a run was stopped by a board operator or the Stop control, so a
 * parked wake behind it must not be resumed by a background pass. This is the
 * wake-queue's read of the same attribution `isOperatorCancelledRun` applies in
 * `services/recovery/service.ts:849`; that helper stays in the recovery lane
 * because its chat-control branch reads the assignee's recovery state.
 */
export function isOperatorCancelledWakeSource(run: {
  status: string;
  errorCode: string | null;
  resultJson: Record<string, unknown> | null | undefined;
}): boolean {
  if (run.status !== "cancelled") return false;
  if (run.errorCode === "operator_interrupted") return true;
  const cancelledByActorType = run.resultJson?.cancelledByActorType;
  return cancelledByActorType === "user" || cancelledByActorType === "board";
}

/**
 * Decides what the sweeper may do with the deferred wakes of one issue.
 *
 * Order matters. Every fact that would make a promotion unsafe is checked
 * before the drain, and the terminal-issue branch is decided first because a
 * finished card must never be revived by a background pass.
 */
export function decideDeferredWakeSweep(
  facts: DeferredWakeSweepFacts,
): DeferredWakeSweepDecision {
  if (facts.deferredWakes.length === 0) return { kind: "skip", reason: "no_deferred_wakes" };

  if (TERMINAL_ISSUE_STATUSES.has(facts.issueStatus)) {
    // A wake with reopen authority belongs to the real event that will follow
    // (a comment, a reassignment). Cancelling it here would silently drop a
    // human message on a completed card.
    if (facts.deferredWakes.some((wake) => wake.canReopenTerminalIssue)) {
      return { kind: "skip", reason: "terminal_issue" };
    }
    return {
      kind: "cancel",
      wakeIds: facts.deferredWakes.map((wake) => wake.id),
      reason: DEFERRED_WAKE_SWEEP_TERMINAL_ISSUE_CANCEL_REASON,
    };
  }

  // A dependency-blocked card has its own wake path
  // (`reconcileResolvedDependencyWakes`). Promoting here would hand the gate a
  // run it only cancels again, and the parked intent would be lost.
  if (facts.dependencyBlocked) return { kind: "skip", reason: "dependency_blocked" };

  if (facts.liveLockRunId || facts.liveRunId) {
    return { kind: "skip", reason: "live_execution_path" };
  }

  // Another wake for the same issue is already being delivered. Let that one
  // finish; the next pass sees the issue free again.
  if (facts.inFlightWakeCount > 0) return { kind: "skip", reason: "other_wake_in_flight" };

  if (!facts.latestRun) return { kind: "skip", reason: "no_finishing_run" };

  // An operator stop stands down until newer activity supersedes it: a wake
  // requested after that run finished is exactly that newer activity.
  if (facts.latestRunOperatorCancelled && facts.latestRun.finishedAt) {
    const newestWake = facts.deferredWakes.reduce(
      (latest, wake) => (wake.requestedAt > latest ? wake.requestedAt : latest),
      facts.deferredWakes[0]!.requestedAt,
    );
    if (newestWake.getTime() <= facts.latestRun.finishedAt.getTime()) {
      return { kind: "skip", reason: "operator_cancelled" };
    }
  }

  return { kind: "drain", wakeIds: facts.deferredWakes.map((wake) => wake.id) };
}
