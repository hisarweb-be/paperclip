import { describe, expect, it } from "vitest";
import {
  LEASE_CANCELLATION_ERROR_CODE,
  isLeaseCancelledRun,
  isRunSucceededForRecovery,
} from "./run-outcome.js";

// Evidence for CEO decision 21 Oct 2026 (HIS-3597 q2): runs 1c817393 and
// b16fa1b8 ended with exitCode 0, subtype "success", resultJson.is_error false,
// yet the legacy-controller lease closed them as cancelled with
// errorCode "cancelled_controller_lease_lost".

const cleanResult = {
  is_error: false,
  subtype: "success",
  leaseCancellation: {
    reason: "controller_lease_expired",
    bootId: "231060ec-4507-44bf-b432-5380a922482f",
  },
};

describe("isRunSucceededForRecovery", () => {
  it("accepts a plain succeeded run", () => {
    expect(isRunSucceededForRecovery({ status: "succeeded" })).toBe(true);
  });

  it("accepts a lease-cancelled run stamped via errorCode", () => {
    expect(
      isRunSucceededForRecovery({
        status: "cancelled",
        errorCode: LEASE_CANCELLATION_ERROR_CODE,
        resultJson: cleanResult,
      }),
    ).toBe(true);
  });

  it("accepts a lease-cancelled run stamped only in resultJson", () => {
    expect(
      isRunSucceededForRecovery({
        status: "cancelled",
        errorCode: "cancelled",
        resultJson: cleanResult,
      }),
    ).toBe(true);
  });

  it("rejects an ordinary cancelled run", () => {
    expect(
      isRunSucceededForRecovery({
        status: "cancelled",
        errorCode: "cancelled",
        resultJson: { is_error: false, subtype: "success" },
      }),
    ).toBe(false);
  });

  it.each(["failed", "interrupted", "timed_out", "running", "queued"])(
    "rejects status %s",
    (status) => {
      expect(isRunSucceededForRecovery({ status })).toBe(false);
    },
  );

  it("rejects a missing run", () => {
    expect(isRunSucceededForRecovery(null)).toBe(false);
    expect(isRunSucceededForRecovery(undefined)).toBe(false);
  });

  it("tolerates malformed resultJson", () => {
    expect(
      isRunSucceededForRecovery({ status: "cancelled", resultJson: "not-json" }),
    ).toBe(false);
    expect(
      isRunSucceededForRecovery({ status: "cancelled", resultJson: ["a"] }),
    ).toBe(false);
  });
});

describe("isLeaseCancelledRun", () => {
  it("ignores cancelled runs without the lease stamp", () => {
    expect(isLeaseCancelledRun({ status: "cancelled", errorCode: "operator_interrupted" })).toBe(false);
  });

  it("does not treat a succeeded run as lease-cancelled", () => {
    expect(
      isLeaseCancelledRun({
        status: "succeeded",
        errorCode: LEASE_CANCELLATION_ERROR_CODE,
      }),
    ).toBe(false);
  });
});
