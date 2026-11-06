import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { conversationRecoveryActionPredicate } from "./conversation-continuation.js";

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
});
