CREATE TABLE "schedule_trigger_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"trigger_id" uuid NOT NULL,
	"run_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp,
	"initiated_by_user_id" text,
	"agent_id_snapshot" uuid NOT NULL,
	"message_template_snapshot" text NOT NULL,
	"actor_user_id_snapshot" text NOT NULL,
	"timezone_snapshot" text NOT NULL,
	"cron_expression_snapshot" text NOT NULL,
	"chat_conversation_id" uuid,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"message_template" text NOT NULL,
	"schedule_kind" text DEFAULT 'cron' NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"actor_user_id" text NOT NULL,
	"overlap_policy" text DEFAULT 'skip' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"max_consecutive_failures" integer DEFAULT 5 NOT NULL,
	"next_due_at" timestamp,
	"last_run_at" timestamp,
	"last_run_status" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_trigger_runs" ADD CONSTRAINT "schedule_trigger_runs_chat_conversation_id_conversations_id_fk" FOREIGN KEY ("chat_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_trigger_runs_organization_id_idx" ON "schedule_trigger_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "schedule_trigger_runs_trigger_id_idx" ON "schedule_trigger_runs" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "schedule_trigger_runs_status_idx" ON "schedule_trigger_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedule_trigger_runs_due_at_idx" ON "schedule_trigger_runs" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "schedule_trigger_runs_chat_conversation_id_idx" ON "schedule_trigger_runs" USING btree ("chat_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_trigger_runs_trigger_due_at_unique_idx" ON "schedule_trigger_runs" USING btree ("trigger_id","due_at");--> statement-breakpoint
CREATE INDEX "schedule_triggers_organization_id_idx" ON "schedule_triggers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "schedule_triggers_agent_id_idx" ON "schedule_triggers" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "schedule_triggers_actor_user_id_idx" ON "schedule_triggers" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "schedule_triggers_enabled_next_due_at_idx" ON "schedule_triggers" USING btree ("enabled","next_due_at");