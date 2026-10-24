import type { DeferredWakeSweeper } from "./ports.js";
import type { PostCommitEffect } from "./types.js";
import { runReleaseDrain } from "./use-cases.js";

/**
 * A wake parked for at least this long is a missed drain, not a wake that is
 * still waiting behind a live run: the release path promotes a parked wake as
 * soon as its run finalizes, so two minutes is already several scheduler ticks.
 */
export const DEFERRED_WAKE_SWEEP_STALE_AFTER_MS = 2 * 60 * 1000;

/** Bounded per pass: the backstop must never turn one tick into an unbounded scan. */
export const DEFERRED_WAKE_SWEEP_LIMIT = 50;

/**
 * Promotions this pass may start. The tick runs every few seconds, so an
 * uncapped backfill would turn a hundred parked wakes into a hundred queued
 * runs at once, which is the queue inflation the board decided against
 * (HIS-3505 K5: at most five per round, oldest first). The candidates are read
 * oldest-first, so a capped pass drains the longest-parked issues first and
 * the next pass continues where it stopped.
 */
export const DEFERRED_WAKE_SWEEP_MAX_PROMOTIONS = 5;

export type DeferredWakeSweepResult = {
  /** Issues the store returned as candidates for this pass. */
  scanned: number;
  /** Issues whose drain ran (promoted or not). */
  drained: number;
  promoted: number;
  cancelled: number;
  skipped: number;
  failed: number;
  /**
   * Candidates this pass did not read because the promotion cap was reached.
   * Non-zero means the backfill is still catching up; the next tick continues.
   */
  deferredByPromotionCap: number;
  skipReasons: Record<string, number>;
  promotedRunIds: string[];
  cancelledWakeIds: string[];
};

function emptyResult(): DeferredWakeSweepResult {
  return {
    scanned: 0,
    drained: 0,
    promoted: 0,
    cancelled: 0,
    skipped: 0,
    failed: 0,
    deferredByPromotionCap: 0,
    skipReasons: {},
    promotedRunIds: [],
    cancelledWakeIds: [],
  };
}

/**
 * The periodic backstop for wakes that stayed parked on
 * `deferred_issue_execution` because the release drain only fires from a run
 * finalization or an explicit event.
 *
 * One pass reads the bounded candidate list from the store, and for each issue
 * asks the store to open the issue lock and decide. Only a `drain` decision
 * reaches `runReleaseDrain`, and it does so with `suppressImmediateRecovery`
 * set: the backstop resumes parked wakes, it never queues a recovery run of
 * its own. Issues that need no work cost one read and no provider session.
 */
export function createSweepDeferredIssueExecutionWakes(deps: {
  sweeper: DeferredWakeSweeper;
}) {
  return async function sweepDeferredIssueExecutionWakes(input: {
    now: Date;
    staleAfterMs?: number;
    limit?: number;
    /** Overrides the per-pass promotion cap; cancels and skips are never capped. */
    maxPromotions?: number;
    companyId?: string | null;
  }): Promise<{
    result: DeferredWakeSweepResult;
    postCommitEffects: PostCommitEffect[];
  }> {
    const result = emptyResult();
    const postCommitEffects: PostCommitEffect[] = [];
    const candidates = await deps.sweeper.listStaleDeferredWakeIssues({
      now: input.now,
      staleAfterMs: input.staleAfterMs ?? DEFERRED_WAKE_SWEEP_STALE_AFTER_MS,
      limit: input.limit ?? DEFERRED_WAKE_SWEEP_LIMIT,
      ...(input.companyId ? { companyId: input.companyId } : {}),
    });

    const maxPromotions = Math.max(0, input.maxPromotions ?? DEFERRED_WAKE_SWEEP_MAX_PROMOTIONS);
    let promotionsLeft = maxPromotions;

    for (const candidate of candidates) {
      // Once the pass has started `maxPromotions` promotions it stops for this
      // tick: without that, one tick would start a run for every parked wake
      // on the board at once. Nothing is lost, because the candidate list is
      // oldest-first and a drained wake leaves it, so the next pass starts
      // exactly where this one stopped. The rest is counted so the log shows
      // how much backfill is still waiting.
      if (promotionsLeft <= 0) {
        result.deferredByPromotionCap = candidates.length - result.scanned;
        break;
      }
      result.scanned += 1;
      try {
        const outcome = await deps.sweeper.drainIssue(
          {
            companyId: candidate.companyId,
            issueId: candidate.issueId,
            now: input.now,
          },
          // Same drain the release path uses; the sweeper only chooses the
          // issue and the finishing run it replays.
          (locked, ports) =>
            runReleaseDrain(locked, ports, {
              companyId: candidate.companyId,
              runId: locked.run.id,
              now: input.now,
              suppressImmediateRecovery: true,
            }),
        );

        if (outcome.action === "drained") {
          result.drained += 1;
          postCommitEffects.push(...outcome.postCommitEffects);
          if (outcome.outcome.kind === "promoted") {
            result.promoted += 1;
            promotionsLeft -= 1;
            result.promotedRunIds.push(outcome.outcome.run.id);
          }
        } else if (outcome.action === "cancelled") {
          result.cancelled += outcome.wakeIds.length;
          result.cancelledWakeIds.push(...outcome.wakeIds);
        } else if (outcome.action === "skipped") {
          result.skipped += 1;
          result.skipReasons[outcome.reason] =
            (result.skipReasons[outcome.reason] ?? 0) + 1;
        } else {
          // The issue row was gone by the time the sweep took its lock
          // (deleted, or moved to another company). Nothing is left to resume,
          // but it is still a candidate this pass read, so it is counted:
          // otherwise the pass totals do not add up to `scanned`.
          result.skipped += 1;
          result.skipReasons.issue_missing = (result.skipReasons.issue_missing ?? 0) + 1;
        }
      } catch {
        // One issue must never abort the pass: the next tick retries it.
        result.failed += 1;
      }
    }

    return { result, postCommitEffects };
  };
}
