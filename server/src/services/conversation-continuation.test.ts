import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { conversationRecoveryActionPredicate, getConversationOwnershipBlocker } from "./conversation-continuation.js";

// HIS-7401: the run lookup inside the predicate used to compare text to text
// (`heartbeat_runs.id::text = evidence->>'runId'`). Postgres cannot use the uuid
// primary key for that, so the EXISTS had to be answered from a text index over
// the whole id column instead of by primary key. These cases pin the new shape.
describe("conversationRecoveryActionPredicate run lookup", () => {
  const rendered = new PgDialect().sqlToQuery(conversationRecoveryActionPredicate()!).sql;

  it("compares the run id in uuid form so the primary key stays usable", () => {
    expect(rendered).toContain(`"heartbeat_runs"."id" = case`);
    expect(rendered).toContain(`)::uuid`);
    expect(rendered).not.toContain(`"heartbeat_runs"."id"::text`);
  });

  it("compares the issue id in uuid form too", () => {
    expect(rendered).not.toContain(`"native_issue_id"::text`);
    expect(rendered).not.toContain(`"source_issue_id"::text`);
  });

  it("keeps the runtime mode and cause filters that define a conversation hold", () => {
    expect(rendered).toContain(`"heartbeat_runs"."runtime_mode" = 'legacy'`);
    expect(rendered).toContain(`"issue_recovery_actions"."cause" =`);
  });

  it("guards both casts so a malformed stored value yields null instead of an error", () => {
    // One regex guard in front of each of the two casts: the run id and the fallback issue id.
    expect(rendered.match(/~ \$/g) ?? []).toHaveLength(2);
  });

  it("keeps the restore_unsafe_archive exemption: such a run never retires a conversation hold", () => {
    expect(rendered).toContain(`->>'workspaceRestoreFailure'`);
    expect(rendered).toContain(`<> 'restore_unsafe_archive'`);
  });
});

// HIS-7513: `coalesce(native_issue_id::text, context_snapshot->>'issueId') = $1` was not sargable and
// ran as a Parallel Seq Scan over heartbeat_runs on every conversation turn (498.970 ms on bureau-01).
// The lookup is now split into two indexable halves. These cases pin that split, because a silent
// return to the coalesce form would reintroduce the full-table scan without failing any other test.
describe("getConversationOwnershipBlocker issue lookup", () => {
  const companyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const issueId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  async function blockerWhere(): Promise<SQL> {
    let captured: SQL | undefined;
    const db = {
      select() {
        return {
          from() {
            return {
              where(condition: SQL) {
                captured = condition;
                return { orderBy: () => Promise.resolve([]) };
              },
            };
          },
        };
      },
    } as unknown as Db;
    await getConversationOwnershipBlocker(db, companyId, issueId);
    if (!captured) throw new Error("getConversationOwnershipBlocker ran no query");
    return captured;
  }

  it("splits the issue lookup into the two indexable halves", async () => {
    const sql = new PgDialect().sqlToQuery(await blockerWhere()).sql;
    // native_issue_id is compared as a uuid column, not as text.
    expect(sql).toContain(`"heartbeat_runs"."native_issue_id" = $`);
    expect(sql).not.toContain(`"native_issue_id"::text`);
    // The fallback half only applies where native_issue_id is null, which is exactly what coalesce meant.
    expect(sql).toContain(`"heartbeat_runs"."native_issue_id" is null`);
    expect(sql).toContain(`"heartbeat_runs"."context_snapshot"->>'issueId' = $`);
    // The blanket coalesce that forced the scan is gone.
    expect(sql).not.toMatch(/coalesce\(\s*"heartbeat_runs"\."native_issue_id"/);
  });

  it("keeps the terminal-status, legacy-mode and liveness filters", async () => {
    const sql = new PgDialect().sqlToQuery(await blockerWhere()).sql;
    expect(sql).toContain(`"heartbeat_runs"."company_id" = $`);
    expect(sql).toContain(`"heartbeat_runs"."runtime_mode" = $`);
    expect(sql).toContain(`"heartbeat_runs"."status" in (`);
    expect(sql).toContain(`"heartbeat_runs"."process_pid" is not null`);
    expect(sql).toContain(`"heartbeat_runs"."process_group_id" is not null`);
    expect(sql).toContain(`"environment_leases"."heartbeat_run_id" = "heartbeat_runs"."id"`);
  });
});
