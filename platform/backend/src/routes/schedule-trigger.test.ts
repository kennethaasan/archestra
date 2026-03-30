import { vi } from "vitest";
import { InteractionModel } from "@/models";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

const mockEnqueue = vi.hoisted(() => vi.fn().mockResolvedValue("task-id"));

vi.mock("@/task-queue", () => ({
  taskQueueService: {
    enqueue: mockEnqueue,
  },
}));

describe("schedule trigger routes", () => {
  let app: FastifyInstanceWithZod;
  let user: User;
  let organizationId: string;

  beforeEach(async ({ makeMember, makeOrganization, makeUser }) => {
    vi.clearAllMocks();

    user = await makeUser();
    const organization = await makeOrganization();
    organizationId = organization.id;
    await makeMember(user.id, organizationId, { role: "editor" });

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      (
        request as typeof request & {
          user: User;
          organizationId: string;
        }
      ).user = user;
      (
        request as typeof request & {
          user: User;
          organizationId: string;
        }
      ).organizationId = organizationId;
    });

    const { default: scheduleTriggerRoutes } = await import(
      "./schedule-trigger"
    );
    await app.register(scheduleTriggerRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("creates, lists, and reads schedule triggers", async ({
    makeInternalAgent,
    makeTeam,
    makeTeamMember,
  }) => {
    const team = await makeTeam(organizationId, user.id, { name: "Ops" });
    await makeTeamMember(team.id, user.id);
    const agent = await makeInternalAgent({
      organizationId,
      scope: "team",
      teams: [team.id],
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-triggers",
      payload: {
        name: "Daily report",
        agentId: agent.id,
        cronExpression: "0 9 * * 1-5",
        timezone: "Europe/Oslo",
        messageTemplate: "Share the weekday report",
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json();
    expect(created).toMatchObject({
      name: "Daily report",
      agentId: agent.id,
      actorUserId: user.id,
      enabled: true,
      actor: {
        id: user.id,
      },
      agent: {
        id: agent.id,
        name: agent.name,
      },
    });
    expect(created.nextDueAt).toBeTruthy();

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/schedule-triggers?limit=10&offset=0",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      data: [expect.objectContaining({ id: created.id, name: "Daily report" })],
      pagination: expect.objectContaining({ total: 1 }),
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-triggers/${created.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ id: created.id });
  });

  test("run-now creates a manual run snapshot and enqueues execution", async ({
    makeInternalAgent,
  }) => {
    const agent = await makeInternalAgent({
      organizationId,
      scope: "org",
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-triggers",
      payload: {
        name: "Manual trigger",
        agentId: agent.id,
        cronExpression: "0 12 * * *",
        timezone: "UTC",
        messageTemplate: "Use the current snapshot",
      },
    });
    const created = createResponse.json();

    const runNowResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/run-now`,
    });

    expect(runNowResponse.statusCode).toBe(200);
    expect(runNowResponse.json()).toMatchObject({
      triggerId: created.id,
      runKind: "manual",
      initiatedByUserId: user.id,
      actorUserIdSnapshot: user.id,
      messageTemplateSnapshot: "Use the current snapshot",
    });
    expect(mockEnqueue).toHaveBeenCalledWith({
      taskType: "schedule_trigger_run_execute",
      payload: { runId: runNowResponse.json().id },
      tx: expect.anything(),
    });

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-triggers/${created.id}/runs?limit=10&offset=0`,
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toMatchObject({
      data: [expect.objectContaining({ runKind: "manual" })],
      pagination: expect.objectContaining({ total: 1 }),
    });
  });

  test("rolls back the manual run when enqueueing fails", async ({
    makeInternalAgent,
  }) => {
    const agent = await makeInternalAgent({
      organizationId,
      scope: "org",
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-triggers",
      payload: {
        name: "Manual trigger",
        agentId: agent.id,
        cronExpression: "0 12 * * *",
        timezone: "UTC",
        messageTemplate: "Use the current snapshot",
      },
    });
    const created = createResponse.json();

    mockEnqueue.mockRejectedValueOnce(new Error("queue unavailable"));

    const runNowResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/run-now`,
    });

    expect(runNowResponse.statusCode).toBe(500);

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-triggers/${created.id}/runs?limit=10&offset=0`,
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toMatchObject({
      data: [],
      pagination: expect.objectContaining({ total: 0 }),
    });
  });

  test("updates an existing schedule trigger", async ({
    makeInternalAgent,
  }) => {
    const agent = await makeInternalAgent({
      organizationId,
      scope: "org",
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-triggers",
      payload: {
        name: "Daily digest",
        agentId: agent.id,
        cronExpression: "0 9 * * 1-5",
        timezone: "Europe/Oslo",
        messageTemplate: "Initial prompt",
      },
    });
    const created = createResponse.json();

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/schedule-triggers/${created.id}`,
      payload: {
        cronExpression: "30 14 * * 1-5",
        messageTemplate: "Updated prompt",
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: created.id,
      cronExpression: "30 14 * * 1-5",
      timezone: "Europe/Oslo",
      messageTemplate: "Updated prompt",
      actorUserId: user.id,
    });
    expect(updateResponse.json().nextDueAt).toBeTruthy();
  });

  test("refreshes an existing run conversation with real output once the run response exists", async ({
    makeInternalAgent,
  }) => {
    const agent = await makeInternalAgent({
      organizationId,
      scope: "org",
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-triggers",
      payload: {
        name: "Output sync",
        agentId: agent.id,
        cronExpression: "0 12 * * *",
        timezone: "UTC",
        messageTemplate: "Summarize the latest run",
      },
    });
    const created = createResponse.json();

    const runNowResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/run-now`,
    });
    const run = runNowResponse.json();

    const initialConversationResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/runs/${run.id}/conversation`,
    });

    expect(initialConversationResponse.statusCode).toBe(200);
    expect(initialConversationResponse.json()).toMatchObject({
      title: "Summarize the latest run",
      messages: [
        expect.objectContaining({
          role: "user",
          parts: [{ type: "text", text: "Summarize the latest run" }],
        }),
        expect.objectContaining({
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "This scheduled run is still in progress. Chat will unlock when the original run finishes.",
            },
          ],
        }),
      ],
    });

    await InteractionModel.create({
      profileId: agent.id,
      userId: user.id,
      sessionId: `schedule-trigger-run:${run.id}`,
      source: "chat",
      request: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Summarize the latest run" }],
      },
      response: {
        id: "chatcmpl-run-output",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Final synced run output",
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      },
      type: "openai:chatCompletions",
      model: "gpt-4o",
      inputTokens: 10,
      outputTokens: 10,
    });

    const refreshedConversationResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/runs/${run.id}/conversation`,
    });

    expect(refreshedConversationResponse.statusCode).toBe(200);
    expect(refreshedConversationResponse.json()).toMatchObject({
      id: initialConversationResponse.json().id,
      title: "Summarize the latest run",
      messages: [
        expect.objectContaining({
          role: "user",
          parts: [{ type: "text", text: "Summarize the latest run" }],
        }),
        expect.objectContaining({
          role: "assistant",
          parts: [{ type: "text", text: "Final synced run output" }],
        }),
      ],
    });
  });

  test("refreshes the seeded assistant message even after follow-up replies", async ({
    makeInternalAgent,
  }) => {
    const agent = await makeInternalAgent({
      organizationId,
      scope: "org",
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-triggers",
      payload: {
        name: "Output sync with replies",
        agentId: agent.id,
        cronExpression: "0 12 * * *",
        timezone: "UTC",
        messageTemplate: "Summarize the latest run",
      },
    });
    const created = createResponse.json();

    const runNowResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/run-now`,
    });
    const run = runNowResponse.json();

    const initialConversationResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/runs/${run.id}/conversation`,
    });
    const conversation = initialConversationResponse.json();
    const MessageModel = (await import("@/models/message")).default;

    await MessageModel.bulkCreate([
      {
        conversationId: conversation.id,
        role: "user",
        content: {
          role: "user",
          parts: [{ type: "text", text: "Please keep going" }],
        },
        createdAt: new Date(Date.now() + 10),
      },
      {
        conversationId: conversation.id,
        role: "assistant",
        content: {
          role: "assistant",
          parts: [{ type: "text", text: "Waiting for the run to finish." }],
        },
        createdAt: new Date(Date.now() + 11),
      },
    ]);

    await InteractionModel.create({
      profileId: agent.id,
      userId: user.id,
      sessionId: `schedule-trigger-run:${run.id}`,
      source: "chat",
      request: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Summarize the latest run" }],
      },
      response: {
        id: "chatcmpl-run-output-with-replies",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Final synced run output",
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      },
      type: "openai:chatCompletions",
      model: "gpt-4o",
      inputTokens: 10,
      outputTokens: 10,
    });

    const refreshedConversationResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-triggers/${created.id}/runs/${run.id}/conversation`,
    });

    expect(refreshedConversationResponse.statusCode).toBe(200);
    expect(refreshedConversationResponse.json()).toMatchObject({
      id: conversation.id,
      messages: [
        expect.objectContaining({
          role: "user",
          parts: [{ type: "text", text: "Summarize the latest run" }],
        }),
        expect.objectContaining({
          role: "assistant",
          parts: [{ type: "text", text: "Final synced run output" }],
        }),
        expect.objectContaining({
          role: "user",
          parts: [{ type: "text", text: "Please keep going" }],
        }),
        expect.objectContaining({
          role: "assistant",
          parts: [{ type: "text", text: "Waiting for the run to finish." }],
        }),
      ],
    });
  });

  test("rejects create when the user lacks access to the selected agent", async ({
    makeInternalAgent,
    makeTeam,
    makeUser,
  }) => {
    const otherUser = await makeUser();
    const otherTeam = await makeTeam(organizationId, otherUser.id, {
      name: "Private team",
    });
    const agent = await makeInternalAgent({
      organizationId,
      scope: "team",
      teams: [otherTeam.id],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-triggers",
      payload: {
        name: "Forbidden",
        agentId: agent.id,
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        messageTemplate: "No access",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        message: "You do not have access to the selected agent",
        type: "api_authorization_error",
      },
    });
  });
});
