/**
 * HIS-3477: a reassignment hands a started run over instead of killing it.
 *
 * The handover does not depend on a runner goal: for most adapters
 * (`claude_local`) there is no goal to pause at all. A run that has started
 * (`startedAt != null`) finishes its current turn and the heartbeat
 * continuation gate refuses the next turn with `issue_reassigned`. Only runs
 * that never started (`queued`/`scheduled_retry`) are cancelled up front; they
 * cost no work and would otherwise hold the execution lock.
 *
 * If a handed-over run is still active ten minutes later, the backstop cancels
 * it anyway so a stuck handover cannot hold the issue forever.
 * `resultJson.forced = true` separates these cancellations from plain
 * reassignment stops in the remeasurement.
 */
export const REASSIGNMENT_HANDOVER_BACKSTOP_MS = 10 * 60_000;

/** Runs the reassignment branch has to resolve: they hold or claim the issue. */
export const REASSIGNMENT_HOLD_RUN_STATUSES = [
  "running",
  "queued",
  "scheduled_retry",
] as const;

/** Runs that can still be cancelled by the backstop. */
const BACKSTOP_CANCELLABLE_RUN_STATUSES = new Set<string>(
  REASSIGNMENT_HOLD_RUN_STATUSES,
);

type BackstopRun = { id: string; status: string };

export type ReassignmentHandoverBackstopDeps = {
  getRun: (runId: string) => Promise<BackstopRun | null>;
  cancelRun: (
    runId: string,
    reason: string,
    options: {
      errorCode: string;
      resultJson: Record<string, unknown>;
      eventMessage: string;
      eventPayload: Record<string, unknown>;
    },
  ) => Promise<BackstopRun | null>;
};

export type ReassignmentRunDisposition = "hand_over" | "cancel_never_started";

/**
 * What a reassignment does with the run that holds the issue.
 *
 * The line is whether the run ever started, not whether a runner goal could be
 * stopped: `startedAt != null` means real work is in flight, so the run is
 * handed over and the continuation gate ends it. A run that never started
 * (`queued`/`scheduled_retry` without `startedAt`) only holds the execution
 * lock and is cancelled up front. A `running` row without `startedAt` is
 * anomalous; it is handed over and left to the backstop rather than killed.
 */
export function reassignmentRunDisposition(run: {
  status: string;
  startedAt?: Date | string | null;
}): ReassignmentRunDisposition {
  if (run.startedAt != null) return "hand_over";
  return run.status === "queued" || run.status === "scheduled_retry"
    ? "cancel_never_started"
    : "hand_over";
}

export type ReassignmentHandoverBackstopOutcome =
  | "run_missing"
  | "run_finished"
  | "forced_cancel"
  | "cancel_unconfirmed";

export type ReassignmentHandoverBackstopResult = {
  outcome: ReassignmentHandoverBackstopOutcome;
  runId: string;
  status: string | null;
};

/**
 * Cancel a handed-over run that never stopped. The run is re-read first so a
 * run that already finished its turn is left alone; a run that is still active
 * gets the normal reassignment cancellation, marked as forced.
 */
export async function enforceReassignmentHandoverBackstop(
  deps: ReassignmentHandoverBackstopDeps,
  input: { runId: string; issueId: string },
): Promise<ReassignmentHandoverBackstopResult> {
  const current = await deps.getRun(input.runId);
  if (!current) {
    return { outcome: "run_missing", runId: input.runId, status: null };
  }
  if (!BACKSTOP_CANCELLABLE_RUN_STATUSES.has(current.status)) {
    return { outcome: "run_finished", runId: input.runId, status: current.status };
  }
  const cancelled = await deps.cancelRun(
    input.runId,
    "Cancelled by reassignment handover backstop",
    {
      errorCode: "issue_reassigned",
      resultJson: { reassignmentStopConfirmed: true, forced: true },
      eventMessage: "run cancelled by reassignment handover backstop",
      eventPayload: { issueId: input.issueId, forced: true },
    },
  );
  if (cancelled && cancelled.status === "cancelled") {
    return { outcome: "forced_cancel", runId: input.runId, status: cancelled.status };
  }
  return {
    outcome: "cancel_unconfirmed",
    runId: input.runId,
    status: cancelled?.status ?? current.status,
  };
}

export type ReassignmentHandoverBackstopHandle = { cancel: () => void };

/**
 * Arm the backstop in-process. The timer is unref'd so it never keeps the
 * process alive by itself, matching the other route-level timers.
 */
export function scheduleReassignmentHandoverBackstop(
  deps: ReassignmentHandoverBackstopDeps,
  input: { runId: string; issueId: string },
  options?: {
    delayMs?: number;
    onResult?: (result: ReassignmentHandoverBackstopResult) => void;
    onError?: (error: unknown) => void;
  },
): ReassignmentHandoverBackstopHandle {
  const timer = setTimeout(() => {
    void enforceReassignmentHandoverBackstop(deps, input)
      .then((result) => options?.onResult?.(result))
      .catch((error) => options?.onError?.(error));
  }, options?.delayMs ?? REASSIGNMENT_HANDOVER_BACKSTOP_MS);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}
