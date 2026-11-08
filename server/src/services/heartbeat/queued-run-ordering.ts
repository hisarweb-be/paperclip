/**
 * Pure ordering of queued heartbeat runs for one agent.
 *
 * Upstream order: class rank (in-progress issue, ready issue, no issue,
 * dependency-blocked issue), then issue priority, then age. Under sustained
 * load that order can starve low-priority work indefinitely: a fresh critical
 * or in-progress run always jumps ahead of a todo run that has been waiting
 * for hours.
 *
 * Optional wait-time ageing (PAPERCLIP_QUEUE_AGE_UP_MIN) fixes that. Class and
 * priority are folded into one score (class * 5 + priority, so with ageing off
 * the order is exactly the upstream order) and every full ageing interval a
 * run has waited lowers its score by one whole class. Dependency-blocked runs
 * never age: they cannot make progress, so promoting them only burns a slot.
 */

export const QUEUED_RUN_AGE_UP_MIN_ENV = "PAPERCLIP_QUEUE_AGE_UP_MIN";

/** Number of distinct priority ranks (critical, high, medium, low, unknown). */
export const QUEUED_RUN_PRIORITY_CLASSES = 5;

export const QUEUED_RUN_CLASS_RANK = {
  inProgressIssue: 0,
  readyIssue: 1,
  noIssue: 2,
  dependencyBlocked: 3,
} as const;

export type QueuedRunClassRank =
  (typeof QUEUED_RUN_CLASS_RANK)[keyof typeof QUEUED_RUN_CLASS_RANK];

export interface QueuedRunSortKey {
  classRank: number;
  priorityRank: number;
  createdAtMs: number;
}

/**
 * Reads the ageing interval in minutes. Unset, empty, non-integer or
 * non-positive values disable ageing (upstream behaviour) and return null.
 */
export function readQueuedRunAgeUpMinutes(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env[QUEUED_RUN_AGE_UP_MIN_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const minutes = Number(raw);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

export function queuedRunClassRank(input: {
  hasIssue: boolean;
  dependencyReady: boolean;
  issueStatus: string | null | undefined;
}): QueuedRunClassRank {
  if (!input.hasIssue) return QUEUED_RUN_CLASS_RANK.noIssue;
  if (!input.dependencyReady) return QUEUED_RUN_CLASS_RANK.dependencyBlocked;
  return input.issueStatus === "in_progress"
    ? QUEUED_RUN_CLASS_RANK.inProgressIssue
    : QUEUED_RUN_CLASS_RANK.readyIssue;
}

export function queuedRunPriorityRank(
  priority: string | null | undefined,
): number {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

/** Lower score runs first. `ageUpMinutes === null` disables ageing. */
export function queuedRunSortScore(
  key: QueuedRunSortKey,
  nowMs: number,
  ageUpMinutes: number | null,
): number {
  const base = key.classRank * QUEUED_RUN_PRIORITY_CLASSES + key.priorityRank;
  if (ageUpMinutes === null) return base;
  if (key.classRank >= QUEUED_RUN_CLASS_RANK.dependencyBlocked) return base;
  const waitedMs = Math.max(0, nowMs - key.createdAtMs);
  const steps = Math.floor(waitedMs / (ageUpMinutes * 60_000));
  return base - steps * QUEUED_RUN_PRIORITY_CLASSES;
}

/**
 * Comparator for queued runs. Pass one `nowMs` and one `ageUpMinutes` for the
 * whole sort so the order stays consistent while sorting. Equal scores imply
 * equal priority (score modulo 5 is the priority rank), so the only remaining
 * tie-breaker is age: older runs first.
 */
export function compareQueuedRuns(
  left: QueuedRunSortKey,
  right: QueuedRunSortKey,
  nowMs: number,
  ageUpMinutes: number | null,
): number {
  const scoreDiff =
    queuedRunSortScore(left, nowMs, ageUpMinutes) -
    queuedRunSortScore(right, nowMs, ageUpMinutes);
  if (scoreDiff !== 0) return scoreDiff;
  return left.createdAtMs - right.createdAtMs;
}
