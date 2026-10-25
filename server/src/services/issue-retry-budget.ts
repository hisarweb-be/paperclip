import { sql } from "drizzle-orm";

/** HIS-4580 (A1): a retry chain on one (agent, task) may not spend more than
 * this many automatic retries per window. The chain counter is scoped to the
 * task, not to one run, because a fresh chain in the same task was the leak
 * measured on HIS-3686 (10 of 24 retry runs had scheduledRetryAttempt = 0). */
export const ISSUE_RETRY_HOURLY_BUDGET_MAX_CHAINS = 3;
export const ISSUE_RETRY_HOURLY_BUDGET_WINDOW_MS = 60 * 60 * 1000;
export const ISSUE_RETRY_HOURLY_BUDGET_REASON = "issue_retry_hourly_budget";

/** Safety valve for the measured risk that 614 of 2591 refused retries had a
 * successful predecessor: only a chain whose predecessor is stranded spends
 * budget. A predecessor that is still running, queued or completed does not. */
const STRANDED_PREDECESSOR_STATUSES = ["failed", "cancelled", "timed_out"] as const;

type Executor = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

function firstRow(rows: unknown): Record<string, unknown> | null {
  const list = Array.isArray(rows) ? rows : [];
  const first = list[0];
  return first && typeof first === "object" ? first as Record<string, unknown> : null;
}

/**
 * Number of automatic retries granted for this (company, agent, task) inside
 * the window that started at `since`, counting only retries whose predecessor
 * ended in a stranded status. Covers both insertion routes: the bounded retry
 * (a `scheduled_retry` row) and the continuation wake (a generic run whose
 * `retryOfRunId` points at the stranded predecessor).
 */
export async function countIssueRetryChainsSince(
  executor: Executor,
  input: {
    companyId: string;
    agentId: string;
    issueId: string;
    since: Date;
    excludeRunId?: string | null;
  },
): Promise<number> {
  const rows = await executor.execute(sql`
    select count(*)::int as chains
    from heartbeat_runs retry
    join heartbeat_runs predecessor on predecessor.id = retry.retry_of_run_id
    where retry.company_id = ${input.companyId}
      and retry.agent_id = ${input.agentId}
      and retry.created_at >= ${input.since}
      and coalesce(
        retry.context_snapshot ->> 'issueId',
        retry.context_snapshot ->> 'taskId'
      ) = ${input.issueId}
      and coalesce(
        predecessor.context_snapshot ->> 'issueId',
        predecessor.context_snapshot ->> 'taskId'
      ) = ${input.issueId}
      and predecessor.status in (${sql.join(
        STRANDED_PREDECESSOR_STATUSES.map((status) => sql`${status}`),
        sql`, `,
      )})
      ${input.excludeRunId ? sql`and retry.id <> ${input.excludeRunId}` : sql``}
  `);
  const value = firstRow(rows)?.chains;
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}
