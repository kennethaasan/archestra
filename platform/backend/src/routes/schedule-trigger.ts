import {
  calculatePaginationMeta,
  createPaginatedResponseSchema,
  PaginationQuerySchema,
  RouteId,
} from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { hasAnyAgentTypeAdminPermission } from "@/auth";
import db from "@/database";
import {
  AgentModel,
  AgentTeamModel,
  ScheduleTriggerModel,
  ScheduleTriggerRunModel,
} from "@/models";
import { calculateNextDueAt } from "@/schedule-triggers/utils";
import { taskQueueService } from "@/task-queue";
import {
  ApiError,
  constructResponseSchema,
  DeleteObjectResponseSchema,
  ScheduleTriggerConfigurationSchema,
  ScheduleTriggerConfigurationSchemaBase,
  SelectScheduleTriggerRunSchema,
  SelectScheduleTriggerSchema,
  UuidIdSchema,
} from "@/types";

const ScheduleTriggerBodyFieldsSchema = z.object({
  name: z.string().min(1),
  agentId: UuidIdSchema,
  enabled: z.boolean().optional().default(true),
  ...ScheduleTriggerConfigurationSchemaBase.shape,
});

const CreateScheduleTriggerBodySchema =
  ScheduleTriggerBodyFieldsSchema.superRefine((data, ctx) => {
    const result = ScheduleTriggerConfigurationSchema.safeParse(data);
    if (result.success) {
      return;
    }

    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
        path: issue.path,
      });
    }
  });

const UpdateScheduleTriggerBodySchema =
  ScheduleTriggerBodyFieldsSchema.partial().superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field must be provided",
      });
      return;
    }

    const result =
      ScheduleTriggerConfigurationSchemaBase.partial().safeParse(data);
    if (result.success) {
      return;
    }

    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
        path: issue.path,
      });
    }
  });

const scheduleTriggerRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/schedule-triggers",
    {
      schema: {
        operationId: RouteId.GetScheduleTriggers,
        description: "List scheduled agent triggers",
        tags: ["Schedule Triggers"],
        querystring: PaginationQuerySchema.extend({
          enabled: z
            .preprocess(
              (value) =>
                value === undefined
                  ? undefined
                  : value === "true" || value === true,
              z.boolean(),
            )
            .optional(),
        }),
        response: constructResponseSchema(
          createPaginatedResponseSchema(SelectScheduleTriggerSchema),
        ),
      },
    },
    async (
      { query: { limit, offset, enabled }, user, organizationId },
      reply,
    ) => {
      const isAgentAdmin = await hasAnyAgentTypeAdminPermission({
        userId: user.id,
        organizationId,
      });
      const accessibleAgentIds = isAgentAdmin
        ? undefined
        : await AgentTeamModel.getUserAccessibleAgentIds(user.id, false);

      const [data, total] = await Promise.all([
        ScheduleTriggerModel.listByOrganization({
          organizationId,
          limit,
          offset,
          enabled,
          agentIds: accessibleAgentIds,
        }),
        ScheduleTriggerModel.countByOrganization({
          organizationId,
          enabled,
          agentIds: accessibleAgentIds,
        }),
      ]);

      return reply.send({
        data,
        pagination: calculatePaginationMeta(total, { limit, offset }),
      });
    },
  );

  fastify.post(
    "/api/schedule-triggers",
    {
      schema: {
        operationId: RouteId.CreateScheduleTrigger,
        description: "Create a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        body: CreateScheduleTriggerBodySchema,
        response: constructResponseSchema(SelectScheduleTriggerSchema),
      },
    },
    async ({ body, user, organizationId }, reply) => {
      const isAgentAdmin = await hasAnyAgentTypeAdminPermission({
        userId: user.id,
        organizationId,
      });

      const agent = await AgentModel.findById(
        body.agentId,
        user.id,
        isAgentAdmin,
      );
      if (!agent) {
        throw new ApiError(403, "You do not have access to the selected agent");
      }

      if (
        agent.organizationId !== organizationId ||
        agent.agentType !== "agent"
      ) {
        throw new ApiError(400, "Scheduled triggers require an internal agent");
      }

      const trigger = await ScheduleTriggerModel.create({
        organizationId,
        name: body.name,
        agentId: body.agentId,
        messageTemplate: body.messageTemplate,
        scheduleKind: "cron",
        cronExpression: body.cronExpression,
        timezone: body.timezone,
        enabled: body.enabled ?? true,
        actorUserId: user.id,
        nextDueAt:
          (body.enabled ?? true)
            ? calculateNextDueAt({
                cronExpression: body.cronExpression,
                timezone: body.timezone,
              })
            : null,
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      return reply.send(trigger);
    },
  );

  fastify.get(
    "/api/schedule-triggers/:id",
    {
      schema: {
        operationId: RouteId.GetScheduleTrigger,
        description: "Get a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        params: z.object({ id: UuidIdSchema }),
        response: constructResponseSchema(SelectScheduleTriggerSchema),
      },
    },
    async ({ params: { id }, user, organizationId }, reply) => {
      const trigger = await findAccessibleTriggerOrThrow({
        id,
        userId: user.id,
        organizationId,
      });

      return reply.send(trigger);
    },
  );

  fastify.put(
    "/api/schedule-triggers/:id",
    {
      schema: {
        operationId: RouteId.UpdateScheduleTrigger,
        description: "Update a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        params: z.object({ id: UuidIdSchema }),
        body: UpdateScheduleTriggerBodySchema,
        response: constructResponseSchema(SelectScheduleTriggerSchema),
      },
    },
    async ({ params: { id }, body, user, organizationId }, reply) => {
      const existing = await findAccessibleTriggerOrThrow({
        id,
        userId: user.id,
        organizationId,
      });
      const isAgentAdmin = await hasAnyAgentTypeAdminPermission({
        userId: user.id,
        organizationId,
      });

      const agentId = body.agentId ?? existing.agentId;
      const agent = await AgentModel.findById(agentId, user.id, isAgentAdmin);
      if (!agent) {
        throw new ApiError(403, "You do not have access to the selected agent");
      }

      if (
        agent.organizationId !== organizationId ||
        agent.agentType !== "agent"
      ) {
        throw new ApiError(400, "Scheduled triggers require an internal agent");
      }

      const enabled = body.enabled ?? existing.enabled;
      const cronExpression = body.cronExpression ?? existing.cronExpression;
      const timezone = body.timezone ?? existing.timezone;
      const messageTemplate = body.messageTemplate ?? existing.messageTemplate;
      const validation = ScheduleTriggerConfigurationSchema.safeParse({
        cronExpression,
        timezone,
        messageTemplate,
      });
      if (!validation.success) {
        const firstIssue = validation.error.issues[0];
        throw new ApiError(
          400,
          firstIssue?.message ?? "Invalid schedule trigger configuration",
        );
      }
      const shouldRecalculateNextDueAt =
        body.enabled !== undefined ||
        body.cronExpression !== undefined ||
        body.timezone !== undefined;

      const updated = await ScheduleTriggerModel.update(id, {
        ...body,
        actorUserId: user.id,
        enabled,
        nextDueAt: shouldRecalculateNextDueAt
          ? enabled
            ? calculateNextDueAt({ cronExpression, timezone })
            : null
          : existing.nextDueAt,
      });

      if (!updated) {
        throw new ApiError(404, "Schedule trigger not found");
      }

      return reply.send(updated);
    },
  );

  fastify.delete(
    "/api/schedule-triggers/:id",
    {
      schema: {
        operationId: RouteId.DeleteScheduleTrigger,
        description: "Delete a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        params: z.object({ id: UuidIdSchema }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { id }, user, organizationId }, reply) => {
      await findAccessibleTriggerOrThrow({
        id,
        userId: user.id,
        organizationId,
      });

      const success = await ScheduleTriggerModel.delete(id);
      if (!success) {
        throw new ApiError(404, "Schedule trigger not found");
      }

      return reply.send({ success: true });
    },
  );

  fastify.post(
    "/api/schedule-triggers/:id/enable",
    {
      schema: {
        operationId: RouteId.EnableScheduleTrigger,
        description: "Enable a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        params: z.object({ id: UuidIdSchema }),
        response: constructResponseSchema(SelectScheduleTriggerSchema),
      },
    },
    async ({ params: { id }, user, organizationId }, reply) => {
      const trigger = await findAccessibleTriggerOrThrow({
        id,
        userId: user.id,
        organizationId,
      });

      const updated = await ScheduleTriggerModel.update(id, {
        enabled: true,
        actorUserId: user.id,
        nextDueAt: calculateNextDueAt({
          cronExpression: trigger.cronExpression,
          timezone: trigger.timezone,
        }),
      });

      if (!updated) {
        throw new ApiError(404, "Schedule trigger not found");
      }

      return reply.send(updated);
    },
  );

  fastify.post(
    "/api/schedule-triggers/:id/disable",
    {
      schema: {
        operationId: RouteId.DisableScheduleTrigger,
        description: "Disable a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        params: z.object({ id: UuidIdSchema }),
        response: constructResponseSchema(SelectScheduleTriggerSchema),
      },
    },
    async ({ params: { id }, user, organizationId }, reply) => {
      await findAccessibleTriggerOrThrow({
        id,
        userId: user.id,
        organizationId,
      });

      const updated = await ScheduleTriggerModel.update(id, {
        enabled: false,
        actorUserId: user.id,
        nextDueAt: null,
      });

      if (!updated) {
        throw new ApiError(404, "Schedule trigger not found");
      }

      return reply.send(updated);
    },
  );

  fastify.post(
    "/api/schedule-triggers/:id/run-now",
    {
      schema: {
        operationId: RouteId.RunScheduleTriggerNow,
        description: "Run a scheduled agent trigger immediately",
        tags: ["Schedule Triggers"],
        params: z.object({ id: UuidIdSchema }),
        response: constructResponseSchema(SelectScheduleTriggerRunSchema),
      },
    },
    async ({ params: { id }, user, organizationId }, reply) => {
      const trigger = await findAccessibleTriggerOrThrow({
        id,
        userId: user.id,
        organizationId,
      });

      const run = await db.transaction(async (tx) => {
        const createdRun = await ScheduleTriggerRunModel.createManualRun({
          trigger,
          initiatedByUserId: user.id,
          txOrDb: tx,
        });

        await taskQueueService.enqueue({
          taskType: "schedule_trigger_run_execute",
          payload: { runId: createdRun.id },
          tx,
        });

        return createdRun;
      });

      return reply.send(run);
    },
  );

  fastify.get(
    "/api/schedule-triggers/:id/runs",
    {
      schema: {
        operationId: RouteId.GetScheduleTriggerRuns,
        description: "List runs for a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        params: z.object({ id: UuidIdSchema }),
        querystring: PaginationQuerySchema,
        response: constructResponseSchema(
          createPaginatedResponseSchema(SelectScheduleTriggerRunSchema),
        ),
      },
    },
    async (
      { params: { id }, query: { limit, offset }, user, organizationId },
      reply,
    ) => {
      const trigger = await findAccessibleTriggerOrThrow({
        id,
        userId: user.id,
        organizationId,
      });

      const [data, total] = await Promise.all([
        ScheduleTriggerRunModel.listByTrigger({
          organizationId,
          triggerId: trigger.id,
          limit,
          offset,
        }),
        ScheduleTriggerRunModel.countByTrigger({
          organizationId,
          triggerId: trigger.id,
        }),
      ]);

      return reply.send({
        data,
        pagination: calculatePaginationMeta(total, { limit, offset }),
      });
    },
  );
};

export default scheduleTriggerRoutes;

async function findAccessibleTriggerOrThrow(params: {
  id: string;
  userId: string;
  organizationId: string;
}): Promise<z.infer<typeof SelectScheduleTriggerSchema>> {
  const trigger = await ScheduleTriggerModel.findById(params.id);
  if (!trigger || trigger.organizationId !== params.organizationId) {
    throw new ApiError(404, "Schedule trigger not found");
  }

  const isAgentAdmin = await hasAnyAgentTypeAdminPermission({
    userId: params.userId,
    organizationId: params.organizationId,
  });

  if (!isAgentAdmin) {
    const hasAgentAccess = await AgentTeamModel.userHasAgentAccess(
      params.userId,
      trigger.agentId,
      false,
    );
    if (!hasAgentAccess) {
      throw new ApiError(403, "You do not have access to this agent");
    }
  }

  return trigger;
}
