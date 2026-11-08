import { describe, expect, it } from "vitest";
import {
  QUEUED_RUN_AGE_UP_MIN_ENV,
  QUEUED_RUN_CLASS_RANK,
  compareQueuedRuns,
  queuedRunClassRank,
  queuedRunPriorityRank,
  queuedRunSortScore,
  readQueuedRunAgeUpMinutes,
  type QueuedRunSortKey,
} from "./queued-run-ordering.js";

const MINUTE = 60_000;
const NOW = Date.parse("2026-11-08T12:00:00.000Z");

type NamedKey = QueuedRunSortKey & { name: string };

function key(name: string, classRank: number, priorityRank: number, waitedMinutes: number): NamedKey {
  return { name, classRank, priorityRank, createdAtMs: NOW - waitedMinutes * MINUTE };
}

function order(keys: NamedKey[], ageUpMinutes: number | null) {
  return [...keys].sort((a, b) => compareQueuedRuns(a, b, NOW, ageUpMinutes)).map((k) => k.name);
}

// The comparator the queue used before ageing existed: class, priority, age.
function upstreamCompare(a: QueuedRunSortKey, b: QueuedRunSortKey) {
  if (a.classRank !== b.classRank) return a.classRank - b.classRank;
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
  return a.createdAtMs - b.createdAtMs;
}

describe("readQueuedRunAgeUpMinutes", () => {
  it("is off when unset or invalid", () => {
    expect(readQueuedRunAgeUpMinutes({})).toBeNull();
    for (const value of ["", "  ", "0", "-5", "abc", "1.5", "30m", "1e3"]) {
      expect(readQueuedRunAgeUpMinutes({ [QUEUED_RUN_AGE_UP_MIN_ENV]: value })).toBeNull();
    }
  });

  it("reads a positive integer number of minutes", () => {
    expect(readQueuedRunAgeUpMinutes({ [QUEUED_RUN_AGE_UP_MIN_ENV]: "30" })).toBe(30);
    expect(readQueuedRunAgeUpMinutes({ [QUEUED_RUN_AGE_UP_MIN_ENV]: " 5 " })).toBe(5);
  });
});

describe("queuedRunClassRank and queuedRunPriorityRank", () => {
  it("rank runs the way the queue always has", () => {
    expect(queuedRunClassRank({ hasIssue: true, dependencyReady: true, issueStatus: "in_progress" })).toBe(0);
    expect(queuedRunClassRank({ hasIssue: true, dependencyReady: true, issueStatus: "todo" })).toBe(1);
    expect(queuedRunClassRank({ hasIssue: false, dependencyReady: true, issueStatus: null })).toBe(2);
    expect(queuedRunClassRank({ hasIssue: true, dependencyReady: false, issueStatus: "in_progress" })).toBe(3);
    expect(["critical", "high", "medium", "low", "other", null].map(queuedRunPriorityRank)).toEqual([0, 1, 2, 3, 4, 4]);
  });
});

describe("compareQueuedRuns", () => {
  it("matches the upstream order exactly when ageing is off", () => {
    const keys: NamedKey[] = [];
    for (let classRank = 0; classRank <= 3; classRank += 1)
      for (let priorityRank = 0; priorityRank <= 4; priorityRank += 1)
        for (const waited of [0, 45, 600])
          keys.push(key(`${classRank}-${priorityRank}-${waited}`, classRank, priorityRank, waited));
    const shuffled = [...keys].reverse();
    const expected = [...shuffled].sort(upstreamCompare).map((k) => k.name);
    expect(order(shuffled, null)).toEqual(expected);
  });

  it("lets a long-waiting todo run overtake fresh in-progress critical work", () => {
    const fresh = key("fresh-in-progress-critical", QUEUED_RUN_CLASS_RANK.inProgressIssue, 0, 0);
    const waitingLow = key("waiting-todo-low", QUEUED_RUN_CLASS_RANK.readyIssue, 3, 61);
    // Without ageing the waiting run is starved.
    expect(order([waitingLow, fresh], null)).toEqual(["fresh-in-progress-critical", "waiting-todo-low"]);
    // Fewer than two intervals waited: still behind.
    expect(order([waitingLow, fresh], 60)).toEqual(["fresh-in-progress-critical", "waiting-todo-low"]);
    // Two intervals (2 x 30 min): it moves ahead.
    expect(queuedRunSortScore(waitingLow, NOW, 30)).toBe(1 * 5 + 3 - 2 * 5);
    expect(order([waitingLow, fresh], 30)).toEqual(["waiting-todo-low", "fresh-in-progress-critical"]);
  });

  it("ages by one whole class per full interval", () => {
    const run = key("run", QUEUED_RUN_CLASS_RANK.noIssue, 2, 29);
    expect(queuedRunSortScore(run, NOW, 30)).toBe(12);
    expect(queuedRunSortScore({ ...run, createdAtMs: NOW - 30 * MINUTE }, NOW, 30)).toBe(7);
    expect(queuedRunSortScore({ ...run, createdAtMs: NOW - 90 * MINUTE }, NOW, 30)).toBe(-3);
  });

  it("never ages dependency-blocked runs", () => {
    const blocked = key("blocked", QUEUED_RUN_CLASS_RANK.dependencyBlocked, 0, 10_000);
    const fresh = key("fresh-no-issue-unknown", QUEUED_RUN_CLASS_RANK.noIssue, 4, 0);
    expect(queuedRunSortScore(blocked, NOW, 30)).toBe(15);
    expect(order([blocked, fresh], 30)).toEqual(["fresh-no-issue-unknown", "blocked"]);
  });

  it("does not age runs created in the future (clock skew)", () => {
    const future = key("future", QUEUED_RUN_CLASS_RANK.readyIssue, 2, -60);
    expect(queuedRunSortScore(future, NOW, 30)).toBe(7);
  });

  it("breaks score ties by age, older first", () => {
    // Both score 1: aged ready/high (6 - 5) against a fresh in-progress/high run.
    const agedReady = key("aged-ready-high", QUEUED_RUN_CLASS_RANK.readyIssue, 1, 30);
    const freshInProgress = key("fresh-in-progress-high", QUEUED_RUN_CLASS_RANK.inProgressIssue, 1, 0);
    expect(order([freshInProgress, agedReady], 30)).toEqual(["aged-ready-high", "fresh-in-progress-high"]);
  });
});
