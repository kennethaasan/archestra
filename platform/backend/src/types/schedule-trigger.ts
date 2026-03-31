import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import {
  createCron,
  isValidTimezone,
  normalizeCronExpression,
  normalizeTimezone,
} from "@/schedule-triggers/utils";

export const ScheduleTriggerScheduleKindSchema = z.enum(["cron"]);
export type ScheduleTriggerScheduleKind = z.infer<
  typeof ScheduleTriggerScheduleKindSchema
>;

export const ScheduleTriggerOverlapPolicySchema = z.enum([
  "skip",
  "buffer_one",
  "allow_all",
]);
export type ScheduleTriggerOverlapPolicy = z.infer<
  typeof ScheduleTriggerOverlapPolicySchema
>;

export const ScheduleTriggerRunKindSchema = z.enum(["due", "manual"]);
export type ScheduleTriggerRunKind = z.infer<
  typeof ScheduleTriggerRunKindSchema
>;

export const ScheduleTriggerRunStatusSchema = z.enum([
  "pending",
  "running",
  "success",
  "failed",
]);
export type ScheduleTriggerRunStatus = z.infer<
  typeof ScheduleTriggerRunStatusSchema
>;

export const ScheduleTriggerActorSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export const ScheduleTriggerAgentSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  agentType: z.string().nullable(),
});

export const ScheduleTriggerConfigurationSchemaBase = z.object({
  cronExpression: z.string().min(1),
  timezone: z.string().min(1),
  messageTemplate: z.string().min(1),
});

export const ScheduleTriggerConfigurationSchema =
  ScheduleTriggerConfigurationSchemaBase.superRefine(
    validateScheduleTriggerFields,
  );

function validateScheduleTriggerFields(
  data: {
    cronExpression?: string | null;
    timezone?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const cronExpression = data.cronExpression?.trim();
  const timezone = data.timezone?.trim();

  if (!cronExpression) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cron expression is required",
      path: ["cronExpression"],
    });
  }

  if (!timezone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Timezone is required",
      path: ["timezone"],
    });
    return;
  }

  if (!isValidTimezone(timezone)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Timezone must be a valid IANA timezone",
      path: ["timezone"],
    });
    return;
  }

  if (!cronExpression) {
    return;
  }

  try {
    createCron({
      cronExpression: normalizeCronExpression(cronExpression),
      timezone: normalizeTimezone(timezone),
    });
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        error instanceof Error ? error.message : "Invalid cron expression",
      path: ["cronExpression"],
    });
  }
}

const selectTriggerExtendedFields = {
  scheduleKind: ScheduleTriggerScheduleKindSchema,
  lastRunStatus: ScheduleTriggerRunStatusSchema.nullable(),
  overlapPolicy: ScheduleTriggerOverlapPolicySchema,
};

const insertTriggerExtendedFields = {
  scheduleKind: ScheduleTriggerScheduleKindSchema.optional(),
  lastRunStatus: ScheduleTriggerRunStatusSchema.nullable().optional(),
  overlapPolicy: ScheduleTriggerOverlapPolicySchema.optional(),
};

export const SelectScheduleTriggerSchema = createSelectSchema(
  schema.scheduleTriggersTable,
  selectTriggerExtendedFields,
).extend({
  actor: ScheduleTriggerActorSummarySchema.nullable().optional(),
  agent: ScheduleTriggerAgentSummarySchema.nullable().optional(),
});

export const InsertScheduleTriggerSchema = createInsertSchema(
  schema.scheduleTriggersTable,
  insertTriggerExtendedFields,
)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .superRefine(validateScheduleTriggerFields);

export const UpdateScheduleTriggerSchema = createUpdateSchema(
  schema.scheduleTriggersTable,
  insertTriggerExtendedFields,
)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .superRefine((data, ctx) => {
    if (data.cronExpression !== undefined || data.timezone !== undefined) {
      validateScheduleTriggerFields(
        {
          cronExpression: data.cronExpression,
          timezone: data.timezone,
        },
        ctx,
      );
    }
  });

const selectRunExtendedFields = {
  runKind: ScheduleTriggerRunKindSchema,
  status: ScheduleTriggerRunStatusSchema,
};

const insertRunExtendedFields = {
  runKind: ScheduleTriggerRunKindSchema,
  status: ScheduleTriggerRunStatusSchema.optional(),
};

export const SelectScheduleTriggerRunSchema = createSelectSchema(
  schema.scheduleTriggerRunsTable,
  selectRunExtendedFields,
);

export const InsertScheduleTriggerRunSchema = createInsertSchema(
  schema.scheduleTriggerRunsTable,
  insertRunExtendedFields,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateScheduleTriggerRunSchema = createUpdateSchema(
  schema.scheduleTriggerRunsTable,
  insertRunExtendedFields,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ScheduleTrigger = z.infer<typeof SelectScheduleTriggerSchema>;
export type InsertScheduleTrigger = z.infer<typeof InsertScheduleTriggerSchema>;
export type UpdateScheduleTrigger = z.infer<typeof UpdateScheduleTriggerSchema>;

export type ScheduleTriggerRun = z.infer<typeof SelectScheduleTriggerRunSchema>;
export type InsertScheduleTriggerRun = z.infer<
  typeof InsertScheduleTriggerRunSchema
>;
export type UpdateScheduleTriggerRun = z.infer<
  typeof UpdateScheduleTriggerRunSchema
>;
