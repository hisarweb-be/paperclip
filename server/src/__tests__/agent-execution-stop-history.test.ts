import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, type Db } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentExecutionsHaveStopped, STOPPED_RUN_EVIDENCE_WINDOW_MS } from "../services/agent-execution-stop.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("agent stop evidence over run history", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("agent-stop-history-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterEach(async () => { await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL client_min_messages = warning`);
    await tx.execute(sql`TRUNCATE companies CASCADE`);
  }); });
  afterAll(async () => { await db?.$client.end({ timeout: 0 }); await database?.cleanup(); });

  const longAgo = () => new Date(Date.now() - STOPPED_RUN_EVIDENCE_WINDOW_MS - 60 * 60 * 1000);

  async function seed() {
    const companyId = randomUUID(), agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Stop history", issuePrefix: "STH" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", role: "engineer", status: "paused", adapterType: "process" });
    return { companyId, agentId };
  }

  // A cancelled legacy run without process, lease or acknowledgement evidence
  // keeps an agent stopping while it can still matter.
  function cancelledWithoutStopProof(companyId: string, agentId: string, updatedAt: Date) {
    return { id: randomUUID(), companyId, agentId, invocationSource: "on_demand", status: "cancelled",
      startedAt: updatedAt, createdAt: updatedAt, updatedAt };
  }

  it("still requires stop proof for a recently cancelled run", async () => {
    const { companyId, agentId } = await seed();
    await db.insert(heartbeatRuns).values(cancelledWithoutStopProof(companyId, agentId, new Date()));
    expect(await agentExecutionsHaveStopped(db, [agentId])).toBe(false);
  });

  it("does not re-read terminal runs that settled before the evidence window", async () => {
    const { companyId, agentId } = await seed();
    await db.insert(heartbeatRuns).values(cancelledWithoutStopProof(companyId, agentId, longAgo()));
    await db.insert(heartbeatRuns).values(Array.from({ length: 20 }, () => ({ id: randomUUID(), companyId, agentId,
      invocationSource: "on_demand", status: "succeeded", contextSnapshot: { payload: "x".repeat(4096) },
      createdAt: longAgo(), updatedAt: longAgo() })));
    const queries: string[] = [];
    const recorded = drizzle(db.$client, { schema: db._.fullSchema, logger: { logQuery: query => queries.push(query) } }) as unknown as Db;
    expect(await agentExecutionsHaveStopped(recorded, [agentId])).toBe(true);
    expect(queries.find(query => /^select .* from "heartbeat_runs" where/.test(query))).toMatch(/"heartbeat_runs"\."updated_at" >/);
  });

  it("keeps old runs that are unfinished or still under a controller lease", async () => {
    const { companyId, agentId } = await seed();
    const [running] = await db.insert(heartbeatRuns).values({ id: randomUUID(), companyId, agentId, invocationSource: "on_demand",
      status: "running", startedAt: longAgo(), createdAt: longAgo(), updatedAt: longAgo() }).returning();
    expect(await agentExecutionsHaveStopped(db, [agentId])).toBe(false);
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: longAgo(), updatedAt: longAgo(),
      controllerLeaseExpiresAt: new Date(Date.now() + 60_000) }).where(sql`${heartbeatRuns.id} = ${running.id}`);
    expect(await agentExecutionsHaveStopped(db, [agentId])).toBe(false);
    await db.update(heartbeatRuns).set({ controllerLeaseExpiresAt: longAgo(), updatedAt: longAgo() })
      .where(sql`${heartbeatRuns.id} = ${running.id}`);
    expect(await agentExecutionsHaveStopped(db, [agentId])).toBe(true);
  });
});
