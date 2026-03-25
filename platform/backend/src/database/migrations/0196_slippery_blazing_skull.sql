ALTER TABLE "schedule_trigger_runs"
ADD COLUMN "chat_conversation_id" uuid;
--> statement-breakpoint
ALTER TABLE "schedule_trigger_runs"
ADD CONSTRAINT "schedule_trigger_runs_chat_conversation_id_conversations_id_fk"
FOREIGN KEY ("chat_conversation_id") REFERENCES "public"."conversations"("id")
ON DELETE set null
ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "schedule_trigger_runs_chat_conversation_id_idx"
ON "schedule_trigger_runs" USING btree ("chat_conversation_id");
