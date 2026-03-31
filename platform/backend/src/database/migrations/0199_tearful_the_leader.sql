CREATE TABLE "schedule_trigger_run_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_trigger_runs" ALTER COLUMN "due_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_trigger_runs" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_trigger_runs" ALTER COLUMN "completed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_triggers" ALTER COLUMN "next_due_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_triggers" ALTER COLUMN "last_run_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_trigger_run_conversations" ADD CONSTRAINT "schedule_trigger_run_conversations_run_id_schedule_trigger_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."schedule_trigger_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_trigger_run_conversations" ADD CONSTRAINT "schedule_trigger_run_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_trigger_run_conversations_run_id_idx" ON "schedule_trigger_run_conversations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "schedule_trigger_run_conversations_user_id_idx" ON "schedule_trigger_run_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_trigger_run_conversations_run_user_unique_idx" ON "schedule_trigger_run_conversations" USING btree ("run_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_trigger_run_conversations_conversation_unique_idx" ON "schedule_trigger_run_conversations" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "schedule_trigger_runs" ADD CONSTRAINT "schedule_trigger_runs_trigger_id_schedule_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."schedule_triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_triggers" ADD CONSTRAINT "schedule_triggers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_triggers" ADD CONSTRAINT "schedule_triggers_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;