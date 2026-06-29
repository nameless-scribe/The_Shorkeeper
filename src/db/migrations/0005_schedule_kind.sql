ALTER TABLE scheduled_tasks ADD COLUMN schedule_kind TEXT NOT NULL DEFAULT 'recurring';
--> statement-breakpoint
ALTER TABLE scheduled_tasks ADD COLUMN run_at INTEGER;
