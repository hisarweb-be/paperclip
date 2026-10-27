import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres blocker attention update route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;
type CompanyRow = typeof companies.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type IssueRow = typeof issues.$inferSelect;

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as any));
  app.use(errorHandler);
  return app;
}

function boardActor(company: CompanyRow): Express.Request["actor"] {
  return {
    type: "board",
    userId: "board-user",
    companyIds: [company.id],
    memberships: [{ companyId: company.id, membershipRole: "operator", status: "active" }],
    isInstanceAdmin: true,
    source: "local_implicit",
  } as Express.Request["actor"];
}

async function seedCompany(db: Db, label: string) {
  const nonce = randomUUID().slice(0, 8);
  const [company] = await db
    .insert(companies)
    .values({
      name: `${label} ${nonce}`,
      issuePrefix: `BA${nonce.slice(0, 4).toUpperCase()}`,
      defaultResponsibleUserId: "board-user",
    })
    .returning();
  return company!;
}

async function seedAgent(db: Db, companyId: string): Promise<AgentRow> {
  const [agent] = await db
    .insert(agents)
    .values({
      companyId,
      name: `Agent ${randomUUID().slice(0, 6)}`,
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    })
    .returning();
  return agent!;
}

async function seedIssue(
  db: Db,
  input: {
    companyId: string;
    identifier: string;
    title: string;
    status?: string;
    assigneeAgentId?: string | null;
    parentId?: string | null;
  },
): Promise<IssueRow> {
  const [issue] = await db
    .insert(issues)
    .values({
      companyId: input.companyId,
      identifier: input.identifier,
      parentId: input.parentId ?? null,
      title: input.title,
      status: input.status ?? "todo",
      priority: "medium",
      assigneeAgentId: input.assigneeAgentId ?? null,
      responsibleUserId: "board-user",
    })
    .returning();
  return issue!;
}

async function block(
  db: Db,
  companyId: string,
  blockerIssueId: string,
  blockedIssueId: string,
) {
  await db.insert(issueRelations).values({
    companyId,
    issueId: blockerIssueId,
    relatedIssueId: blockedIssueId,
    type: "blocks",
  });
}

describeEmbeddedPostgres("issue blocker attention on the update route", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-blocker-attention-update-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    const companyIds = await db
      .select({ id: companies.id })
      .from(companies);
    for (const { id } of companyIds) {
      await db.delete(activityLog).where(eq(activityLog.companyId, id));
    }
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns the same blocker attention from a PATCH as a follow-up GET", async () => {
    const company = await seedCompany(db, "AttnRoute");
    const agent = await seedAgent(db, company.id);
    const parent = await seedIssue(db, {
      companyId: company.id,
      identifier: "AR-1",
      title: "Blocked parent",
      status: "blocked",
    });
    const unownedBlocker = await seedIssue(db, {
      companyId: company.id,
      identifier: "AR-2",
      title: "Blocker without an owner",
      status: "todo",
    });
    const ownedBlocker = await seedIssue(db, {
      companyId: company.id,
      identifier: "AR-3",
      title: "Blocker queued at a live owner",
      status: "todo",
      assigneeAgentId: agent.id,
    });
    await block(db, company.id, unownedBlocker.id, parent.id);
    await block(db, company.id, ownedBlocker.id, parent.id);

    const app = createApp(db, boardActor(company));
    const patched = await request(app)
      .patch(`/api/issues/${parent.id}`)
      .send({ status: "blocked" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    const fetched = await request(app).get(`/api/issues/${parent.id}`);
    expect(fetched.status, JSON.stringify(fetched.body)).toBe(200);

    // The write response must be the same derivation the read returns, not an
    // absent field that reads as "the flag was cleared".
    expect(patched.body.blockerAttention).toBeTruthy();
    expect(patched.body.blockerAttention).toEqual(fetched.body.blockerAttention);
    expect(patched.body.blockerAttention).toMatchObject({
      state: "needs_attention",
      reason: "attention_required",
      unresolvedBlockerCount: 2,
      coveredBlockerCount: 1,
      attentionBlockerCount: 1,
      sampleBlockerIdentifier: "AR-2",
      terminalBlockerIssueId: unownedBlocker.id,
    });
  });

  it("names the direct blocker and keeps a live decomposition sub-task out of the sample", async () => {
    const company = await seedCompany(db, "AttnChild");
    const agent = await seedAgent(db, company.id);
    const root = await seedIssue(db, {
      companyId: company.id,
      identifier: "AC-1",
      title: "Blocked root",
      status: "blocked",
    });
    const directBlocker = await seedIssue(db, {
      companyId: company.id,
      identifier: "AC-2",
      title: "Direct blocker",
      status: "todo",
      assigneeAgentId: agent.id,
    });
    const subTask = await seedIssue(db, {
      companyId: company.id,
      identifier: "AC-3",
      title: "Sub-task of the direct blocker",
      status: "todo",
      parentId: directBlocker.id,
      assigneeAgentId: agent.id,
    });
    const unownedLeaf = await seedIssue(db, {
      companyId: company.id,
      identifier: "AC-4",
      title: "Unowned leaf far down the sub-task tree",
      status: "todo",
      parentId: subTask.id,
    });
    await block(db, company.id, directBlocker.id, root.id);

    const app = createApp(db, boardActor(company));
    const patched = await request(app)
      .patch(`/api/issues/${root.id}`)
      .send({ status: "blocked" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    const attention = patched.body.blockerAttention;
    expect(attention).toMatchObject({
      state: "needs_attention",
      unresolvedBlockerCount: 1,
      sampleBlockerIdentifier: "AC-2",
      directBlockerIssueId: directBlocker.id,
      terminalBlockerIssueId: directBlocker.id,
      terminalBlocker: { identifier: "AC-2" },
    });
    // The card the board never sees in the blocker graph must not be named.
    expect(attention.terminalBlockerIssueId).not.toBe(unownedLeaf.id);
    expect(attention.terminalBlockerIssueId).not.toBe(subTask.id);
  });

  it("reports queued todo blockers with live owners as covered waiting paths", async () => {
    const company = await seedCompany(db, "AttnCovered");
    const firstAgent = await seedAgent(db, company.id);
    const secondAgent = await seedAgent(db, company.id);
    const root = await seedIssue(db, {
      companyId: company.id,
      identifier: "AV-1",
      title: "Blocked root with two queued blockers",
      status: "blocked",
    });
    const firstBlocker = await seedIssue(db, {
      companyId: company.id,
      identifier: "AV-2",
      title: "Queued at the first owner",
      status: "todo",
      assigneeAgentId: firstAgent.id,
    });
    const secondBlocker = await seedIssue(db, {
      companyId: company.id,
      identifier: "AV-3",
      title: "Queued at the second owner",
      status: "todo",
      assigneeAgentId: secondAgent.id,
    });
    await block(db, company.id, firstBlocker.id, root.id);
    await block(db, company.id, secondBlocker.id, root.id);

    const app = createApp(db, boardActor(company));
    const fetched = await request(app).get(`/api/issues/${root.id}`);
    expect(fetched.status, JSON.stringify(fetched.body)).toBe(200);

    expect(fetched.body.blockerAttention).toMatchObject({
      state: "covered",
      reason: "active_dependency",
      unresolvedBlockerCount: 2,
      coveredBlockerCount: 2,
      stalledBlockerCount: 0,
      attentionBlockerCount: 0,
    });
  });

  it("keeps an unowned todo blocker as attention on the update response", async () => {
    const company = await seedCompany(db, "AttnUnowned");
    const root = await seedIssue(db, {
      companyId: company.id,
      identifier: "AU-1",
      title: "Blocked root",
      status: "blocked",
    });
    const blocker = await seedIssue(db, {
      companyId: company.id,
      identifier: "AU-2",
      title: "Nobody owns this one",
      status: "todo",
    });
    await block(db, company.id, blocker.id, root.id);

    const app = createApp(db, boardActor(company));
    const patched = await request(app)
      .patch(`/api/issues/${root.id}`)
      .send({ status: "blocked" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.blockerAttention).toMatchObject({
      state: "needs_attention",
      sampleBlockerIdentifier: "AU-2",
      attentionBlockerCount: 1,
    });

    await db.update(issues).set({ assigneeAgentId: (await seedAgent(db, company.id)).id }).where(eq(issues.id, blocker.id));

    const afterOwner = await request(app).get(`/api/issues/${root.id}`);
    expect(afterOwner.body.blockerAttention).toMatchObject({
      state: "covered",
      reason: "active_dependency",
      attentionBlockerCount: 0,
    });
  });
});
