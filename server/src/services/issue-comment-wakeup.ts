export function shouldWakeAssigneeForIssueComment(input: {
  selfComment: boolean;
  resumeRequested: boolean;
  commentCreatedByRunId?: string | null;
  issueAtCommentStart: {
    checkoutRunId?: string | null;
    executionRunId?: string | null;
  };
  reopened: boolean;
  currentStatus: string | null | undefined;
  /** True when another agent (not a person) wrote the comment. */
  commentFromAgent?: boolean;
  /** Post-comment parking state; see `parkedIssueStateForAgentWake`. */
  issueParking?: IssueWakeParkingInput;
}) {
  const sourceRunId = input.commentCreatedByRunId;
  const commentIsFromCurrentIssueRun = Boolean(
    sourceRunId &&
    (sourceRunId === input.issueAtCommentStart.checkoutRunId ||
      sourceRunId === input.issueAtCommentStart.executionRunId),
  );
  if (
    input.selfComment &&
    (!input.resumeRequested || commentIsFromCurrentIssueRun)
  ) {
    return false;
  }
  if (input.reopened) return true;
  if (input.currentStatus === "done" || input.currentStatus === "cancelled") {
    return false;
  }
  // An agent nudging a parked issue starts a run that cannot deliver anything
  // until the parking condition changes. The comment stays on the issue for
  // whoever activates it. People and explicit resume requests always wake.
  if (
    input.commentFromAgent === true &&
    !input.resumeRequested &&
    input.issueParking &&
    parkedIssueStateForAgentWake(input.issueParking) !== null
  ) {
    return false;
  }
  return true;
}

export type IssueWakeParkingInput = {
  status: string | null | undefined;
  monitorNextCheckAt?: Date | string | null;
  /** Unresolved blockers; only consulted when the issue is blocked. */
  openBlockerCount?: number | null;
};

export type IssueWakeParkingState = "monitor" | "backlog" | "closed" | "blocked";

/**
 * Why an issue cannot make progress on an agent-initiated wake, or null when
 * it can: a future monitor check, backlog, closed, or blocked by unresolved
 * blockers. Pure, so both the comment path and the wake route share it.
 */
export function parkedIssueStateForAgentWake(
  issue: IssueWakeParkingInput,
  now: number = Date.now(),
): IssueWakeParkingState | null {
  const nextCheck = issue.monitorNextCheckAt
    ? new Date(issue.monitorNextCheckAt).getTime()
    : Number.NaN;
  if (Number.isFinite(nextCheck) && nextCheck > now) return "monitor";
  if (issue.status === "backlog") return "backlog";
  if (issue.status === "done" || issue.status === "cancelled") return "closed";
  if (issue.status === "blocked" && (issue.openBlockerCount ?? 0) > 0) {
    return "blocked";
  }
  return null;
}

/**
 * Loads the parking input for an issue. The blocker lookup only runs for a
 * blocked issue, so the common path costs no extra query.
 */
export async function loadIssueWakeParking(
  issues: {
    getRelationSummaries: (
      issueId: string,
    ) => Promise<{ blockedBy: Array<{ status: string }> }>;
  },
  issue: {
    id: string;
    status: string | null | undefined;
    monitorNextCheckAt?: Date | string | null;
  },
): Promise<IssueWakeParkingInput> {
  const openBlockerCount =
    issue.status === "blocked"
      ? (await issues.getRelationSummaries(issue.id)).blockedBy.filter(
          (blocker) => blocker.status !== "done" && blocker.status !== "cancelled",
        ).length
      : null;
  return {
    status: issue.status,
    monitorNextCheckAt: issue.monitorNextCheckAt ?? null,
    openBlockerCount,
  };
}
