import { hasAnyAgentTypeAdminPermission } from "@/auth";
import { executeA2AMessage } from "@/agents/a2a-executor";
import logger from "@/logging";
import {
  AgentModel,
  AgentTeamModel,
  ScheduleTriggerModel,
  ScheduleTriggerRunModel,
  UserModel,
} from "@/models";

export async function handleScheduleTriggerRunExecution(
  payload: Record<string, unknown>,
): Promise<void> {
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (!runId) {
    throw new Error("Missing runId in schedule trigger execution payload");
  }

  const run = await ScheduleTriggerRunModel.markRunningIfPending(runId);
  if (!run) {
    return;
  }

  let status: "success" | "failed" = "success";
  let errorMessage: string | null = null;

  try {
    const actor = await UserModel.getById(run.actorUserIdSnapshot);
    if (!actor) {
      throw new Error("Scheduled trigger actor no longer exists");
    }

    const userIsAgentAdmin = await hasAnyAgentTypeAdminPermission({
      userId: actor.id,
      organizationId: run.organizationId,
    });

    const hasAgentAccess = await AgentTeamModel.userHasAgentAccess(
      actor.id,
      run.agentIdSnapshot,
      userIsAgentAdmin,
    );
    if (!hasAgentAccess) {
      throw new Error(
        "Scheduled trigger actor no longer has access to the target agent",
      );
    }

    const agent = await AgentModel.findById(run.agentIdSnapshot);
    if (!agent) {
      throw new Error("Scheduled trigger target agent no longer exists");
    }

    if (agent.agentType !== "agent") {
      throw new Error("Scheduled trigger target must be an internal agent");
    }

    await executeA2AMessage({
      agentId: run.agentIdSnapshot,
      message: run.messageTemplateSnapshot,
      organizationId: run.organizationId,
      userId: actor.id,
      userIsAgentAdmin,
      sessionId: `schedule-trigger-run:${run.id}`,
      conversationId: `schedule-trigger-run:${run.id}`,
      source: "api",
    });
  } catch (error) {
    status = "failed";
    errorMessage = formatScheduleTriggerExecutionError(
      error instanceof Error ? error.message : String(error),
    );
    logger.warn(
      { runId: run.id, triggerId: run.triggerId, error: errorMessage },
      "Scheduled trigger run failed",
    );
  }

  const completedRun = await ScheduleTriggerRunModel.markCompleted({
    runId: run.id,
    status,
    error: errorMessage,
  });

  if (!completedRun?.completedAt) {
    return;
  }

  await ScheduleTriggerModel.recordRunOutcome({
    triggerId: completedRun.triggerId,
    status: completedRun.status,
    completedAt: completedRun.completedAt,
    error: completedRun.error,
  });
}

function formatScheduleTriggerExecutionError(errorMessage: string): string {
  if (!errorMessage.includes("only supports Interactions API")) {
    return errorMessage;
  }

  return `${errorMessage} Scheduled triggers need a different chat-capable model for this agent. Pick a model that supports standard text and tool execution for scheduled runs, then try again.`;
}
