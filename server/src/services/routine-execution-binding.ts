import { parseIssueExecutionState } from "./issue-execution-policy.js";

export const ROUTINE_EXECUTION_ORIGIN_KIND = "routine_execution";

export type RoutineExecutionRunnerSource =
  | "execution_return_assignee"
  | "routine_assignee"
  | "issue_assignee";

export type RoutineExecutionRunnerResolution = {
  runnerAgentId: string | null;
  source: RoutineExecutionRunnerSource | null;
  reason:
    | "not_routine_execution"
    | "execution_return_assignee"
    | "routine_assignee"
    | "issue_assignee"
    | "no_runner";
};

export function isRoutineExecutionIssue(
  originKind: string | null | undefined,
): boolean {
  return originKind === ROUTINE_EXECUTION_ORIGIN_KIND;
}

/**
 * Resolve the agent that owns the execution (and its credentials) for a
 * routine execution issue. Credential bindings (for example content
 * publishing keys) follow the routine assignee, so a drifted assignee can
 * strand execution on an agent that cannot run the work. Priority:
 *
 * 1. `executionState.returnAssignee` — the executor frozen when a review
 *    stage started (the reviewer holds the assignee slot in `in_review`).
 * 2. The routine's assignee, joined through `originId`.
 * 3. The issue's current assignee (no drift signal; last resort).
 *
 * Pure on purpose: callers supply the routine assignee so recovery can join
 * it once per issue and this stays unit-testable without a database.
 */
export function resolveRoutineExecutionRunner(input: {
  originKind: string | null | undefined;
  executionStateRaw: unknown;
  routineAssigneeAgentId: string | null | undefined;
  assigneeAgentId: string | null | undefined;
}): RoutineExecutionRunnerResolution {
  if (!isRoutineExecutionIssue(input.originKind)) {
    return {
      runnerAgentId: null,
      source: null,
      reason: "not_routine_execution",
    };
  }

  const executionState = parseIssueExecutionState(input.executionStateRaw);
  const returnAssignee = executionState?.returnAssignee ?? null;
  if (returnAssignee?.type === "agent" && returnAssignee.agentId) {
    return {
      runnerAgentId: returnAssignee.agentId,
      source: "execution_return_assignee",
      reason: "execution_return_assignee",
    };
  }

  if (input.routineAssigneeAgentId) {
    return {
      runnerAgentId: input.routineAssigneeAgentId,
      source: "routine_assignee",
      reason: "routine_assignee",
    };
  }

  if (input.assigneeAgentId) {
    return {
      runnerAgentId: input.assigneeAgentId,
      source: "issue_assignee",
      reason: "issue_assignee",
    };
  }

  return { runnerAgentId: null, source: null, reason: "no_runner" };
}
