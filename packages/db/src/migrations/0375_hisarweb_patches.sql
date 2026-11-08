-- HisarWeb fork: six read-path indexes that production already carried by hand
-- (plugins/bureau-server/db-index.sh). IF NOT EXISTS keeps this a no-op where
-- they exist; the migrator drops and rebuilds an invalid leftover first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_wakeup_requests_company_payload_task_idx" ON "agent_wakeup_requests" USING btree ("company_id",("payload" ->> 'taskId'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_wakeup_requests_company_wakectx_issue_idx" ON "agent_wakeup_requests" USING btree ("company_id",(("payload" -> '_paperclipWakeContext') ->> 'issueId'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_wakeup_requests_company_wakectx_task_idx" ON "agent_wakeup_requests" USING btree ("company_id",(("payload" -> '_paperclipWakeContext') ->> 'taskId'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "heartbeat_runs_open_issue_idx" ON "heartbeat_runs" USING btree ("company_id",("context_snapshot" ->> 'issueId')) WHERE "heartbeat_runs"."status" in ('queued', 'running', 'scheduled_retry');--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "heartbeat_runs_recovery_action_idx" ON "heartbeat_runs" USING btree ("company_id",("context_snapshot" ->> 'recoveryActionId'));--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "heartbeat_runs_queued_comment_interrupt_idx" ON "heartbeat_runs" USING btree (("result_json" ->> 'queuedCommentInterruptQueueId'));