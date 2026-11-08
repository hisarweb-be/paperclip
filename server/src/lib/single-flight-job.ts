/**
 * A job runner that allows at most one execution at a time. While a job started through
 * `run` is still pending, further `run` calls do not start the job and return `null`, so
 * a periodic caller can skip a tick instead of stacking overlapping executions.
 *
 * Unlike a keyed promise cache, callers that are skipped do not share the running
 * promise: they get `null` and decide themselves what to do (for example log and move on).
 */
export interface SingleFlightJob {
  /** True while a job started through `run` has not settled yet. */
  readonly running: boolean;
  /** Starts `job` unless one is already running; returns its promise, or `null` when skipped. */
  run<T>(job: () => Promise<T> | T): Promise<T> | null;
}

export function createSingleFlightJob(): SingleFlightJob {
  let current: Promise<unknown> | null = null;
  return {
    get running() {
      return current !== null;
    },
    run<T>(job: () => Promise<T> | T): Promise<T> | null {
      if (current) return null;
      let pending: Promise<T>;
      try {
        pending = Promise.resolve(job());
      } catch (error) {
        pending = Promise.reject(error);
      }
      const tracked = pending.finally(() => {
        if (current === tracked) current = null;
      });
      current = tracked;
      return tracked;
    },
  };
}
