import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ScheduleTriggerRunStatus,
  ScheduleTriggerScheduleKind,
} from "@/types/schedule-trigger";

const scheduleTriggersTable = pgTable(
  "schedule_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    agentId: uuid("agent_id").notNull(),
    messageTemplate: text("message_template").notNull(),
    scheduleKind: text("schedule_kind")
      .$type<ScheduleTriggerScheduleKind>()
      .notNull()
      .default("cron"),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    actorUserId: text("actor_user_id").notNull(),
    nextDueAt: timestamp("next_due_at", { mode: "date" }),
    lastRunAt: timestamp("last_run_at", { mode: "date" }),
    lastRunStatus: text("last_run_status").$type<ScheduleTriggerRunStatus>(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("schedule_triggers_organization_id_idx").on(table.organizationId),
    index("schedule_triggers_agent_id_idx").on(table.agentId),
    index("schedule_triggers_actor_user_id_idx").on(table.actorUserId),
    index("schedule_triggers_enabled_next_due_at_idx").on(
      table.enabled,
      table.nextDueAt,
    ),
  ],
);

export default scheduleTriggersTable;
