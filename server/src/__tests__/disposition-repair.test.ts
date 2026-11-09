import { describe, expect, it } from "vitest";
import { ISSUE_RECOVERY_ACTION_KINDS } from "@paperclipai/shared";
import { classifyContinuationFailure } from "../services/recovery/service.ts";
import {
  DISPOSITION_REPAIR_BASE_DELAYS_MS,
  DISPOSITION_REPAIR_MAX_ATTEMPTS,
  DISPOSITION_REPAIR_COOLDOWN_MS,
  dispositionRepairCooldownActive,
  dispositionRepairDelayMs,
  magWekkenDispositie,
  dispositionRepairTaskKey,
  dispositionRepairWindowActive,
  DISPOSITION_REPAIR_WAKE_WINDOW_MS,
} from "../services/recovery/disposition-repair.ts";

const deliberateWaitRun = {
  id: "run-1",
  agentId: "agent-1",
  status: "cancelled" as const,
  error: "Continuation parked",
  errorCode: "issue_continuation_waiting_on_review",
  contextSnapshot: {},
  livenessState: null,
  startedAt: new Date("2026-08-11T00:00:00.000Z"),
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
};

describe("owner-sticky disposition repair", () => {
  it("classifies a deliberate wait without a target into its dedicated bounded lane", () => {
    expect(ISSUE_RECOVERY_ACTION_KINDS).toContain("deliberate_wait_without_target");
    expect(classifyContinuationFailure(deliberateWaitRun)).toEqual({
      kind: "deliberate_wait_without_target",
      maxAttempts: 5,
      baseBackoffMs: 60_000,
      errorCode: "issue_continuation_waiting_on_review",
    });
  });

  it("uses the persisted five-attempt owner-sticky schedule with bounded deterministic jitter", () => {
    const fingerprint = "disposition_repair:v1:example";
    const timings = [1, 2, 3, 4, 5].map((attempt) => dispositionRepairDelayMs(attempt, fingerprint));

    expect(DISPOSITION_REPAIR_MAX_ATTEMPTS).toBe(5);
    expect(DISPOSITION_REPAIR_BASE_DELAYS_MS).toEqual([0, 60_000, 120_000, 240_000, 480_000]);
    expect(timings[0]).toEqual({ baseDelayMs: 0, jitterMs: 0, delayMs: 0 });
    expect(timings[1]?.baseDelayMs).toBe(60_000);
    expect(timings[1]?.jitterMs).toBeGreaterThanOrEqual(0);
    expect(timings[1]?.jitterMs).toBeLessThanOrEqual(6_000);
    expect(timings[2]?.baseDelayMs).toBe(120_000);
    expect(timings[2]?.jitterMs).toBeGreaterThanOrEqual(0);
    expect(timings[2]?.jitterMs).toBeLessThanOrEqual(12_000);
    expect(timings[3]?.baseDelayMs).toBe(240_000);
    expect(timings[3]?.jitterMs).toBeLessThanOrEqual(24_000);
    expect(timings[4]?.baseDelayMs).toBe(480_000);
    expect(timings[4]?.jitterMs).toBeLessThanOrEqual(48_000);
    expect(dispositionRepairDelayMs(2, fingerprint)).toEqual(timings[1]);
    expect(() => dispositionRepairDelayMs(6, fingerprint)).toThrow(/Invalid disposition repair attempt/);
  });
});

describe("disposition repair per-issue cooldown", () => {
  const now = new Date("2026-11-09T10:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("defers a fresh-fingerprint first attempt when the issue got a repair wake within 15 minutes", () => {
    expect(DISPOSITION_REPAIR_COOLDOWN_MS).toBe(15 * 60_000);
    expect(dispositionRepairCooldownActive({ sameFingerprintAttempt: 0, lastRepairWakeAt: ago(60_000), now })).toBe(true);
  });

  it("allows the wake once the window has passed or when there was no earlier wake", () => {
    expect(dispositionRepairCooldownActive({ sameFingerprintAttempt: 0, lastRepairWakeAt: ago(15 * 60_000), now })).toBe(false);
    expect(dispositionRepairCooldownActive({ sameFingerprintAttempt: 0, lastRepairWakeAt: null, now })).toBe(false);
  });

  it("never blocks the bounded retries of the same fingerprint", () => {
    expect(dispositionRepairCooldownActive({ sameFingerprintAttempt: 1, lastRepairWakeAt: ago(1_000), now })).toBe(false);
    expect(dispositionRepairCooldownActive({ sameFingerprintAttempt: 4, lastRepairWakeAt: ago(1_000), now })).toBe(false);
  });

  it("ignores a wake timestamp in the future (clock skew)", () => {
    expect(dispositionRepairCooldownActive({ sameFingerprintAttempt: 0, lastRepairWakeAt: new Date(now.getTime() + 5_000), now })).toBe(false);
  });
});

describe("HIS-8150 disposition repair wake gate", () => {
  const reason = "issue_disposition_repair";

  it("drops a disposition repair wake without a task key and never persists it", () => {
    for (const contextSnapshot of [null, undefined, {}, { taskKey: null }, { taskKey: "" }, { taskKey: "   " }]) {
      expect(magWekkenDispositie({ wakeReason: reason, contextSnapshot, payload: {} })).toEqual({
        mag: false,
        reden: "geen taakcontext",
        taak: null,
      });
    }
    expect(dispositionRepairTaskKey({ contextSnapshot: { taskKey: null } })).toBeNull();
  });

  it("lets a real task through, also through the payload fallback", () => {
    expect(magWekkenDispositie({ wakeReason: reason, contextSnapshot: { taskKey: "issue-1" }, payload: {} }).mag).toBe(true);
    expect(dispositionRepairTaskKey({ contextSnapshot: { contextSnapshot: { taskKey: "issue-2" } } })).toBe("issue-2");
    expect(magWekkenDispositie({ wakeReason: reason, payload: { taskId: "issue-3" } })).toMatchObject({ mag: true, taak: "issue-3" });
    expect(magWekkenDispositie({ wakeReason: reason, payload: { taskKey: " issue-4 " } }).taak).toBe("issue-4");
  });

  it("does not touch any other wake reason", () => {
    expect(magWekkenDispositie({ wakeReason: "heartbeat", contextSnapshot: {} })).toMatchObject({ mag: true });
    expect(magWekkenDispositie({ wakeReason: null }).mag).toBe(true);
  });

  it("follows the per-company switch so it can be rolled back without a deploy", () => {
    expect(magWekkenDispositie({ wakeReason: reason, contextSnapshot: {}, switchOn: true }).mag).toBe(false);
    expect(magWekkenDispositie({ wakeReason: reason, contextSnapshot: {}, switchOn: false }).mag).toBe(true);
  });

  it("allows at most one wake per issue per six hours, a new fingerprint still gets one", () => {
    const now = new Date("2026-11-09T10:00:00.000Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(DISPOSITION_REPAIR_WAKE_WINDOW_MS).toBe(6 * 60 * 60_000);
    expect(magWekkenDispositie({ wakeReason: reason, contextSnapshot: { taskKey: "i" }, now, lastWakeAt: ago(60 * 60_000) })).toMatchObject({ mag: false });
    expect(magWekkenDispositie({ wakeReason: reason, contextSnapshot: { taskKey: "i" }, now, lastWakeAt: ago(6 * 60 * 60_000) }).mag).toBe(true);
    expect(magWekkenDispositie({ wakeReason: reason, contextSnapshot: { taskKey: "i" }, now, lastWakeAt: null }).mag).toBe(true);
    expect(dispositionRepairWindowActive({ newlyWokenFingerprint: true, lastWakeAt: ago(60 * 60_000), now })).toBe(false);
    expect(dispositionRepairWindowActive({ newlyWokenFingerprint: false, lastWakeAt: ago(60 * 60_000), now })).toBe(true);
    expect(dispositionRepairWindowActive({ newlyWokenFingerprint: false, lastWakeAt: ago(6 * 60 * 60_000), now })).toBe(false);
  });
});
