"use client";

import type { UIMessage } from "@ai-sdk/react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleTriggerRunPage } from "./schedule-trigger-run-client";

const mockUseScheduleTrigger = vi.fn();
const mockUseScheduleTriggerRun = vi.fn();
const mockUseCreateScheduleTriggerRunConversation = vi.fn();
const mockUseConversation = vi.fn();
const mockUseChatSession = vi.fn();
const mockUseInteractions = vi.fn();
const mockUseChatModels = vi.fn();
const mockUseModelsByProvider = vi.fn();
const mockUseOrganization = vi.fn();
const mockUseInternalAgents = vi.fn();
const mockUseUpdateConversation = vi.fn();
const mockUseStopChatStream = vi.fn();

vi.mock("@/lib/schedule-trigger.query", () => ({
  useScheduleTrigger: (...args: unknown[]) => mockUseScheduleTrigger(...args),
  useScheduleTriggerRun: (...args: unknown[]) => mockUseScheduleTriggerRun(...args),
  useCreateScheduleTriggerRunConversation: (...args: unknown[]) =>
    mockUseCreateScheduleTriggerRunConversation(...args),
}));

vi.mock("@/lib/chat/chat.query", () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
  useUpdateConversation: (...args: unknown[]) => mockUseUpdateConversation(...args),
  useStopChatStream: (...args: unknown[]) => mockUseStopChatStream(...args),
}));

vi.mock("@/lib/chat/global-chat.context", () => ({
  useChatSession: (...args: unknown[]) => mockUseChatSession(...args),
}));

vi.mock("@/lib/interactions/interaction.query", () => ({
  useInteractions: (...args: unknown[]) => mockUseInteractions(...args),
}));

vi.mock("@/lib/chat/chat-models.query", () => ({
  useChatModels: (...args: unknown[]) => mockUseChatModels(...args),
  useModelsByProvider: (...args: unknown[]) => mockUseModelsByProvider(...args),
}));

vi.mock("@/lib/organization.query", () => ({
  useOrganization: (...args: unknown[]) => mockUseOrganization(...args),
}));

vi.mock("@/lib/agent.query", () => ({
  useInternalAgents: (...args: unknown[]) => mockUseInternalAgents(...args),
}));

vi.mock("@/components/chat/chat-messages", () => ({
  ChatMessages: () => <div data-testid="chat-messages" />,
}));

vi.mock("@/app/chat/prompt-input", () => ({
  default: () => <div data-testid="prompt-input" />,
}));

function makeTrigger() {
  return {
    id: "trigger-1",
    organizationId: "org-1",
    name: "Morning summary",
    agentId: "agent-1",
    messageTemplate: "Run the report",
    scheduleKind: "cron" as const,
    cronExpression: "0 9 * * 1-5",
    timezone: "UTC",
    enabled: true,
    actorUserId: "user-1",
    nextDueAt: null,
    lastRunAt: null,
    lastRunStatus: "success" as const,
    lastError: null,
    createdAt: "2026-03-24T09:00:00.000Z",
    updatedAt: "2026-03-24T09:00:00.000Z",
    agent: { id: "agent-1", name: "Agent One", agentType: "agent" },
  };
}

function makeRun(
  overrides: Partial<{
    chatConversationId: string | null;
    status: "pending" | "running" | "success" | "failed";
    completedAt: string | null;
  }> = {},
) {
  return {
    id: "run-1",
    organizationId: "org-1",
    triggerId: "trigger-1",
    runKind: "manual" as const,
    status: "success" as const,
    dueAt: null,
    initiatedByUserId: "user-1",
    agentIdSnapshot: "agent-1",
    messageTemplateSnapshot: "Run the report",
    actorUserIdSnapshot: "user-1",
    timezoneSnapshot: "UTC",
    cronExpressionSnapshot: "0 9 * * 1-5",
    chatConversationId: null,
    startedAt: "2026-03-24T09:00:00.000Z",
    completedAt: "2026-03-24T09:01:00.000Z",
    error: null,
    createdAt: "2026-03-24T09:00:00.000Z",
    updatedAt: "2026-03-24T09:01:00.000Z",
    ...overrides,
  };
}

function makeConversation(messages: UIMessage[] = []) {
  return {
    id: "conv-1",
    title: null,
    organizationId: "org-1",
    userId: "user-1",
    agentId: "agent-1",
    selectedModel: "gpt-4.1",
    selectedProvider: "openai",
    chatApiKeyId: null,
    artifact: null,
    pinnedAt: null,
    createdAt: "2026-03-24T09:01:00.000Z",
    updatedAt: "2026-03-24T09:01:00.000Z",
    agent: {
      id: "agent-1",
      name: "Agent One",
      systemPrompt: null,
      agentType: "agent",
      llmApiKeyId: null,
    },
    messages,
  };
}

function makeChatSession(
  overrides: Partial<ReturnType<typeof makeChatSessionBase>> = {},
) {
  return {
    ...makeChatSessionBase(),
    ...overrides,
  };
}

function makeChatSessionBase() {
  return {
    messages: [] as UIMessage[],
    status: "ready" as const,
    error: undefined,
    sendMessage: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
    optimisticToolCalls: [],
    addToolApprovalResponse: vi.fn(),
    tokenUsage: null,
  };
}

describe("ScheduleTriggerRunPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseScheduleTrigger.mockReturnValue({
      data: makeTrigger(),
      isLoading: false,
    });
    mockUseScheduleTriggerRun.mockReturnValue({
      data: makeRun(),
      isLoading: false,
    });
    mockUseInteractions.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
    mockUseChatModels.mockReturnValue({ data: [] });
    mockUseModelsByProvider.mockReturnValue({ modelsByProvider: {} });
    mockUseOrganization.mockReturnValue({ data: { allowChatFileUploads: false } });
    mockUseInternalAgents.mockReturnValue({ data: [] });
    mockUseUpdateConversation.mockReturnValue({ mutate: vi.fn() });
    mockUseStopChatStream.mockReturnValue({ mutateAsync: vi.fn() });
  });

  it("uses the created conversation id immediately instead of waiting for the run refetch", async () => {
    const conversation = makeConversation();

    mockUseCreateScheduleTriggerRunConversation.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ id: conversation.id }),
    });

    mockUseConversation.mockImplementation((conversationId?: string) => ({
      data: conversationId === conversation.id ? conversation : null,
      isLoading: false,
    }));
    mockUseChatSession.mockImplementation((conversationId?: string) =>
      conversationId === conversation.id ? makeChatSession() : null,
    );

    render(<ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("chat-messages")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("prompt-input")).toBeInTheDocument();
    expect(
      screen.queryByText("Creating a conversation from this run..."),
    ).not.toBeInTheDocument();
  });

  it("stops the infinite loading loop and shows a retry state when creation fails", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("boom"));

    mockUseCreateScheduleTriggerRunConversation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    mockUseConversation.mockReturnValue({ data: null, isLoading: false });
    mockUseChatSession.mockReturnValue(null);

    render(<ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />);

    await waitFor(() =>
      expect(
        screen.getByText("Unable to prepare a chat conversation for this run."),
      ).toBeInTheDocument(),
    );

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("re-syncs an existing linked conversation when the page is reopened", async () => {
    const conversation = makeConversation();
    const mutateAsync = vi.fn().mockResolvedValue({ id: conversation.id });

    mockUseScheduleTriggerRun.mockReturnValue({
      data: makeRun({ chatConversationId: conversation.id }),
      isLoading: false,
    });
    mockUseCreateScheduleTriggerRunConversation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    mockUseConversation.mockReturnValue({
      data: conversation,
      isLoading: false,
    });
    mockUseChatSession.mockReturnValue(makeChatSession());

    render(<ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("chat-messages")).toBeInTheDocument();
  });

  it("keeps the chat read-only while the original run is still active", async () => {
    const conversation = makeConversation();

    mockUseScheduleTriggerRun.mockReturnValue({
      data: makeRun({
        chatConversationId: conversation.id,
        status: "running" as const,
        completedAt: null,
      }),
      isLoading: false,
    });
    mockUseCreateScheduleTriggerRunConversation.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ id: conversation.id }),
    });
    mockUseConversation.mockReturnValue({
      data: conversation,
      isLoading: false,
    });
    mockUseChatSession.mockReturnValue(makeChatSession());

    render(<ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />);

    await waitFor(() =>
      expect(
        screen.getByText("Waiting for run to finish..."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("prompt-input")).not.toBeInTheDocument();
  });

  it("syncs again when a run transitions from active to completed", async () => {
    const conversation = makeConversation();
    let currentRun = makeRun({
      chatConversationId: conversation.id,
      status: "running" as const,
      completedAt: null,
    });
    const mutateAsync = vi.fn().mockResolvedValue({ id: conversation.id });

    mockUseScheduleTriggerRun.mockImplementation(() => ({
      data: currentRun,
      isLoading: false,
    }));
    mockUseCreateScheduleTriggerRunConversation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    mockUseConversation.mockReturnValue({
      data: conversation,
      isLoading: false,
    });
    mockUseChatSession.mockReturnValue(makeChatSession());

    const { rerender } = render(
      <ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />,
    );

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    currentRun = makeRun({
      chatConversationId: conversation.id,
      status: "success" as const,
    });

    rerender(<ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
  });

  it("replaces the in-progress placeholder with the final run output after completion", async () => {
    const placeholderMessages = [
      {
        id: "msg-user-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Run the report" }],
      },
      {
        id: "msg-assistant-1",
        role: "assistant" as const,
        parts: [
          {
            type: "text" as const,
            text: "This scheduled run is still in progress. Chat will unlock when the original run finishes.",
          },
        ],
      },
    ] satisfies UIMessage[];
    const completedMessages = [
      placeholderMessages[0],
      {
        id: "msg-assistant-1",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Final run output" }],
      },
    ] satisfies UIMessage[];
    const setMessages = vi.fn();
    let currentRun = makeRun({
      chatConversationId: "conv-1",
      status: "running" as const,
      completedAt: null,
    });
    let currentConversation = makeConversation(placeholderMessages);
    const mutateAsync = vi.fn().mockResolvedValue({ id: "conv-1" });

    mockUseScheduleTriggerRun.mockImplementation(() => ({
      data: currentRun,
      isLoading: false,
    }));
    mockUseCreateScheduleTriggerRunConversation.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
    mockUseConversation.mockImplementation(() => ({
      data: currentConversation,
      isLoading: false,
    }));
    mockUseChatSession.mockImplementation(() =>
      makeChatSession({
        messages: placeholderMessages,
        setMessages,
      }),
    );

    const { rerender } = render(
      <ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />,
    );

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    currentRun = makeRun({
      chatConversationId: "conv-1",
      status: "success" as const,
    });
    currentConversation = makeConversation(completedMessages);

    rerender(<ScheduleTriggerRunPage triggerId="trigger-1" runId="run-1" />);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(setMessages).toHaveBeenCalledWith(completedMessages),
    );
  });
});
