import { describe, expect, it } from "vitest";
import {
  isRoutineExecutionIssue,
  resolveRoutineExecutionRunner,
} from "./routine-execution-binding.js";

const EXECUTOR = "11111111-1111-4111-8111-111111111111";
const RUNTIME_ASSIGNEE = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "33333333-3333-4333-8333-333333333333";

function executionState(overrides: Record<string, unknown> = {}) {
  return {
    status: "pending",
    currentStageId: "44444444-4444-4444-8444-444444444444",
    currentStageIndex: 0,
    currentStageType: "review",
    currentParticipant: { type: "agent", agentId: REVIEWER, userId: null },
    returnAssignee: { type: "agent", agentId: EXECUTOR, userId: null },
    reviewRequest: null,
    completedStageIds: [],
    lastDecisionId: null,
    lastDecisionOutcome: null,
    changesRequestedCount: 0,
    ...overrides,
  };
}

describe("isRoutineExecutionIssue", () => {
  it("matches only the routine execution origin kind", () => {
    expect(isRoutineExecutionIssue("routine_execution")).toBe(true);
    expect(isRoutineExecutionIssue("chat_channel")).toBe(false);
    expect(isRoutineExecutionIssue(null)).toBe(false);
    expect(isRoutineExecutionIssue(undefined)).toBe(false);
  });
});

describe("resolveRoutineExecutionRunner", () => {
  it("returns null for non routine execution issues", () => {
    const resolution = resolveRoutineExecutionRunner({
      originKind: "chat_channel",
      executionStateRaw: null,
      routineAssigneeAgentId: EXECUTOR,
      assigneeAgentId: RUNTIME_ASSIGNEE,
    });
    expect(resolution).toEqual({
      runnerAgentId: null,
      source: null,
      reason: "not_routine_execution",
    });
  });

  it("prefers the frozen execution return assignee over a drifted assignee", () => {
    const resolution = resolveRoutineExecutionRunner({
      originKind: "routine_execution",
      executionStateRaw: executionState(),
      routineAssigneeAgentId: EXECUTOR,
      assigneeAgentId: RUNTIME_ASSIGNEE,
    });
    expect(resolution.runnerAgentId).toBe(EXECUTOR);
    expect(resolution.source).toBe("execution_return_assignee");
  });

  it("falls back to the routine assignee before a review stage froze one", () => {
    const resolution = resolveRoutineExecutionRunner({
      originKind: "routine_execution",
      executionStateRaw: null,
      routineAssigneeAgentId: EXECUTOR,
      assigneeAgentId: RUNTIME_ASSIGNEE,
    });
    expect(resolution.runnerAgentId).toBe(EXECUTOR);
    expect(resolution.source).toBe("routine_assignee");
  });

  it("ignores a user return assignee and resolves the routine assignee", () => {
    const resolution = resolveRoutineExecutionRunner({
      originKind: "routine_execution",
      executionStateRaw: executionState({
        returnAssignee: { type: "user", agentId: null, userId: "user-1" },
      }),
      routineAssigneeAgentId: EXECUTOR,
      assigneeAgentId: RUNTIME_ASSIGNEE,
    });
    expect(resolution.runnerAgentId).toBe(EXECUTOR);
    expect(resolution.source).toBe("routine_assignee");
  });

  it("treats malformed execution state as absent", () => {
    const resolution = resolveRoutineExecutionRunner({
      originKind: "routine_execution",
      executionStateRaw: "{not-json",
      routineAssigneeAgentId: EXECUTOR,
      assigneeAgentId: RUNTIME_ASSIGNEE,
    });
    expect(resolution.runnerAgentId).toBe(EXECUTOR);
    expect(resolution.source).toBe("routine_assignee");
  });

  it("keeps the current assignee when the routine is gone", () => {
    const resolution = resolveRoutineExecutionRunner({
      originKind: "routine_execution",
      executionStateRaw: null,
      routineAssigneeAgentId: null,
      assigneeAgentId: RUNTIME_ASSIGNEE,
    });
    expect(resolution.runnerAgentId).toBe(RUNTIME_ASSIGNEE);
    expect(resolution.source).toBe("issue_assignee");
  });

  it("reports no runner when nothing identifies an executor", () => {
    const resolution = resolveRoutineExecutionRunner({
      originKind: "routine_execution",
      executionStateRaw: null,
      routineAssigneeAgentId: null,
      assigneeAgentId: null,
    });
    expect(resolution.runnerAgentId).toBeNull();
    expect(resolution.reason).toBe("no_runner");
  });
});
