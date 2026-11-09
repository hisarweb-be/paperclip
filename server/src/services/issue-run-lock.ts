import type { heartbeatRuns, issues } from "@paperclipai/db";
import { isAcknowledgedNativeStop } from "./acknowledged-native-stop.js";
import { isExplicitContinuationRetryClaim } from "./explicit-continuation-retry-claim.js";
import { REASSIGNMENT_HOLD_RUN_STATUSES } from "./reassignment-handover.js";

type LockIssue = Pick<typeof issues.$inferSelect, "id" | "companyId" | "executionRunId">;
type LockRun = Pick<
  typeof heartbeatRuns.$inferSelect,
  "id" | "companyId" | "runtimeMode" | "status" | "contextSnapshot" | "nativeIssueId" | "resultJson"
>;

/**
 * A run still holds its issue when it can write (queued, running,
 * scheduled_retry), when it is an explicit continuation retry claim, or when
 * it ended in an acknowledged native Stop that keeps the issue on manual hold.
 */
export function runHoldsIssueLock(issue: LockIssue, run: LockRun | null | undefined): boolean {
  if (!run) return false;
  if ((REASSIGNMENT_HOLD_RUN_STATUSES as readonly string[]).includes(run.status)) return true;
  return isExplicitContinuationRetryClaim(issue, run) || isAcknowledgedNativeStop(run);
}
