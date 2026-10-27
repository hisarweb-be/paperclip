import { z } from "zod";
import { APPROVAL_TYPES } from "../constants.js";
import { multilineTextSchema } from "./text.js";

export const createApprovalSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  requestedByAgentId: z.string().guid().optional().nullable(),
  payload: z.record(z.string(), z.unknown()),
  issueIds: z.array(z.string().guid()).optional(),
});

export type CreateApproval = z.infer<typeof createApprovalSchema>;

export const resolveApprovalSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
});

export type ResolveApproval = z.infer<typeof resolveApprovalSchema>;

/**
 * Rejecting is the irreversible half of the decision pair: it takes a card out
 * of the queue and (for `hire_agent`) terminates the payload agent. A rejection
 * must therefore state a reason. Approving keeps the optional note.
 *
 * A replayed reject is already a no-op: `resolveApproval` returns the existing
 * record with `applied: false` when the approval is already rejected, so the
 * route never applies the same rejection twice. The undo path is
 * `reopenApprovalSchema`, not a second reject.
 */
export const rejectApprovalSchema = z.object({
  decisionNote: multilineTextSchema.pipe(z.string().trim().min(1)),
});

export type RejectApproval = z.infer<typeof rejectApprovalSchema>;

/**
 * Reopen a resolved approval: the back-out for a rejection that should not have
 * happened. Only `rejected` approvals can be reopened, and the reopen itself is
 * recorded so the decision thread keeps both the rejection and the restore.
 */
export const reopenApprovalSchema = z.object({
  reason: multilineTextSchema.pipe(z.string().trim().min(1)),
});

export type ReopenApproval = z.infer<typeof reopenApprovalSchema>;

export const requestApprovalRevisionSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
});

export type RequestApprovalRevision = z.infer<typeof requestApprovalRevisionSchema>;

export const resubmitApprovalSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type ResubmitApproval = z.infer<typeof resubmitApprovalSchema>;

export const addApprovalCommentSchema = z.object({
  body: multilineTextSchema.pipe(z.string().min(1)),
});

export type AddApprovalComment = z.infer<typeof addApprovalCommentSchema>;
