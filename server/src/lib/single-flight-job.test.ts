import { describe, expect, it, vi } from "vitest";
import { createSingleFlightJob } from "./single-flight-job.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSingleFlightJob", () => {
  it("skips new runs while the previous job is still pending", async () => {
    const flight = createSingleFlightJob();
    const gate = deferred<string>();
    const job = vi.fn(() => gate.promise);

    const first = flight.run(job);
    const second = flight.run(job);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(job).toHaveBeenCalledTimes(1);
    expect(flight.running).toBe(true);

    gate.resolve("done");
    await expect(first).resolves.toBe("done");
    expect(flight.running).toBe(false);
  });

  it("allows a new run after the previous job resolved", async () => {
    const flight = createSingleFlightJob();
    const job = vi.fn(async () => 1);

    await flight.run(job);
    const next = flight.run(job);

    expect(next).not.toBeNull();
    await expect(next).resolves.toBe(1);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it("releases the slot after the job rejects and propagates the error", async () => {
    const flight = createSingleFlightJob();
    const failing = flight.run(async () => {
      throw new Error("boom");
    });

    await expect(failing).rejects.toThrow("boom");
    expect(flight.running).toBe(false);
    await expect(flight.run(async () => "again")).resolves.toBe("again");
  });

  it("turns a synchronous throw into a rejected promise and releases the slot", async () => {
    const flight = createSingleFlightJob();
    const failing = flight.run(() => {
      throw new Error("sync boom");
    });

    await expect(failing).rejects.toThrow("sync boom");
    expect(flight.running).toBe(false);
  });

  it("keeps separate instances independent", () => {
    const a = createSingleFlightJob();
    const b = createSingleFlightJob();

    expect(a.run(() => new Promise(() => {}))).not.toBeNull();
    expect(b.run(() => new Promise(() => {}))).not.toBeNull();
  });
});
