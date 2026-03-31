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
  ConversationModel,
  InteractionModel,
  MessageModel,
  ScheduleTriggerModel,
  ScheduleTriggerRunModel,
} from "@/models";
import { calculateNextDueAt } from "@/schedule-triggers/utils";
import { resolveConversationLlmSelectionForAgent } from "@/services/conversation-llm-selection";
import { taskQueueService } from "@/task-queue";
import {
  ApiError,
  type ChatMessage,
  constructResponseSchema,
  DeleteObjectResponseSchema,
  type Message,
  ScheduleTriggerConfigurationSchema,
  ScheduleTriggerConfigurationSchemaBase,
  SelectConversationSchema,
  ScheduleTriggerRunStatusSchema,
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
        querystring: PaginationQuerySchema.extend({
          status: ScheduleTriggerRunStatusSchema.optional(),
        }),
        response: constructResponseSchema(
          createPaginatedResponseSchema(SelectScheduleTriggerRunSchema),
        ),
      },
    },
    async (
      {
        params: { id },
        query: { limit, offset, status },
        user,
        organizationId,
      },
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
          status,
        }),
        ScheduleTriggerRunModel.countByTrigger({
          organizationId,
          triggerId: trigger.id,
          status,
        }),
      ]);

      return reply.send({
        data,
        pagination: calculatePaginationMeta(total, { limit, offset }),
      });
    },
  );

  fastify.get(
    "/api/schedule-triggers/:id/runs/:runId",
    {
      schema: {
        operationId: RouteId.GetScheduleTriggerRun,
        description: "Get a single run for a scheduled agent trigger",
        tags: ["Schedule Triggers"],
        params: z.object({
          id: UuidIdSchema,
          runId: UuidIdSchema,
        }),
        response: constructResponseSchema(SelectScheduleTriggerRunSchema),
      },
    },
    async ({ params: { id, runId }, user, organizationId }, reply) => {
      const run = await findAccessibleRunOrThrow({
        triggerId: id,
        runId,
        userId: user.id,
        organizationId,
      });

      return reply.send(run);
    },
  );

  fastify.post(
    "/api/schedule-triggers/:id/runs/:runId/conversation",
    {
      schema: {
        operationId: RouteId.CreateScheduleTriggerRunConversation,
        description:
          "Create or return the chat conversation linked to a schedule run",
        tags: ["Schedule Triggers"],
        params: z.object({
          id: UuidIdSchema,
          runId: UuidIdSchema,
        }),
        response: constructResponseSchema(SelectConversationSchema),
      },
    },
    async ({ params: { id, runId }, user, organizationId }, reply) => {
      const run = await findAccessibleRunOrThrow({
        triggerId: id,
        runId,
        userId: user.id,
        organizationId,
      });

      const conversation = await ensureRunConversation({
        run,
        userId: user.id,
        organizationId,
      });

      return reply.send(conversation);
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

async function findAccessibleRunOrThrow(params: {
  triggerId: string;
  runId: string;
  userId: string;
  organizationId: string;
}): Promise<z.infer<typeof SelectScheduleTriggerRunSchema>> {
  await findAccessibleTriggerOrThrow({
    id: params.triggerId,
    userId: params.userId,
    organizationId: params.organizationId,
  });

  const run = await ScheduleTriggerRunModel.findById(params.runId);
  if (
    !run ||
    run.organizationId !== params.organizationId ||
    run.triggerId !== params.triggerId
  ) {
    throw new ApiError(404, "Schedule trigger run not found");
  }

  return run;
}

async function ensureRunConversation(params: {
  run: z.infer<typeof SelectScheduleTriggerRunSchema>;
  userId: string;
  organizationId: string;
}): Promise<z.infer<typeof SelectConversationSchema>> {
  const { run, userId, organizationId } = params;

  const existingConversationId = run.chatConversationId;

  const agent = await AgentModel.findById(run.agentIdSnapshot);
  if (!agent || agent.organizationId !== organizationId) {
    throw new ApiError(
      400,
      "The agent used for this run no longer exists or is unavailable",
    );
  }

  const llmSelection = await resolveConversationLlmSelectionForAgent({
    agent: {
      llmApiKeyId: agent.llmApiKeyId ?? null,
      llmModel: agent.llmModel ?? null,
    },
    organizationId,
    userId,
  });

  const interactionResult = await InteractionModel.findAllPaginated(
    { limit: 50, offset: 0 },
    { sortBy: "createdAt", sortDirection: "desc" },
    userId,
    true,
    {
      profileId: run.agentIdSnapshot,
      sessionId: getScheduleTriggerRunSessionId(run.id),
    },
  );
  const output =
    extractScheduleRunOutputFromInteractions(interactionResult.data) ??
    getFallbackRunOutput(run);
  const conversationTitle = buildRunConversationSeedTitle(
    run.messageTemplateSnapshot,
  );

  const conversation = existingConversationId
    ? ((await ConversationModel.findById({
        id: existingConversationId,
        userId,
        organizationId,
      })) ??
      (await ConversationModel.create({
        userId,
        organizationId,
        agentId: run.agentIdSnapshot,
        title: conversationTitle,
        selectedModel: llmSelection.selectedModel,
        selectedProvider: llmSelection.selectedProvider,
        chatApiKeyId: llmSelection.chatApiKeyId,
      })))
    : await ConversationModel.create({
        userId,
        organizationId,
        agentId: run.agentIdSnapshot,
        title: conversationTitle,
        selectedModel: llmSelection.selectedModel,
        selectedProvider: llmSelection.selectedProvider,
        chatApiKeyId: llmSelection.chatApiKeyId,
      });

  const conversationMessages = await MessageModel.findByConversation(
    conversation.id,
  );

  if (conversationMessages.length === 0) {
    const messages = buildRunSeedMessages({
      prompt: run.messageTemplateSnapshot,
      output,
    });
    const createdAt = Date.now();

    await MessageModel.bulkCreate(
      messages.map((message, index) => ({
        conversationId: conversation.id,
        role: message.role,
        content: message,
        createdAt: new Date(createdAt + index),
      })),
    );
  } else if (
    shouldUpdateSeededRunAssistantMessage({
      messages: conversationMessages,
      prompt: run.messageTemplateSnapshot,
      latestOutput: output,
    })
  ) {
    await MessageModel.updateTextPart(
      conversationMessages[1].id,
      0,
      output.trim(),
    );
  }

  if (run.chatConversationId !== conversation.id) {
    await ScheduleTriggerRunModel.setChatConversationId({
      runId: run.id,
      chatConversationId: conversation.id,
    });
  }

  const refreshedConversation = await ConversationModel.findById({
    id: conversation.id,
    userId,
    organizationId,
  });
  if (!refreshedConversation) {
    throw new ApiError(500, "Failed to load the run conversation");
  }

  return refreshedConversation;
}

function shouldUpdateSeededRunAssistantMessage(params: {
  messages: Message[];
  prompt: string;
  latestOutput: string;
}): boolean {
  const { messages, prompt, latestOutput } = params;

  if (messages.length < 2) {
    return false;
  }

  const [userMessage, assistantMessage] = messages;
  if (userMessage.role !== "user" || assistantMessage.role !== "assistant") {
    return false;
  }

  const userText = getFirstTextPart(userMessage.content);
  const assistantText = getFirstTextPart(assistantMessage.content);

  if (!userText || !assistantText) {
    return false;
  }

  if (userText.trim() !== prompt.trim()) {
    return false;
  }

  if (!isRunSeedFallbackText(assistantText)) {
    return false;
  }

  return assistantText.trim() !== latestOutput.trim();
}

function buildRunConversationSeedTitle(prompt: string): string {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");

  if (!normalizedPrompt) {
    return "Scheduled run";
  }

  return normalizedPrompt.length > 72
    ? `${normalizedPrompt.slice(0, 69).trimEnd()}...`
    : normalizedPrompt;
}

function getFirstTextPart(content: unknown): string | null {
  if (!content || typeof content !== "object") {
    return null;
  }

  const candidate = content as {
    parts?: Array<{ type?: string; text?: string }>;
  };

  const textPart = candidate.parts?.find((part) => part.type === "text");
  return textPart?.text ?? null;
}

function isRunSeedFallbackText(text: string): boolean {
  const normalized = text.trim();

  return (
    normalized === RUN_OUTPUT_PENDING_PLACEHOLDER ||
    normalized === RUN_OUTPUT_PENDING_PLACEHOLDER_LEGACY ||
    normalized === RUN_OUTPUT_EMPTY_PLACEHOLDER ||
    normalized.startsWith(RUN_OUTPUT_FAILED_PREFIX)
  );
}

function buildRunSeedMessages(params: {
  prompt: string;
  output: string;
}): ChatMessage[] {
  return [
    {
      role: "user",
      parts: [{ type: "text", text: params.prompt }],
    },
    {
      role: "assistant",
      parts: [{ type: "text", text: params.output }],
    },
  ];
}

function getScheduleTriggerRunSessionId(runId: string): string {
  return `schedule-trigger-run:${runId}`;
}

function getFallbackRunOutput(
  run: z.infer<typeof SelectScheduleTriggerRunSchema>,
): string {
  if (run.error?.trim()) {
    return `${RUN_OUTPUT_FAILED_PREFIX}\n\n${run.error.trim()}`;
  }

  if (run.status === "pending" || run.status === "running") {
    return RUN_OUTPUT_PENDING_PLACEHOLDER;
  }

  return RUN_OUTPUT_EMPTY_PLACEHOLDER;
}

function extractScheduleRunOutputFromInteractions(
  interactions: Array<{ response?: unknown }>,
): string | null {
  for (const interaction of interactions) {
    const output = extractTextFromInteractionResponse(interaction.response);
    if (output) {
      return output;
    }
  }

  return null;
}

function extractTextFromInteractionResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidateResponse = response as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    choices?: Array<{
      message?: {
        content?:
          | string
          | Array<{ type?: string; text?: string; refusal?: string }>;
      };
    }>;
    content?: Array<{ type?: string; text?: string }>;
  };

  const geminiText = candidateResponse.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (geminiText) {
    return geminiText;
  }

  const openAiText = candidateResponse.choices
    ?.flatMap((choice) => {
      const content = choice.message?.content;
      if (typeof content === "string") {
        return [content.trim()];
      }

      return (content ?? []).flatMap((part) =>
        part.type === "text" || part.type === "output_text"
          ? [part.text?.trim()]
          : part.type === "refusal"
            ? [part.refusal?.trim()]
            : [],
      );
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  if (openAiText) {
    return openAiText;
  }

  const anthropicText = candidateResponse.content
    ?.flatMap((part) =>
      part.type === "text" || part.type === "output_text"
        ? [part.text?.trim()]
        : [],
    )
    .filter(Boolean)
    .join("\n")
    .trim();

  return anthropicText || null;
}

const RUN_OUTPUT_FAILED_PREFIX = "This scheduled run failed.";
const RUN_OUTPUT_PENDING_PLACEHOLDER =
  "This scheduled run is still in progress. Chat will unlock when the original run finishes.";
const RUN_OUTPUT_PENDING_PLACEHOLDER_LEGACY =
  "This scheduled run is still in progress. You can continue chatting while the original run finishes.";
const RUN_OUTPUT_EMPTY_PLACEHOLDER =
  "No output was captured for this scheduled run, but you can continue chatting from the prompt snapshot.";
