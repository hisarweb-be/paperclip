import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyPendingMigrations, inspectMigrations } from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION = "0375_hisarweb_patches.sql";
const INDEXES = [
  "agent_wakeup_requests_company_payload_task_idx",
  "agent_wakeup_requests_company_wakectx_issue_idx",
  "agent_wakeup_requests_company_wakectx_task_idx",
  "heartbeat_runs_open_issue_idx",
  "heartbeat_runs_recovery_action_idx",
  "heartbeat_runs_queued_comment_interrupt_idx",
] as const;

// The two indexes production already built by hand, in the exact form of
// plugins/bureau-server/db-index.sh (unquoted, different spacing).
const HAND_BUILT = [
  "create index if not exists heartbeat_runs_open_issue_idx on heartbeat_runs (company_id, (context_snapshot->>'issueId')) where status in ('queued','running','scheduled_retry')",
  "create index if not exists heartbeat_runs_recovery_action_idx on heartbeat_runs (company_id, (context_snapshot->>'recoveryActionId'))",
];

const cleanups: Array<() => Promise<void>> = [];
const support = await getEmbeddedPostgresTestSupport();
const d = support.supported ? describe : describe.skip;

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function indexState(sql: ReturnType<typeof postgres>) {
  const rows = await sql<{ name: string; oid: number; valid: boolean }[]>`
    SELECT c.relname AS name, c.oid::int AS oid, i.indisvalid AS valid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ${sql(INDEXES as unknown as string[])}`;
  return new Map(rows.map((row) => [row.name, row]));
}

d("0375 HisarWeb patch indexes migration", () => {
  it("rolls forward over a production history with a foreign fork row and hand-built indexes", async () => {
    const dbh = await startEmbeddedPostgresTestDatabase("hisarweb-0375-");
    cleanups.push(() => dbh.cleanup());
    const sql = postgres(dbh.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => { await sql.end(); });

    // A fresh database gets all six indexes, valid.
    const fresh = await indexState(sql);
    expect([...fresh.keys()].sort()).toEqual([...INDEXES].sort());
    expect([...fresh.values()].every((row) => row.valid)).toBe(true);

    // Rebuild the production starting point: 0375 not applied, its indexes
    // partly present by hand, and the newest history row belongs to the old
    // fork migration 0355_yummy_preak, whose file no longer exists.
    const content = await readFile(fileURLToPath(new URL(`./migrations/${MIGRATION}`, import.meta.url)), "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    for (const name of INDEXES) await sql.unsafe(`DROP INDEX IF EXISTS "${name}"`);
    await sql`DELETE FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`;
    const foreignHash = createHash("sha256").update("fork 0355_yummy_preak").digest("hex");
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT ${foreignHash}, max(created_at) + 1 FROM drizzle.__drizzle_migrations`;
    for (const statement of HAND_BUILT) await sql.unsafe(statement);
    // A cancelled concurrent build leaves an invalid index behind.
    await sql.unsafe(
      `create index agent_wakeup_requests_company_wakectx_issue_idx on agent_wakeup_requests (company_id, ((payload -> '_paperclipWakeContext') ->> 'issueId'))`,
    );
    await sql.unsafe(
      `UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.agent_wakeup_requests_company_wakectx_issue_idx'::regclass`,
    );
    const before = await indexState(sql);

    const state = await inspectMigrations(dbh.connectionString);
    expect(state.status).toBe("needsMigrations");
    expect(state.status === "needsMigrations" ? state.pendingMigrations : []).toEqual([MIGRATION]);

    await applyPendingMigrations(dbh.connectionString);

    const after = await indexState(sql);
    expect([...after.keys()].sort()).toEqual([...INDEXES].sort());
    expect([...after.values()].every((row) => row.valid)).toBe(true);
    // Valid hand-built indexes are left alone, the invalid one is rebuilt.
    expect(after.get("heartbeat_runs_open_issue_idx")?.oid).toBe(before.get("heartbeat_runs_open_issue_idx")?.oid);
    expect(after.get("heartbeat_runs_recovery_action_idx")?.oid).toBe(before.get("heartbeat_runs_recovery_action_idx")?.oid);
    expect(after.get("agent_wakeup_requests_company_wakectx_issue_idx")?.oid)
      .not.toBe(before.get("agent_wakeup_requests_company_wakectx_issue_idx")?.oid);

    expect((await inspectMigrations(dbh.connectionString)).status).toBe("upToDate");
    await applyPendingMigrations(dbh.connectionString);
    const history = await sql<{ hash: string }[]>`
      SELECT hash FROM drizzle.__drizzle_migrations WHERE hash IN (${hash}, ${foreignHash})`;
    expect(history.map((row) => row.hash).sort()).toEqual([hash, foreignHash].sort());

    // The planner can use the new lookups instead of a full scan.
    await sql.unsafe("SET enable_seqscan = off");
    const company = "00000000-0000-0000-0000-000000000001";
    const plans: Array<[string, string]> = [
      ["heartbeat_runs_open_issue_idx", `SELECT id FROM heartbeat_runs WHERE company_id = '${company}' AND context_snapshot ->> 'issueId' = 'x' AND status IN ('queued', 'running')`],
      ["heartbeat_runs_recovery_action_idx", `SELECT id FROM heartbeat_runs WHERE company_id = '${company}' AND context_snapshot ->> 'recoveryActionId' = 'x'`],
      ["heartbeat_runs_queued_comment_interrupt_idx", `SELECT id FROM heartbeat_runs WHERE result_json ->> 'queuedCommentInterruptQueueId' = 'x'`],
      ["agent_wakeup_requests_company_payload_task_idx", `SELECT id FROM agent_wakeup_requests WHERE company_id = '${company}' AND payload ->> 'taskId' = 'x'`],
      ["agent_wakeup_requests_company_wakectx_task_idx", `SELECT id FROM agent_wakeup_requests WHERE company_id = '${company}' AND payload -> '_paperclipWakeContext' ->> 'taskId' = 'x'`],
    ];
    for (const [index, query] of plans) {
      const plan = await sql.unsafe(`EXPLAIN ${query}`);
      expect(plan.map((row) => Object.values(row)[0]).join("\n")).toContain(index);
    }
  }, 240_000);
});

