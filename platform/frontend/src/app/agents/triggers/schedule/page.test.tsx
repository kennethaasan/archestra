"use client";

import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mockUseProfiles = vi.fn();
const mockUseScheduleTriggers = vi.fn();
const mockUseScheduleTriggerRuns = vi.fn();
const mockUseInteractions = vi.fn();
const mockSearchableSelect = vi.fn();

vi.mock("@/lib/agent.query", () => ({
  useProfiles: (...args: unknown[]) => mockUseProfiles(...args),
}));

vi.mock("@/lib/interaction.query", () => ({
  useInteractions: (...args: unknown[]) => mockUseInteractions(...args),
}));

vi.mock("@/lib/schedule-trigger.query", () => ({
  useScheduleTriggers: (...args: unknown[]) => mockUseScheduleTriggers(...args),
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
    mutateAsync: vi.fn(),
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

    mockUseScheduleTriggerRuns.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });

    mockUseInteractions.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
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

    expect(screen.getByText("Running schedules")).toBeInTheDocument();
    expect(screen.getByText("Paused schedules")).toBeInTheDocument();

    const enabledTrigger = screen.getByText("Enabled trigger");
    const pausedTrigger = screen.getByText("Paused trigger");

    expect(
      enabledTrigger.compareDocumentPosition(pausedTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
});
