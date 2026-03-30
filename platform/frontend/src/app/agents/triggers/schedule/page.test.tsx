"use client";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mockUseProfiles = vi.fn();
const mockUseScheduleTrigger = vi.fn();
const mockUseScheduleTriggers = vi.fn();
const mockUseScheduleTriggerRuns = vi.fn();
const mockUseInteractions = vi.fn();
const mockUseHasPermissions = vi.fn();
const mockSearchableSelect = vi.fn();
const mockPush = vi.fn();
const mockGenerateConversationTitle = vi.fn();
const mockRunScheduleTriggerNow = vi.fn();
const mockCreateScheduleTriggerRunConversation = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/lib/agent.query", () => ({
  useProfiles: (...args: unknown[]) => mockUseProfiles(...args),
}));

vi.mock("@/lib/auth/auth.query", () => ({
  useHasPermissions: (...args: unknown[]) => mockUseHasPermissions(...args),
}));

vi.mock("@/lib/chat/chat.query", () => ({
  useGenerateConversationTitle: () => ({
    isPending: false,
    mutateAsync: mockGenerateConversationTitle,
  }),
}));

vi.mock("@/lib/interaction.query", () => ({
  useInteractions: (...args: unknown[]) => mockUseInteractions(...args),
}));

vi.mock("@/lib/schedule-trigger.query", () => ({
  useScheduleTriggers: (...args: unknown[]) => mockUseScheduleTriggers(...args),
  useScheduleTrigger: (...args: unknown[]) => mockUseScheduleTrigger(...args),
  useScheduleTriggerRuns: (...args: unknown[]) =>
    mockUseScheduleTriggerRuns(...args),
  useCreateScheduleTrigger: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdateScheduleTrigger: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useDeleteScheduleTrigger: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useEnableScheduleTrigger: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useDisableScheduleTrigger: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useRunScheduleTriggerNow: () => ({
    isPending: false,
    mutateAsync: mockRunScheduleTriggerNow,
  }),
  useCreateScheduleTriggerRunConversation: () => ({
    isPending: false,
    mutateAsync: mockCreateScheduleTriggerRunConversation,
  }),
}));

vi.mock("@/components/ui/permission-button", () => ({
  PermissionButton: ({
    children,
    ...props
  }: ComponentPropsWithoutRef<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: (props: {
    value: string;
    onValueChange: (value: string) => void;
    items: Array<{ value: string; label: string }>;
    placeholder?: string;
  }) => {
    mockSearchableSelect(props);

    return (
      <select
        aria-label={props.placeholder ?? "searchable-select"}
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
      >
        <option value="">{props.placeholder ?? "Select..."}</option>
        {props.items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    );
  },
}));

vi.mock("@/components/ui/cron-expression-picker", () => ({
  CronExpressionPicker: () => <div data-testid="cron-expression-picker" />,
}));

import ScheduleTriggersPage from "./page";
import { ScheduleTriggerDetailPage } from "./schedule-triggers-client";

function makeTrigger(params: {
  id: string;
  name: string;
  enabled: boolean;
  timezone?: string;
}) {
  return {
    id: params.id,
    organizationId: "org-1",
    name: params.name,
    agentId: "agent-1",
    messageTemplate: "Run the report",
    scheduleKind: "cron" as const,
    cronExpression: "0 9 * * 1-5",
    timezone: params.timezone ?? "UTC",
    enabled: params.enabled,
    actorUserId: "user-1",
    nextDueAt: null,
    lastRunAt: "2026-03-18T10:00:00.000Z",
    lastRunStatus: "success" as const,
    lastError: null,
    createdAt: "2026-03-18T09:00:00.000Z",
    updatedAt: "2026-03-18T09:00:00.000Z",
    actor: {
      id: "user-1",
      name: "Admin",
      email: "admin@example.com",
    },
    agent: {
      id: "agent-1",
      name: "My Assistant",
      agentType: "agent",
    },
  };
}

describe("ScheduleTriggersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseProfiles.mockReturnValue({
      data: [
        {
          id: "agent-1",
          name: "My Assistant",
          scope: "org",
        },
      ],
      isLoading: false,
    });

    mockUseHasPermissions.mockReturnValue({
      data: true,
    });

    mockUseScheduleTriggerRuns.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });

    mockUseScheduleTrigger.mockReturnValue({
      data: null,
      isLoading: false,
    });

    mockUseInteractions.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });

    mockRunScheduleTriggerNow.mockReset();
    mockCreateScheduleTriggerRunConversation.mockReset();
    mockGenerateConversationTitle.mockReset();
    mockGenerateConversationTitle.mockResolvedValue(null);
  });

  it("renders enabled triggers before paused triggers", () => {
    mockUseScheduleTriggers.mockReturnValue({
      data: {
        data: [
          makeTrigger({
            id: "trigger-paused",
            name: "Paused trigger",
            enabled: false,
          }),
          makeTrigger({
            id: "trigger-enabled",
            name: "Enabled trigger",
            enabled: true,
          }),
        ],
      },
      isLoading: false,
    });

    render(<ScheduleTriggersPage />);

    expect(screen.getByText("Scheduled triggers")).toBeInTheDocument();

    const enabledTrigger = screen.getByText("Enabled trigger");
    const pausedTrigger = screen.getByText("Paused trigger");

    expect(
      enabledTrigger.compareDocumentPosition(pausedTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the create form compact without inline enablement controls", () => {
    mockUseScheduleTriggers.mockReturnValue({
      data: {
        data: [],
      },
      isLoading: false,
    });

    render(<ScheduleTriggersPage />);

    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "Ask the scheduled agent to do something on every run...",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("cron-expression-picker")).toBeInTheDocument();
  });

  it("passes timezone options with system timezone first and UTC second", () => {
    mockUseScheduleTriggers.mockReturnValue({
      data: {
        data: [],
      },
      isLoading: false,
    });

    render(<ScheduleTriggersPage />);

    const timezoneCall = mockSearchableSelect.mock.calls
      .map(([props]) => props)
      .find((props) => props.placeholder === "UTC");

    expect(timezoneCall).toBeDefined();

    const browserTimezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const timezoneValues = timezoneCall.items.map(
      (item: { value: string }) => item.value,
    );

    expect(timezoneValues[0]).toBe(browserTimezone);
    expect(timezoneValues[1]).toBe("UTC");
  });

  it("navigates to the dedicated run page when a run row is clicked", () => {
    const trigger = makeTrigger({
      id: "trigger-1",
      name: "Enabled trigger",
      enabled: true,
    });

    mockUseScheduleTrigger.mockReturnValue({
      data: trigger,
      isLoading: false,
    });

    mockUseScheduleTriggerRuns.mockReturnValue({
      data: {
        data: [
          {
            id: "run-1",
            organizationId: "org-1",
            triggerId: trigger.id,
            runKind: "manual",
            status: "success",
            dueAt: null,
            initiatedByUserId: "user-1",
            agentIdSnapshot: "agent-1",
            messageTemplateSnapshot: "Run the report",
            actorUserIdSnapshot: "user-1",
            timezoneSnapshot: "UTC",
            cronExpressionSnapshot: "0 9 * * 1-5",
            chatConversationId: null,
            startedAt: "2026-03-18T09:00:00.000Z",
            completedAt: "2026-03-18T10:00:00.000Z",
            error: null,
            createdAt: "2026-03-18T09:00:00.000Z",
            updatedAt: "2026-03-18T10:00:00.000Z",
          },
        ],
      },
      isLoading: false,
    });

    render(<ScheduleTriggerDetailPage triggerId={trigger.id} />);

    fireEvent.click(
      screen.getByText("Open to inspect prompt snapshot and output."),
    );

    expect(mockPush).toHaveBeenCalledWith(
      `/agents/triggers/schedule/${trigger.id}/runs/run-1`,
    );
  });

  it("navigates to chat when a run row with a chatConversationId is clicked", () => {
    const trigger = makeTrigger({
      id: "trigger-1",
      name: "Enabled trigger",
      enabled: true,
    });

    mockUseScheduleTrigger.mockReturnValue({
      data: trigger,
      isLoading: false,
    });

    mockUseScheduleTriggerRuns.mockReturnValue({
      data: {
        data: [
          {
            id: "run-1",
            organizationId: "org-1",
            triggerId: trigger.id,
            runKind: "manual",
            status: "success",
            dueAt: null,
            initiatedByUserId: "user-1",
            agentIdSnapshot: "agent-1",
            messageTemplateSnapshot: "Run the report",
            actorUserIdSnapshot: "user-1",
            timezoneSnapshot: "UTC",
            cronExpressionSnapshot: "0 9 * * 1-5",
            chatConversationId: "conv-123",
            startedAt: "2026-03-18T09:00:00.000Z",
            completedAt: "2026-03-18T10:00:00.000Z",
            error: null,
            createdAt: "2026-03-18T09:00:00.000Z",
            updatedAt: "2026-03-18T10:00:00.000Z",
          },
        ],
      },
      isLoading: false,
    });

    render(<ScheduleTriggerDetailPage triggerId={trigger.id} />);

    fireEvent.click(
      screen.getByText("Open to inspect prompt snapshot and output."),
    );

    expect(mockPush).toHaveBeenCalledWith(
      `/chat?conversation=conv-123&scheduleTriggerId=${trigger.id}&scheduleRunId=run-1`,
    );
  });

  it("redirects run now follow-ups to chat with schedule run context", async () => {
    const trigger = makeTrigger({
      id: "trigger-1",
      name: "Enabled trigger",
      enabled: true,
    });

    mockUseScheduleTrigger.mockReturnValue({
      data: trigger,
      isLoading: false,
    });
    mockRunScheduleTriggerNow.mockResolvedValue({
      id: "run-1",
      triggerId: trigger.id,
    });
    mockCreateScheduleTriggerRunConversation.mockResolvedValue({
      id: "conversation-1",
    });
    mockUseScheduleTriggerRuns.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });

    render(<ScheduleTriggerDetailPage triggerId={trigger.id} />);

    fireEvent.click(screen.getByRole("button", { name: "Run now" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/chat?conversation=conversation-1&scheduleTriggerId=trigger-1&scheduleRunId=run-1",
      );
    });
  });
});
