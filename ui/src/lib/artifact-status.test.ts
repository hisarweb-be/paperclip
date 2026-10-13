import { describe, expect, it } from "vitest";
import type { CompanyArtifact } from "@/api/artifacts";
import {
  ARTIFACT_NEW_WINDOW_MS,
  artifactNeedsAttention,
  artifactStatus,
  summarizeArtifactStatuses,
} from "./artifact-status";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function artifact(overrides: Record<string, unknown> = {}): CompanyArtifact {
  return {
    id: "art-1",
    source: "attachment",
    mediaKind: "image",
    title: "Artifact",
    updatedAt: "2026-10-01T09:00:00.000Z",
    href: "/issues/HIS-123",
    ...overrides,
  } as CompanyArtifact;
}

function fresh(minutesAgo: number): string {
  return new Date(NOW - minutesAgo * 60 * 1000).toISOString();
}

describe("artifactStatus: red", () => {
  it.each(["failed", "interrupted", "cancelled"])(
    "marks a terminal turn %s as a failure that needs action",
    (state) => {
      const status = artifactStatus(artifact({ turnTerminalState: state }), NOW);
      expect(status?.tone).toBe("red");
      expect(status?.reason).toBe(`turnTerminalState=${state}`);
      expect(status?.label).toBeTruthy();
    },
  );

  it("reads the terminal state from a nested state object too", () => {
    expect(artifactStatus(artifact({ turnTerminalState: { state: "failed" } }), NOW)?.tone).toBe("red");
  });

  it.each(["error", "unhealthy"])("marks healthStatus %s as red", (state) => {
    expect(artifactStatus(artifact({ healthStatus: state }), NOW)?.reason).toBe(`healthStatus=${state}`);
  });

  it("wins over a pending review (one chip per card: red before orange)", () => {
    const status = artifactStatus(
      artifact({ turnTerminalState: "failed", reviewState: "pending", status: "active" }),
      NOW,
    );
    expect(status?.tone).toBe("red");
  });

  it("wins over a healthy, freshly created artifact", () => {
    const status = artifactStatus(
      artifact({ turnTerminalState: "failed", status: "active", createdAt: fresh(5) }),
      NOW,
    );
    expect(status?.tone).toBe("red");
  });
});

describe("artifactStatus: orange", () => {
  it.each([
    ["pending", "Te keuren"],
    ["revision_requested", "Herziening nodig"],
    ["changes_requested", "Herziening nodig"],
  ])("marks reviewState %s as work waiting on a human", (state, label) => {
    const status = artifactStatus(artifact({ reviewState: state }), NOW);
    expect(status?.tone).toBe("orange");
    expect(status?.label).toBe(label);
    expect(status?.reason).toBe(`reviewState=${state}`);
  });

  it("marks a blocker with an unblock action as orange", () => {
    const status = artifactStatus(
      artifact({ blocker: { scope: "turn", unblockAction: "retry" } }),
      NOW,
    );
    expect(status?.tone).toBe("orange");
    expect(status?.label).toBe("Actie nodig");
    expect(status?.reason).toBe("blocker=unblockAction");
  });

  it("accepts a boolean unblockAction flag", () => {
    expect(artifactStatus(artifact({ blocker: { scope: "turn", unblockAction: true } }), NOW)?.tone).toBe(
      "orange",
    );
  });

  it("does not invent orange for a blocker without scope or action", () => {
    expect(artifactStatus(artifact({ blocker: { reason: "network" } }), NOW)?.tone).toBe("grey");
    expect(artifactStatus(artifact({ blocker: { scope: "turn" } }), NOW)?.tone).toBe("grey");
  });

  it("wins over green for a fresh active artifact", () => {
    const status = artifactStatus(
      artifact({ status: "active", reviewState: "pending", createdAt: fresh(5) }),
      NOW,
    );
    expect(status?.tone).toBe("orange");
  });
});

describe("artifactStatus: green and grey", () => {
  it("marks a fresh active artifact without review as new", () => {
    const status = artifactStatus(
      artifact({ status: "active", reviewState: "none", createdAt: fresh(60) }),
      NOW,
    );
    expect(status).toEqual({ tone: "green", label: "Nieuw", reason: "status=active" });
  });

  it("treats a missing reviewState like none, but not an explicit other state", () => {
    expect(artifactStatus(artifact({ status: "active", createdAt: fresh(60) }), NOW)?.tone).toBe("green");
    expect(
      artifactStatus(artifact({ status: "active", reviewState: "approved", createdAt: fresh(60) }), NOW)
        ?.tone,
    ).toBe("grey");
  });

  it("turns grey once the 24 hour window has passed", () => {
    const status = artifactStatus(
      artifact({ status: "active", reviewState: "none", createdAt: fresh(60 * 25) }),
      NOW,
    );
    expect(status?.tone).toBe("grey");
    expect(status?.reason).toBe("archived");
    expect(ARTIFACT_NEW_WINDOW_MS).toBe(24 * HOUR_MS);
  });

  it("calls a fresh artifact with no active status recent", () => {
    const status = artifactStatus(artifact({ createdAt: fresh(30) }), NOW);
    expect(status).toEqual({ tone: "grey", label: "Recent", reason: "recently-created" });
  });

  it("calls an old artifact without a status archived", () => {
    expect(artifactStatus(artifact({ createdAt: fresh(60 * 24 * 10) }), NOW)?.label).toBe("Archief");
  });

  it("treats a future createdAt as not new rather than as new", () => {
    const status = artifactStatus(artifact({ status: "active", createdAt: fresh(-60) }), NOW);
    expect(status?.tone).toBe("grey");
    expect(status?.reason).toBe("archived");
  });
});

describe("artifactStatus: no metadata", () => {
  it("returns null for pre-projection payloads instead of guessing", () => {
    expect(artifactStatus(artifact(), NOW)).toBeNull();
    expect(artifactStatus(artifact({ updatedAt: "2026-10-13T11:59:00.000Z" }), NOW)).toBeNull();
    expect(artifactStatus(artifact({ status: null, reviewState: null, turnTerminalState: null }), NOW)).toBeNull();
  });

  it("does show a chip when only createdAt is present", () => {
    expect(artifactStatus(artifact({ createdAt: fresh(10) }), NOW)).not.toBeNull();
  });
});

describe("artifactNeedsAttention", () => {
  it("is true for red and orange, false for the rest", () => {
    expect(artifactNeedsAttention(artifact({ turnTerminalState: "failed" }), NOW)).toBe(true);
    expect(artifactNeedsAttention(artifact({ reviewState: "pending" }), NOW)).toBe(true);
    expect(artifactNeedsAttention(artifact({ status: "active", createdAt: fresh(10) }), NOW)).toBe(false);
    expect(artifactNeedsAttention(artifact(), NOW)).toBe(false);
  });
});

describe("summarizeArtifactStatuses", () => {
  const list = [
    artifact({ id: "a", title: "Zulu failed", turnTerminalState: "failed" }),
    artifact({ id: "b", title: "Alpha failed", turnTerminalState: "failed" }),
    artifact({ id: "c", title: "Needs review", reviewState: "pending" }),
    artifact({ id: "d", title: "Brand new", status: "active", createdAt: fresh(10) }),
    artifact({ id: "e", title: "Old", createdAt: fresh(60 * 24 * 5) }),
    artifact({ id: "f", title: "No metadata" }),
  ];

  it("counts each tone and ignores artifacts without metadata", () => {
    const summary = summarizeArtifactStatuses(list, NOW);
    expect(summary.red).toBe(2);
    expect(summary.orange).toBe(1);
    expect(summary.green).toBe(1);
    expect(summary.grey).toBe(1);
    expect(summary.total).toBe(6);
  });

  it("lists what needs action, red before orange, then by title", () => {
    const summary = summarizeArtifactStatuses(list, NOW);
    expect(summary.attention.map((entry) => entry.artifact.id)).toEqual(["b", "a", "c"]);
    expect(summary.attention.map((entry) => entry.status.tone)).toEqual(["red", "red", "orange"]);
  });

  it("returns an empty summary for an empty list", () => {
    expect(summarizeArtifactStatuses([], NOW)).toEqual({
      red: 0,
      orange: 0,
      green: 0,
      grey: 0,
      total: 0,
      attention: [],
    });
  });
});
