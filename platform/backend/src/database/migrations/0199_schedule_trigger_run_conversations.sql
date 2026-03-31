CREATE TABLE "schedule_trigger_run_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_trigger_run_conversations" ADD CONSTRAINT "schedule_trigger_run_conversations_run_id_schedule_trigger_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."schedule_trigger_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_trigger_run_conversations" ADD CONSTRAINT "schedule_trigger_run_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "schedule_trigger_run_conversations_run_id_idx" ON "schedule_trigger_run_conversations" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "schedule_trigger_run_conversations_user_id_idx" ON "schedule_trigger_run_conversations" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_trigger_run_conversations_run_user_unique_idx" ON "schedule_trigger_run_conversations" USING btree ("run_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_trigger_run_conversations_conversation_unique_idx" ON "schedule_trigger_run_conversations" USING btree ("conversation_id");
