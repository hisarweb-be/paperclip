import type { ApprovalStatus, ApprovalType } from "../constants.js";

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalComment {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  /** Set when the comment was removed; `body` then holds the tombstone marker. */
  deletedAt: Date | null;
  deletedByType: "agent" | "user" | "board" | null;
  deletedByAgentId: string | null;
  deletedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
