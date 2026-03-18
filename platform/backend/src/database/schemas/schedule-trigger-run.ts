import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ScheduleTriggerRunKind,
  ScheduleTriggerRunStatus,
} from "@/types/schedule-trigger";

const scheduleTriggerRunsTable = pgTable(
  "schedule_trigger_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    triggerId: uuid("trigger_id").notNull(),
    runKind: text("run_kind").$type<ScheduleTriggerRunKind>().notNull(),
    status: text("status")
      .$type<ScheduleTriggerRunStatus>()
      .notNull()
      .default("pending"),
    dueAt: timestamp("due_at", { mode: "date" }),
    initiatedByUserId: text("initiated_by_user_id"),
    agentIdSnapshot: uuid("agent_id_snapshot").notNull(),
    messageTemplateSnapshot: text("message_template_snapshot").notNull(),
    actorUserIdSnapshot: text("actor_user_id_snapshot").notNull(),
    timezoneSnapshot: text("timezone_snapshot").notNull(),
    cronExpressionSnapshot: text("cron_expression_snapshot").notNull(),
    startedAt: timestamp("started_at", { mode: "date" }),
    completedAt: timestamp("completed_at", { mode: "date" }),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("schedule_trigger_runs_organization_id_idx").on(table.organizationId),
    index("schedule_trigger_runs_trigger_id_idx").on(table.triggerId),
    index("schedule_trigger_runs_status_idx").on(table.status),
    index("schedule_trigger_runs_due_at_idx").on(table.dueAt),
    uniqueIndex("schedule_trigger_runs_trigger_due_at_unique_idx").on(
      table.triggerId,
      table.dueAt,
    ),
  ],
);

export default scheduleTriggerRunsTable;
