import { describe, expect, it } from "vitest";
import type { CompanyArtifact } from "@/api/artifacts";
import { stateChipFor } from "@/lib/state-chip";
import {
  ARTIFACT_STATUS_PRIORITY,
  artifactNeedsAttention,
  artifactStatus,
  summarizeArtifactStatuses,
} from "./artifact-status";

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

/**
 * The point of this file (HIS-2659): the artifacts page does not own a status
 * vocabulary. Everything below is expressed as "whatever the house mapper says
 * for the same inputs", so a change in `stateChipFor` cannot silently leave the
 * artifacts page speaking a second language.
 */
describe("artifactStatus speaks the house vocabulary", () => {
  it.each([
    [{ status: "failed" }, "failure"],
    [{ status: "unhealthy" }, "failure"],
    [{ status: "down" }, "failure"],
    [{ status: "changes_requested" }, "failure"],
    [{ reviewState: "changes_requested" }, "failure"],
    [{ status: "ready_for_review" }, "review"],
    [{ reviewState: "needs_board_review" }, "review"],
    [{ status: "pending" }, "progress"],
    [{ status: "opening" }, "progress"],
  ])("agrees with stateChipFor for %j", (overrides, tone) => {
    const input = artifact(overrides);
    const own = artifactStatus(input);
    const house = stateChipFor(
      "artifact",
      String((overrides as Record<string, unknown>).status ?? ""),
      ((overrides as Record<string, unknown>).reviewState as string) ?? "none",
    );
    expect(own?.tone).toBe(tone);
    expect(house?.tone).toBe(tone);
    expect(own?.label).toBe(house?.label);
    expect(own?.dashed).toBe(house?.dashed);
  });

  it("reads an unhealthy healthStatus as the failure the house mapper gives it", () => {
    const status = artifactStatus(artifact({ healthStatus: "unhealthy" }));
    expect(status).toEqual({ tone: "failure", label: "Failed", reason: "healthStatus=unhealthy" });
  });

  it("keeps a healthy healthStatus from inventing a chip", () => {
    expect(artifactStatus(artifact({ healthStatus: "healthy" }))).toBeNull();
  });

  it("uses no private red/orange/green/grey tone names", () => {
    expect(ARTIFACT_STATUS_PRIORITY).toEqual(["failure", "review", "progress", "success", "neutral"]);
    for (const value of ["red", "orange", "green", "grey"]) {
      expect(ARTIFACT_STATUS_PRIORITY as readonly string[]).not.toContain(value);
    }
  });

  it("uses no label of its own next to the house vocabulary", () => {
    // The rejected route carried Dutch labels (`Gefaald`, `Te keuren`, `Nieuw`,
    // `Archief`). Every label we can render must be one the house mapper emits.
    const labels = [
      artifact({ status: "failed" }),
      artifact({ status: "ready_for_review" }),
      artifact({ status: "pending" }),
      artifact({ reviewState: "changes_requested" }),
      artifact({ status: "unhealthy" }),
    ].map((input) => artifactStatus(input)?.label);
    for (const label of labels) {
      expect(["Failed", "Review", "Pending", "Opening", "Changes requested"]).toContain(label);
    }
  });

  it("gives an approved artifact no chip, exactly like the house mapper", () => {
    // In the house vocabulary an approved work product stays quiet.
    expect(stateChipFor("artifact", "approved", "approved")).toBeNull();
    expect(artifactStatus(artifact({ status: "approved", reviewState: "approved" }))).toBeNull();
  });

  it("gives an artifact the projection left empty no chip", () => {
    // The measured reality on the live route (HIS-2659 review): 0 of 100 rows
    // carry any status field. "Geen chip" is the approved result there.
    expect(artifactStatus(artifact())).toBeNull();
    expect(artifactStatus(artifact({ status: null, reviewState: null, healthStatus: null }))).toBeNull();
  });

  it("reads a nested state object too", () => {
    expect(artifactStatus(artifact({ status: { state: "failed" } }))?.tone).toBe("failure");
  });

  it("shows one chip at most, in the house mapper's own precedence order", () => {
    // `stateChipFor` checks the review states before the failed/unhealthy ones,
    // so where both are set the review wins. We inherit that order rather than
    // inventing a second one; the tests below pin it so a change there is loud.
    const pendingReview = artifactStatus(
      artifact({ status: "pending", reviewState: "needs_board_review" }),
    );
    expect(pendingReview?.tone).toBe("review");
    expect(pendingReview?.reason).toBe("reviewState=needs_board_review");

    const bothSet = artifactStatus(artifact({ status: "failed", reviewState: "needs_board_review" }));
    expect(bothSet?.tone).toBe("review");
    expect(bothSet?.reason).toBe("reviewState=needs_board_review");

    // With no review state set — the shape the projection actually produces —
    // a failed artifact is a failure, which is acceptance criterion (c).
    const failed = artifactStatus(artifact({ status: "failed" }));
    expect(failed?.tone).toBe("failure");
    expect(failed?.reason).toBe("status=failed");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(artifactStatus(artifact({ status: " FAILED " }))?.tone).toBe("failure");
  });
});

describe("artifactNeedsAttention", () => {
  it("is true for failure and review, false for the quiet tones", () => {
    expect(artifactNeedsAttention(artifact({ status: "failed" }))).toBe(true);
    expect(artifactNeedsAttention(artifact({ status: "ready_for_review" }))).toBe(true);
    expect(artifactNeedsAttention(artifact({ status: "pending" }))).toBe(false);
    expect(artifactNeedsAttention(artifact({ status: "approved" }))).toBe(false);
    expect(artifactNeedsAttention(artifact())).toBe(false);
  });
});

describe("summarizeArtifactStatuses", () => {
  it("counts failures and reviews and ignores artifacts without a chip", () => {
    const summary = summarizeArtifactStatuses([
      artifact({ id: "a", status: "failed" }),
      artifact({ id: "b", status: "failed" }),
      artifact({ id: "c", status: "ready_for_review" }),
      artifact({ id: "d", status: "pending" }),
      artifact({ id: "e" }),
    ]);
    expect(summary.failure).toBe(2);
    expect(summary.review).toBe(1);
    expect(summary.total).toBe(5);
  });

  it("lists what needs action, failures before reviews, then by title", () => {
    const summary = summarizeArtifactStatuses([
      artifact({ id: "a", title: "Zulu", status: "ready_for_review" }),
      artifact({ id: "b", title: "Alpha", status: "failed" }),
      artifact({ id: "c", title: "Bravo", status: "failed" }),
    ]);
    expect(summary.attention.map((entry) => entry.status.tone)).toEqual(["failure", "failure", "review"]);
    expect(summary.attention.map((entry) => entry.artifact.title)).toEqual(["Alpha", "Bravo", "Zulu"]);
  });

  it("is empty when the projection carries no status fields", () => {
    const summary = summarizeArtifactStatuses([artifact({ id: "a" }), artifact({ id: "b" })]);
    expect(summary.failure).toBe(0);
    expect(summary.review).toBe(0);
    expect(summary.attention).toEqual([]);
  });
});
