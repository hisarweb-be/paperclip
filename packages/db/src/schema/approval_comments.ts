import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";
import { agents } from "./agents.js";

export const approvalComments = pgTable(
  "approval_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    approvalId: uuid("approval_id").notNull().references(() => approvals.id),
    authorAgentId: uuid("author_agent_id").references(() => agents.id),
    authorUserId: text("author_user_id"),
    body: text("body").notNull(),
    // Tombstone columns. Deleting an approval comment never removes the row:
    // the body is redacted and the author/actor is kept, so the decision thread
    // keeps its audit trail and a removal stays reversible in the record.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByType: text("deleted_by_type").$type<"agent" | "user" | "board">(),
    deletedByAgentId: uuid("deleted_by_agent_id").references(() => agents.id),
    deletedByUserId: text("deleted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("approval_comments_company_idx").on(table.companyId),
    approvalIdx: index("approval_comments_approval_idx").on(table.approvalId),
    approvalCreatedIdx: index("approval_comments_approval_created_idx").on(
      table.approvalId,
      table.createdAt,
    ),
  }),
);
