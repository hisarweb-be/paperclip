import { createHash } from "node:crypto";
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWakeupRequests,
  approvals,
  heartbeatRuns,
  issueApprovals,
  issueRelations,
  issueThreadInteractions,
  issueWorkProducts,
  issues,
} from "@paperclipai/db";
import { parseIssueExecutionState } from "../issue-execution-policy.js";

const ACTIVE_RUN_STATUSES = ["queued", "running", "scheduled_retry"] as const;

export const DISPOSITION_REPAIR_MAX_ATTEMPTS = 5;
export const DISPOSITION_REPAIR_BASE_DELAYS_MS = [0, 60_000, 120_000, 240_000, 480_000] as const;

type DispositionRepairIssue = Pick<
  typeof issues.$inferSelect,
  | "id"
  | "companyId"
  | "status"
  | "assigneeAgentId"
  | "assigneeUserId"
  | "executionPolicy"
  | "executionState"
  | "monitorNextCheckAt"
>;

export type DispositionRepairSourceState = {
  fingerprint: string;
  dependencyIssueIds: string[];
  hasActiveExecutionPath: boolean;
  hasDurableWaitingPath: boolean;
  durablePathReason: string | null;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function boundedRecoveryDelayMs(
  attempt: number,
  fingerprint: string,
  delays: readonly number[],
  lane: string,
) {
  const baseDelayMs = delays[attempt - 1];
  if (baseDelayMs === undefined) throw new Error(`Invalid ${lane} attempt: ${attempt}`);
  if (baseDelayMs === 0) return { baseDelayMs, jitterMs: 0, delayMs: 0 };

  const jitterBoundMs = Math.floor(baseDelayMs * 0.1);
  const sample = Number.parseInt(
    createHash("sha256").update(`${fingerprint}:${attempt}`).digest("hex").slice(0, 8),
    16,
  );
  const jitterMs = sample % (jitterBoundMs + 1);
  return { baseDelayMs, jitterMs, delayMs: baseDelayMs + jitterMs };
}

/**
 * Fork F1 (CTO wake storm): the source-state fingerprint also covers work-product and
 * interaction timestamps, so any productive run resets the per-fingerprint attempt counter
 * and grants a fresh, undelayed first attempt. Without a per-issue brake that produced up to
 * 12 repair wakes per issue per day. A first attempt on a new fingerprint is deferred while
 * the issue already received a repair wake inside the cooldown window; later sweeps pick it up.
 */
export const DISPOSITION_REPAIR_COOLDOWN_MS = 15 * 60_000;

export function dispositionRepairCooldownActive(input: {
  sameFingerprintAttempt: number;
  lastRepairWakeAt: Date | null;
  now?: Date;
  cooldownMs?: number;
}): boolean {
  if (input.sameFingerprintAttempt > 0 || !input.lastRepairWakeAt) return false;
  const now = (input.now ?? new Date()).getTime();
  const age = now - input.lastRepairWakeAt.getTime();
  return age >= 0 && age < (input.cooldownMs ?? DISPOSITION_REPAIR_COOLDOWN_MS);
}

export async function findLastDispositionRepairWakeAt(
  db: Db,
  input: { companyId: string; issueId: string },
): Promise<Date | null> {
  const row = await db
    .select({ createdAt: agentWakeupRequests.createdAt })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, input.companyId),
        eq(agentWakeupRequests.reason, "issue_disposition_repair"),
        sql`${agentWakeupRequests.status} <> 'skipped'`,
        sql`${agentWakeupRequests.payload} ->> 'issueId' = ${input.issueId}`,
        // HIS-8397: only wakes that carried a task key count toward the window; payloads
        // without one were dropped by the wake gate and never reached an agent.
        sql`coalesce(${agentWakeupRequests.contextSnapshot} ->> 'taskKey', ${agentWakeupRequests.payload} ->> 'taskKey', ${agentWakeupRequests.payload} ->> 'taskId') ~ '[^[:space:]]'`,
      ),
    )
    .orderBy(sql`${agentWakeupRequests.createdAt} desc`)
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row?.createdAt ?? null;
}

export function dispositionRepairDelayMs(attempt: number, fingerprint: string) {
  return boundedRecoveryDelayMs(
    attempt,
    fingerprint,
    DISPOSITION_REPAIR_BASE_DELAYS_MS,
    "disposition repair",
  );
}

export async function collectDispositionRepairSourceState(
  db: Db,
  input: {
    issue: DispositionRepairIssue;
    excludeRunId?: string | null;
    excludeWakeupRequestId?: string | null;
  },
): Promise<DispositionRepairSourceState> {
  const issue = input.issue;
  const [blockers, children, interactions, linkedApprovals, workProducts, activeRuns, queuedWakes] =
    await Promise.all([
      db
        .select({ id: issues.id, status: issues.status, assigneeAgentId: issues.assigneeAgentId })
        .from(issueRelations)
        .innerJoin(
          issues,
          and(eq(issues.companyId, issueRelations.companyId), eq(issues.id, issueRelations.issueId)),
        )
        .where(
          and(
            eq(issueRelations.companyId, issue.companyId),
            eq(issueRelations.relatedIssueId, issue.id),
            eq(issueRelations.type, "blocks"),
            notInArray(issues.status, ["done", "cancelled"]),
            sql`${issues.hiddenAt} is null`,
          ),
        ),
      db
        .select({ id: issues.id, status: issues.status, assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, issue.companyId),
            eq(issues.parentId, issue.id),
            notInArray(issues.status, ["done", "cancelled"]),
            sql`${issues.hiddenAt} is null`,
          ),
        ),
      db
        .select({
          id: issueThreadInteractions.id,
          status: issueThreadInteractions.status,
          kind: issueThreadInteractions.kind,
          continuationPolicy: issueThreadInteractions.continuationPolicy,
          updatedAt: issueThreadInteractions.updatedAt,
        })
        .from(issueThreadInteractions)
        .where(
          and(
            eq(issueThreadInteractions.companyId, issue.companyId),
            eq(issueThreadInteractions.issueId, issue.id),
            inArray(issueThreadInteractions.status, ["pending", "accepted", "answered"]),
          ),
        ),
      db
        .select({ id: approvals.id, status: approvals.status, decidedAt: approvals.decidedAt })
        .from(issueApprovals)
        .innerJoin(
          approvals,
          and(
            eq(issueApprovals.approvalId, approvals.id),
            eq(issueApprovals.companyId, approvals.companyId),
          ),
        )
        .where(
          and(
            eq(issueApprovals.companyId, issue.companyId),
            eq(approvals.companyId, issue.companyId),
            eq(issueApprovals.issueId, issue.id),
            inArray(approvals.status, ["pending", "revision_requested", "approved"]),
          ),
        ),
      db
        .select({
          id: issueWorkProducts.id,
          type: issueWorkProducts.type,
          status: issueWorkProducts.status,
          reviewState: issueWorkProducts.reviewState,
          updatedAt: issueWorkProducts.updatedAt,
        })
        .from(issueWorkProducts)
        .where(
          and(
            eq(issueWorkProducts.companyId, issue.companyId),
            eq(issueWorkProducts.issueId, issue.id),
          ),
        ),
      db
        .select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, issue.companyId),
            inArray(heartbeatRuns.status, [...ACTIVE_RUN_STATUSES]),
            sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
            input.excludeRunId ? ne(heartbeatRuns.id, input.excludeRunId) : sql`true`,
          ),
        ),
      db
        .select({ id: agentWakeupRequests.id, agentId: agentWakeupRequests.agentId, status: agentWakeupRequests.status })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, issue.companyId),
            inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
            sql`${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}`,
            input.excludeWakeupRequestId
              ? ne(agentWakeupRequests.id, input.excludeWakeupRequestId)
              : sql`true`,
          ),
        ),
    ]);

  const pendingExecutionState = parseIssueExecutionState(issue.executionState);
  const pendingInteraction = interactions.some((row) => row.status === "pending");
  const pendingApproval = linkedApprovals.some((row) =>
    row.status === "pending" || row.status === "revision_requested",
  );
  const durablePathReason = issue.assigneeUserId
    ? "user_owner"
    : blockers.length > 0
      ? "blocker"
      : issue.monitorNextCheckAt && issue.monitorNextCheckAt.getTime() > Date.now()
        ? "monitor"
        : pendingExecutionState?.status === "pending"
          ? "execution_stage"
          : pendingInteraction
            ? "interaction"
            : pendingApproval
              ? "approval"
              : null;

  const durableState = {
    source: {
      status: issue.status,
      assigneeAgentId: issue.assigneeAgentId,
      assigneeUserId: issue.assigneeUserId,
      executionPolicy: issue.executionPolicy,
      executionState: issue.executionState,
      monitorNextCheckAt: issue.monitorNextCheckAt?.toISOString() ?? null,
    },
    blockers: blockers.sort((a, b) => a.id.localeCompare(b.id)),
    children: children.sort((a, b) => a.id.localeCompare(b.id)),
    interactions: interactions
      .map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    approvals: linkedApprovals
      .map((row) => ({ ...row, decidedAt: row.decidedAt?.toISOString() ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    workProducts: workProducts
      .map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  const digest = createHash("sha256").update(stableJson(durableState)).digest("hex");

  return {
    fingerprint: `disposition_repair:v1:${digest}`,
    dependencyIssueIds: [...new Set([...blockers.map((row) => row.id), ...children.map((row) => row.id)])],
    hasActiveExecutionPath: activeRuns.length > 0 || queuedWakes.length > 0,
    hasDurableWaitingPath: durablePathReason !== null,
    durablePathReason,
  };
}

/**
 * HIS-8150 / HIS-8397 (server rule, wake storm): a disposition repair wake is only useful
 * when it carries the issue it repairs. A wake whose context snapshot has no task key
 * (`taskKey`) and no fallback `payload.taskKey` / `payload.taskId` cannot be acted on and
 * burns a full run. The predicate is pure (no I/O) and mirrors the tested rule in
 * `plugins/zelfherstel/wekdemper.mjs` (`magWekkenDispositie`).
 */
export const ISSUE_DISPOSITION_REPAIR_WAKE_REASON = "issue_disposition_repair";

export function readNonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function dispositionRepairTaskKey(input: {
  contextSnapshot?: unknown;
  payload?: unknown;
}): string | null {
  const context =
    input.contextSnapshot && typeof input.contextSnapshot === "object"
      ? (input.contextSnapshot as Record<string, unknown>)
      : null;
  if (context) {
    const direct = readNonBlankString(context.taskKey);
    if (direct) return direct;
    const snapshot = context.contextSnapshot;
    if (snapshot && typeof snapshot === "object") {
      const nested = readNonBlankString((snapshot as Record<string, unknown>).taskKey);
      if (nested) return nested;
    }
  }
  const payload =
    input.payload && typeof input.payload === "object" ? (input.payload as Record<string, unknown>) : null;
  if (payload) {
    return readNonBlankString(payload.taskKey) ?? readNonBlankString(payload.taskId);
  }
  return null;
}

/**
 * HIS-8150 / HIS-8397: true when a wake may be delivered. A disposition repair wake without
 * a resolvable task key is dropped before it is persisted; every other wake reason passes.
 * `switchOn` is read per company from `settings/tokenwacht.json` by the caller, so the rule
 * can be rolled back without a deploy.
 */
export function magWekkenDispositie(input: {
  wakeReason?: string | null;
  contextSnapshot?: unknown;
  payload?: unknown;
  switchOn?: boolean;
  now?: Date;
  lastWakeAt?: Date | null;
  windowMs?: number;
}): { mag: boolean; reden: string; taak: string | null } {
  const taak = dispositionRepairTaskKey(input);
  if (input.switchOn === false) return { mag: true, reden: "schakelaar uit", taak };
  if (input.wakeReason !== ISSUE_DISPOSITION_REPAIR_WAKE_REASON) return { mag: true, reden: "andere wekreden", taak };
  if (!taak) return { mag: false, reden: "geen taakcontext", taak: null };
  if (input.lastWakeAt) {
    const now = (input.now ?? new Date()).getTime();
    const age = now - input.lastWakeAt.getTime();
    if (age >= 0 && age < (input.windowMs ?? DISPOSITION_REPAIR_WAKE_WINDOW_MS)) {
      return { mag: false, reden: "kaart had al een wekking binnen het venster", taak };
    }
  }
  return { mag: true, reden: "taakcontext aanwezig", taak };
}

/** HIS-8397: per issue at most one disposition repair wake per 6 hours; a new fingerprint still gets one. */
export const DISPOSITION_REPAIR_WAKE_WINDOW_MS = 6 * 60 * 60_000;

export function dispositionRepairWindowActive(input: {
  newlyWokenFingerprint: boolean;
  lastWakeAt: Date | null;
  now?: Date;
  windowMs?: number;
}): boolean {
  if (input.newlyWokenFingerprint || !input.lastWakeAt) return false;
  const now = (input.now ?? new Date()).getTime();
  const age = now - input.lastWakeAt.getTime();
  return age >= 0 && age < (input.windowMs ?? DISPOSITION_REPAIR_WAKE_WINDOW_MS);
}
