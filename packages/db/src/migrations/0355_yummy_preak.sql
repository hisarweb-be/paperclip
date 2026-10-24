DROP INDEX "documents_company_created_idx";--> statement-breakpoint
CREATE INDEX "issue_attachments_company_created_idx" ON "issue_attachments" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "issue_work_products_company_created_idx" ON "issue_work_products" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_company_created_idx" ON "documents" USING btree ("company_id","created_at","id");