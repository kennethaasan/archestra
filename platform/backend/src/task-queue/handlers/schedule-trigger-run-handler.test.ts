import { vi } from "vitest";
import { beforeEach, describe, expect, test } from "@/test";

const {
  mockHasAnyAgentTypeAdminPermission,
  mockExecuteA2AMessage,
  mockMarkRunningIfPending,
  mockMarkCompleted,
  mockRecordRunOutcome,
  mockGetById,
  mockUserHasAgentAccess,
  mockFindAgentById,
} = vi.hoisted(() => ({
  mockHasAnyAgentTypeAdminPermission: vi.fn().mockResolvedValue(false),
  mockExecuteA2AMessage: vi.fn().mockResolvedValue({
    messageId: "msg-1",
    text: "done",
    finishReason: "stop",
  }),
  mockMarkRunningIfPending: vi.fn(),
  mockMarkCompleted: vi.fn(),
  mockRecordRunOutcome: vi.fn(),
  mockGetById: vi.fn(),
  mockUserHasAgentAccess: vi.fn().mockResolvedValue(true),
  mockFindAgentById: vi.fn(),
}));

vi.mock("@/auth", () => ({
  hasAnyAgentTypeAdminPermission: mockHasAnyAgentTypeAdminPermission,
}));

vi.mock("@/agents/a2a-executor", () => ({
  executeA2AMessage: mockExecuteA2AMessage,
}));

vi.mock("@/models", () => ({
  ScheduleTriggerRunModel: {
    markRunningIfPending: mockMarkRunningIfPending,
    markCompleted: mockMarkCompleted,
  },
  ScheduleTriggerModel: {
    recordRunOutcome: mockRecordRunOutcome,
  },
  UserModel: {
    getById: mockGetById,
  },
  AgentTeamModel: {
    userHasAgentAccess: mockUserHasAgentAccess,
  },
  AgentModel: {
    findById: mockFindAgentById,
  },
}));

import { handleScheduleTriggerRunExecution } from "./schedule-trigger-run-handler";

describe("handleScheduleTriggerRunExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockHasAnyAgentTypeAdminPermission.mockResolvedValue(false);
    mockExecuteA2AMessage.mockResolvedValue({
      messageId: "msg-1",
      text: "done",
      finishReason: "stop",
    });
    mockUserHasAgentAccess.mockResolvedValue(true);
    mockMarkRunningIfPending.mockResolvedValue({
      id: "run-1",
      triggerId: "trigger-1",
      organizationId: "org-1",
      agentIdSnapshot: "agent-1",
      actorUserIdSnapshot: "user-1",
      messageTemplateSnapshot: "Run it",
      status: "running",
    });
    mockGetById.mockResolvedValue({
      id: "user-1",
      email: "actor@example.com",
      name: "Actor",
    });
    mockFindAgentById.mockResolvedValue({
      id: "agent-1",
      agentType: "agent",
      name: "Ops Agent",
    });
    mockMarkCompleted.mockResolvedValue({
      id: "run-1",
      triggerId: "trigger-1",
      status: "success",
      error: null,
      completedAt: new Date("2026-03-18T10:00:00.000Z"),
    });
  });

  test("executes the run using the stored actor permissions", async () => {
    await handleScheduleTriggerRunExecution({ runId: "run-1" });

    expect(mockExecuteA2AMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        userId: "user-1",
        userIsAgentAdmin: false,
        sessionId: "schedule-trigger-run:run-1",
      }),
    );
    expect(mockMarkCompleted).toHaveBeenCalledWith({
      runId: "run-1",
      status: "success",
      error: null,
    });
    expect(mockRecordRunOutcome).toHaveBeenCalled();
  });

  test("records a failed run when the actor loses access", async () => {
    mockUserHasAgentAccess.mockResolvedValue(false);
    mockMarkCompleted.mockResolvedValue({
      id: "run-1",
      triggerId: "trigger-1",
      status: "failed",
      error: "Scheduled trigger actor no longer has access to the target agent",
      completedAt: new Date("2026-03-18T10:05:00.000Z"),
    });

    await handleScheduleTriggerRunExecution({ runId: "run-1" });

    expect(mockExecuteA2AMessage).not.toHaveBeenCalled();
    expect(mockMarkCompleted).toHaveBeenCalledWith({
      runId: "run-1",
      status: "failed",
      error: "Scheduled trigger actor no longer has access to the target agent",
    });
  });

  test("adds guidance when the selected model only supports the Interactions API", async () => {
    mockExecuteA2AMessage.mockRejectedValueOnce(
      new Error("This model only supports Interactions API."),
    );
    mockMarkCompleted.mockResolvedValue({
      id: "run-1",
      triggerId: "trigger-1",
      status: "failed",
      error:
        "This model only supports Interactions API. Scheduled triggers need a different chat-capable model for this agent. Pick a model that supports standard text and tool execution for scheduled runs, then try again.",
      completedAt: new Date("2026-03-18T10:10:00.000Z"),
    });

    await handleScheduleTriggerRunExecution({ runId: "run-1" });

    expect(mockMarkCompleted).toHaveBeenCalledWith({
      runId: "run-1",
      status: "failed",
      error:
        "This model only supports Interactions API. Scheduled triggers need a different chat-capable model for this agent. Pick a model that supports standard text and tool execution for scheduled runs, then try again.",
    });
  });
});
