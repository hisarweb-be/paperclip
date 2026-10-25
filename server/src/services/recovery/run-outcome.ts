/**
 * Stamped by the legacy-controller lease when it aborts a run whose adapter
 * side already produced a clean result (exitCode 0, subtype success).
 */
export const LEASE_CANCELLATION_ERROR_CODE = "cancelled_controller_lease_lost";

export type RecoveryOutcomeRun = {
  status: string;
  errorCode?: string | null;
  resultJson?: unknown;
} | null;

function readResultJsonField(resultJson: unknown, key: string): unknown {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return undefined;
  }
  return (resultJson as Record<string, unknown>)[key];
}

export function isLeaseCancelledRun(run: RecoveryOutcomeRun): boolean {
  if (!run || run.status !== "cancelled") return false;
  if (run.errorCode === LEASE_CANCELLATION_ERROR_CODE) return true;
  return readResultJsonField(run.resultJson, "leaseCancellation") != null;
}

/**
 * Recovery's own question is "did this run deliver its work?" — not "did the
 * row end as `succeeded`". A run the legacy-controller lease cancelled after
 * the adapter had already produced a clean result (exitCode 0, subtype
 * success) did deliver its work; the cancellation came from the controller,
 * not from the work. The run row keeps `status: "cancelled"` (the abort really
 * happened, rewriting it would falsify the record); only the reader decides.
 *
 * CEO decision 21 Oct 2026 on HIS-3597 question 2. Only readers whose question
 * is "is the work done?" may use this. Readers that start a new round or a wake
 * message keep testing `status === "succeeded"`, because a lease-cancelled run
 * was already followed up by the controller.
 */
export function isRunSucceededForRecovery(run: RecoveryOutcomeRun): boolean {
  if (!run) return false;
  if (run.status === "succeeded") return true;
  return isLeaseCancelledRun(run);
}
