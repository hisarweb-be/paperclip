ALTER TABLE "approval_comments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD COLUMN IF NOT EXISTS "deleted_by_type" text;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD COLUMN IF NOT EXISTS "deleted_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD COLUMN IF NOT EXISTS "deleted_by_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_deleted_by_agent_id_agents_id_fk" FOREIGN KEY ("deleted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
