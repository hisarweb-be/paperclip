import { describe, expect, it } from "vitest";
import {
  ISSUE_REWAKE_BASE_COOLDOWN_MS,
  ISSUE_REWAKE_MAX_COOLDOWN_MS,
  ISSUE_REWAKE_NO_PROGRESS_THRESHOLD,
  ISSUE_REWAKE_OPEN_BLOCKER_COOLDOWN_ENV,
  computeIssueRewakeCooldownMs,
  evaluateIssueRewakeThrottle,
  isThrottleCandidateIssueRewake,
  readOpenBlockerRewakeCooldownMs,
} from "../services/issue-rewake-throttle.ts";

const NOW = new Date("2026-07-12T18:14:00.000Z");

function runSample(input: {
  id: string;
  status?: string;
  finishedSecondsAgo: number;
}) {
  return {
    id: input.id,
    status: input.status ?? "succeeded",
    finishedAt: new Date(NOW.getTime() - input.finishedSecondsAgo * 1000),
  };
}

describe("isThrottleCandidateIssueRewake", () => {
  const base = {
    reason: "issue_assigned",
    wakeCommentId: null,
    requestedByActorType: "system" as const,
    forceFreshSession: false,
    hasExplicitResume: false,
  };

  it("throttles state-poll reasons and reason-less invokes", () => {
    expect(isThrottleCandidateIssueRewake(base)).toBe(true);
    expect(isThrottleCandidateIssueRewake({ ...base, reason: null })).toBe(true);
    expect(isThrottleCandidateIssueRewake({ ...base, reason: "issue_continuation_needed" })).toBe(true);
    expect(isThrottleCandidateIssueRewake({ ...base, reason: "issue_assignment_recovery" })).toBe(true);
    expect(isThrottleCandidateIssueRewake({ ...base, reason: "issue_graph_liveness_backstop" })).toBe(true);
  });

  it("keeps agent comments throttle-eligible without granting human comment privileges", () => {
    expect(isThrottleCandidateIssueRewake({
      ...base,
      reason: "issue_commented",
      wakeCommentId: "comment-1",
      requestedByActorType: "agent",
    })).toBe(true);
    expect(isThrottleCandidateIssueRewake({
      ...base,
      reason: "issue_commented",
      wakeCommentId: "comment-1",
      requestedByActorType: "user",
    })).toBe(false);
  });

  it("never throttles trusted explicit escalation wakes", () => {
    expect(isThrottleCandidateIssueRewake({ ...base, forceFreshSession: true })).toBe(false);
    expect(isThrottleCandidateIssueRewake({ ...base, hasExplicitResume: true })).toBe(false);
  });

  it("keeps agent-authored explicit resume comments throttle-eligible", () => {
    expect(isThrottleCandidateIssueRewake({
      ...base,
      reason: "issue_reopened_via_comment",
      wakeCommentId: "comment-1",
      requestedByActorType: "agent",
      hasExplicitResume: true,
    })).toBe(true);
  });

  it("passes event-shaped wake reasons through", () => {
    for (const reason of [
      "issue_commented",
      "issue_comment_mentioned",
      "issue_blockers_resolved",
      "issue_children_completed",
      "issue_monitor_due",
      "process_lost_retry",
      "run_liveness_continuation",
    ]) {
      expect(isThrottleCandidateIssueRewake({ ...base, reason })).toBe(false);
    }
  });
});

describe("computeIssueRewakeCooldownMs", () => {
  it("starts at the base cooldown and doubles per extra no-progress run, capped", () => {
    expect(computeIssueRewakeCooldownMs(ISSUE_REWAKE_NO_PROGRESS_THRESHOLD)).toBe(ISSUE_REWAKE_BASE_COOLDOWN_MS);
    expect(computeIssueRewakeCooldownMs(ISSUE_REWAKE_NO_PROGRESS_THRESHOLD + 1)).toBe(ISSUE_REWAKE_BASE_COOLDOWN_MS * 2);
    expect(computeIssueRewakeCooldownMs(ISSUE_REWAKE_NO_PROGRESS_THRESHOLD + 3)).toBe(ISSUE_REWAKE_BASE_COOLDOWN_MS * 8);
    expect(computeIssueRewakeCooldownMs(100)).toBe(ISSUE_REWAKE_MAX_COOLDOWN_MS);
  });
});

describe("evaluateIssueRewakeThrottle", () => {
  it("allows when there is no run history", () => {
    expect(
      evaluateIssueRewakeThrottle({
        now: NOW,
        recentTerminalRuns: [],
        runIdsWithIssueProgress: new Set(),
        hasNewIssueInputSinceLastRun: false,
      }),
    ).toEqual({ blocked: false, noProgressStreak: 0 });
  });

  it("allows below the no-progress threshold", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [runSample({ id: "r1", finishedSecondsAgo: 10 })],
      runIdsWithIssueProgress: new Set(),
      hasNewIssueInputSinceLastRun: false,
    });
    expect(decision).toEqual({ blocked: false, noProgressStreak: 1 });
  });

  it("blocks inside the cooldown once the streak reaches the threshold", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [
        runSample({ id: "r2", finishedSecondsAgo: 10 }),
        runSample({ id: "r1", finishedSecondsAgo: 40 }),
      ],
      runIdsWithIssueProgress: new Set(),
      hasNewIssueInputSinceLastRun: false,
    });
    expect(decision.blocked).toBe(true);
    if (decision.blocked) {
      expect(decision.noProgressStreak).toBe(2);
      expect(decision.cooldownMs).toBe(ISSUE_REWAKE_BASE_COOLDOWN_MS);
      expect(decision.nextAllowedAt.getTime()).toBe(
        NOW.getTime() - 10_000 + ISSUE_REWAKE_BASE_COOLDOWN_MS,
      );
    }
  });

  it("allows again after the cooldown elapses", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [
        runSample({ id: "r2", finishedSecondsAgo: ISSUE_REWAKE_BASE_COOLDOWN_MS / 1000 + 1 }),
        runSample({ id: "r1", finishedSecondsAgo: ISSUE_REWAKE_BASE_COOLDOWN_MS / 1000 + 30 }),
      ],
      runIdsWithIssueProgress: new Set(),
      hasNewIssueInputSinceLastRun: false,
    });
    expect(decision).toEqual({ blocked: false, noProgressStreak: 2 });
  });

  it("escalates the cooldown as the streak grows", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [
        runSample({ id: "r4", finishedSecondsAgo: 10 }),
        runSample({ id: "r3", finishedSecondsAgo: 30 }),
        runSample({ id: "r2", finishedSecondsAgo: 60 }),
        runSample({ id: "r1", finishedSecondsAgo: 90 }),
      ],
      runIdsWithIssueProgress: new Set(),
      hasNewIssueInputSinceLastRun: false,
    });
    expect(decision.blocked).toBe(true);
    if (decision.blocked) {
      expect(decision.noProgressStreak).toBe(4);
      expect(decision.cooldownMs).toBe(ISSUE_REWAKE_BASE_COOLDOWN_MS * 4);
    }
  });

  it("resets at the most recent run with issue-visible progress", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [
        runSample({ id: "r3", finishedSecondsAgo: 10 }),
        runSample({ id: "r2", finishedSecondsAgo: 40 }),
        runSample({ id: "r1", finishedSecondsAgo: 70 }),
      ],
      runIdsWithIssueProgress: new Set(["r2"]),
      hasNewIssueInputSinceLastRun: false,
    });
    expect(decision).toEqual({ blocked: false, noProgressStreak: 1 });
  });

  it("does not delay recovery after a failed run", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [
        runSample({ id: "r2", status: "failed", finishedSecondsAgo: 10 }),
        runSample({ id: "r1", finishedSecondsAgo: 40 }),
      ],
      runIdsWithIssueProgress: new Set(),
      hasNewIssueInputSinceLastRun: false,
    });
    expect(decision).toEqual({ blocked: false, noProgressStreak: 0 });
  });

  it("allows when new issue input landed after the last run", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [
        runSample({ id: "r2", finishedSecondsAgo: 10 }),
        runSample({ id: "r1", finishedSecondsAgo: 40 }),
      ],
      runIdsWithIssueProgress: new Set(),
      hasNewIssueInputSinceLastRun: true,
    });
    expect(decision).toEqual({ blocked: false, noProgressStreak: 0 });
  });
});

describe("open-blocker rewake cooldown", () => {
  const SIX_HOURS_MS = 6 * 60 * 60_000;
  const candidateBase = {
    reason: "issue_assigned",
    wakeCommentId: null,
    requestedByActorType: "system" as const,
    forceFreshSession: false,
    hasExplicitResume: false,
  };

  it("is off unless the setting holds a positive whole number of minutes", () => {
    expect(readOpenBlockerRewakeCooldownMs({})).toBeNull();
    for (const value of ["", "0", "-1", "6h", "1.5", "abc"]) {
      expect(readOpenBlockerRewakeCooldownMs({ [ISSUE_REWAKE_OPEN_BLOCKER_COOLDOWN_ENV]: value })).toBeNull();
    }
    expect(readOpenBlockerRewakeCooldownMs({ [ISSUE_REWAKE_OPEN_BLOCKER_COOLDOWN_ENV]: "360" })).toBe(SIX_HOURS_MS);
  });

  it("makes timer and other state wakes on a blocked issue throttle candidates", () => {
    for (const reason of ["heartbeat_timer", "issue_monitor_due", "run_liveness_continuation"]) {
      expect(isThrottleCandidateIssueRewake({ ...candidateBase, reason })).toBe(false);
      expect(isThrottleCandidateIssueRewake({ ...candidateBase, reason, issueHasOpenBlocker: true })).toBe(true);
    }
  });

  it("still lets human comments and explicit escalations through", () => {
    expect(isThrottleCandidateIssueRewake({
      ...candidateBase,
      reason: "issue_commented",
      wakeCommentId: "comment-1",
      requestedByActorType: "user",
      issueHasOpenBlocker: true,
    })).toBe(false);
    expect(isThrottleCandidateIssueRewake({ ...candidateBase, forceFreshSession: true, issueHasOpenBlocker: true })).toBe(false);
    expect(isThrottleCandidateIssueRewake({ ...candidateBase, hasExplicitResume: true, issueHasOpenBlocker: true })).toBe(false);
  });

  it("blocks after a single run that made progress while inside the cooldown", () => {
    const input = {
      now: NOW,
      recentTerminalRuns: [runSample({ id: "r1", finishedSecondsAgo: 3600 })],
      runIdsWithIssueProgress: new Set(["r1"]),
      hasNewIssueInputSinceLastRun: false,
    };
    // Upstream: one run with progress never throttles.
    expect(evaluateIssueRewakeThrottle(input)).toEqual({ blocked: false, noProgressStreak: 0 });
    const decision = evaluateIssueRewakeThrottle({ ...input, openBlockerCooldownMs: SIX_HOURS_MS });
    expect(decision).toEqual({
      blocked: true,
      noProgressStreak: 0,
      cooldownMs: SIX_HOURS_MS,
      lastRunFinishedAt: new Date(NOW.getTime() - 3600_000),
      nextAllowedAt: new Date(NOW.getTime() - 3600_000 + SIX_HOURS_MS),
    });
  });

  it("allows once the cooldown elapsed or new input arrived", () => {
    const base = {
      now: NOW,
      recentTerminalRuns: [runSample({ id: "r1", finishedSecondsAgo: SIX_HOURS_MS / 1000 + 1 })],
      runIdsWithIssueProgress: new Set(["r1"]),
      hasNewIssueInputSinceLastRun: false,
      openBlockerCooldownMs: SIX_HOURS_MS,
    };
    expect(evaluateIssueRewakeThrottle(base)).toEqual({ blocked: false, noProgressStreak: 0 });
    expect(evaluateIssueRewakeThrottle({
      ...base,
      recentTerminalRuns: [runSample({ id: "r1", finishedSecondsAgo: 60 })],
      hasNewIssueInputSinceLastRun: true,
    })).toEqual({ blocked: false, noProgressStreak: 0 });
  });

  it("never weakens the regular streak throttle once its own window passed", () => {
    const decision = evaluateIssueRewakeThrottle({
      now: NOW,
      recentTerminalRuns: [
        runSample({ id: "r2", finishedSecondsAgo: 10 }),
        runSample({ id: "r1", finishedSecondsAgo: 40 }),
      ],
      runIdsWithIssueProgress: new Set(),
      hasNewIssueInputSinceLastRun: false,
      openBlockerCooldownMs: 1,
    });
    expect(decision.blocked).toBe(true);
    if (decision.blocked) expect(decision.cooldownMs).toBe(ISSUE_REWAKE_BASE_COOLDOWN_MS);
  });
});
