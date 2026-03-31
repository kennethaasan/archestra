ALTER TABLE "schedule_triggers"
ADD COLUMN "overlap_policy" text DEFAULT 'allow_all' NOT NULL;
--> statement-breakpoint
ALTER TABLE "schedule_triggers"
ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "schedule_triggers"
ADD COLUMN "max_consecutive_failures" integer DEFAULT 5 NOT NULL;
