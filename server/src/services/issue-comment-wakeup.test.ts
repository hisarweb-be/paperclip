import { describe, expect, it, vi } from "vitest";
import {
  loadIssueWakeParking,
  parkedIssueStateForAgentWake,
  shouldWakeAssigneeForIssueComment,
} from "./issue-comment-wakeup.js";

describe("shouldWakeAssigneeForIssueComment", () => {
  it("suppresses explicit resume from the run that currently owns the issue", () => {
    expect(
      shouldWakeAssigneeForIssueComment({
        selfComment: true,
        resumeRequested: true,
        commentCreatedByRunId: "run-current",
        issueAtCommentStart: {
          checkoutRunId: "run-current",
          executionRunId: "run-current",
        },
        reopened: false,
        currentStatus: "in_progress",
      }),
    ).toBe(false);
  });

  it("preserves explicit resume from a completed prior run", () => {
    expect(
      shouldWakeAssigneeForIssueComment({
        selfComment: true,
        resumeRequested: true,
        commentCreatedByRunId: "run-prior",
        issueAtCommentStart: {
          checkoutRunId: "run-current",
          executionRunId: "run-current",
        },
        reopened: false,
        currentStatus: "in_progress",
      }),
    ).toBe(true);
  });

  it("keeps ordinary self-comments inert", () => {
    expect(
      shouldWakeAssigneeForIssueComment({
        selfComment: true,
        resumeRequested: false,
        commentCreatedByRunId: "run-prior",
        issueAtCommentStart: {},
        reopened: false,
        currentStatus: "in_progress",
      }),
    ).toBe(false);
  });

  it("does not wake a closed issue unless the comment reopened it", () => {
    const base = {
      selfComment: false,
      resumeRequested: false,
      issueAtCommentStart: {},
      currentStatus: "done",
    };
    expect(
      shouldWakeAssigneeForIssueComment({ ...base, reopened: false }),
    ).toBe(false);
    expect(shouldWakeAssigneeForIssueComment({ ...base, reopened: true })).toBe(
      true,
    );
  });

  describe("agent comments on a parked issue", () => {
    const base = {
      selfComment: false,
      resumeRequested: false,
      issueAtCommentStart: {},
      reopened: false,
    };

    it("does not wake the assignee for an agent comment on a backlog issue", () => {
      expect(
        shouldWakeAssigneeForIssueComment({
          ...base,
          currentStatus: "backlog",
          commentFromAgent: true,
          issueParking: { status: "backlog" },
        }),
      ).toBe(false);
    });

    it("still wakes the assignee for a person's comment on the same issue", () => {
      expect(
        shouldWakeAssigneeForIssueComment({
          ...base,
          currentStatus: "backlog",
          commentFromAgent: false,
          issueParking: { status: "backlog" },
        }),
      ).toBe(true);
    });

    it("lets an explicit resume or a reopening comment through", () => {
      const parked = {
        ...base,
        currentStatus: "blocked",
        commentFromAgent: true,
        issueParking: { status: "blocked", openBlockerCount: 1 },
      };
      expect(shouldWakeAssigneeForIssueComment({ ...parked, resumeRequested: true })).toBe(true);
      expect(shouldWakeAssigneeForIssueComment({ ...parked, reopened: true })).toBe(true);
    });

    it("wakes the assignee for an agent comment on an active issue", () => {
      expect(
        shouldWakeAssigneeForIssueComment({
          ...base,
          currentStatus: "in_progress",
          commentFromAgent: true,
          issueParking: { status: "in_progress" },
        }),
      ).toBe(true);
    });
  });
});

describe("parkedIssueStateForAgentWake", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");

  it("classifies each parking condition", () => {
    expect(parkedIssueStateForAgentWake({ status: "todo", monitorNextCheckAt: "2026-11-08T13:00:00Z" }, now)).toBe("monitor");
    expect(parkedIssueStateForAgentWake({ status: "backlog" }, now)).toBe("backlog");
    expect(parkedIssueStateForAgentWake({ status: "done" }, now)).toBe("closed");
    expect(parkedIssueStateForAgentWake({ status: "cancelled" }, now)).toBe("closed");
    expect(parkedIssueStateForAgentWake({ status: "blocked", openBlockerCount: 2 }, now)).toBe("blocked");
  });

  it("does not park an issue that can make progress", () => {
    expect(parkedIssueStateForAgentWake({ status: "todo", monitorNextCheckAt: "2026-11-08T11:00:00Z" }, now)).toBeNull();
    expect(parkedIssueStateForAgentWake({ status: "in_progress" }, now)).toBeNull();
    expect(parkedIssueStateForAgentWake({ status: "blocked", openBlockerCount: 0 }, now)).toBeNull();
    expect(parkedIssueStateForAgentWake({ status: "blocked" }, now)).toBeNull();
  });
});

describe("loadIssueWakeParking", () => {
  it("counts only unresolved blockers, and only for a blocked issue", async () => {
    const getRelationSummaries = vi.fn(async () => ({
      blockedBy: [{ status: "todo" }, { status: "done" }, { status: "cancelled" }, { status: "in_progress" }],
    }));
    await expect(
      loadIssueWakeParking({ getRelationSummaries }, { id: "issue-1", status: "blocked" }),
    ).resolves.toEqual({ status: "blocked", monitorNextCheckAt: null, openBlockerCount: 2 });
    await expect(
      loadIssueWakeParking({ getRelationSummaries }, { id: "issue-1", status: "todo" }),
    ).resolves.toEqual({ status: "todo", monitorNextCheckAt: null, openBlockerCount: null });
    expect(getRelationSummaries).toHaveBeenCalledTimes(1);
  });
});
