import { eq } from "drizzle-orm";
import { vi } from "vitest";
import db, { schema } from "@/database";
import { describe, expect, test } from "@/test";

const mockEnqueue = vi.hoisted(() =>
  vi.fn().mockRejectedValue(new Error("queue unavailable")),
);

vi.mock("@/task-queue", () => ({
  taskQueueService: {
    enqueue: mockEnqueue,
  },
}));

vi.mock("@/logging", () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

import ScheduleTriggerModel from "@/models/schedule-trigger";
import { handleCheckDueScheduleTriggers } from "./check-due-schedule-triggers-handler";

describe("handleCheckDueScheduleTriggers integration", () => {
  test("rolls back claimed due runs when enqueueing fails", async ({
    makeInternalAgent,
    makeOrganization,
    makeUser,
  }) => {
    const organization = await makeOrganization();
    const actor = await makeUser();
    const agent = await makeInternalAgent({ organizationId: organization.id });

    const trigger = await ScheduleTriggerModel.create({
      organizationId: organization.id,
      name: "Hourly sync",
      agentId: agent.id,
      messageTemplate: "Run the hourly task",
      scheduleKind: "cron",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      enabled: true,
      actorUserId: actor.id,
      nextDueAt: new Date("2026-03-18T08:00:00.000Z"),
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T10:30:00.000Z"));

    try {
      await handleCheckDueScheduleTriggers();
    } finally {
      vi.useRealTimers();
    }

    const runs = await db
      .select()
      .from(schema.scheduleTriggerRunsTable)
      .where(eq(schema.scheduleTriggerRunsTable.triggerId, trigger.id));
    expect(runs).toHaveLength(0);

    const storedTrigger = await ScheduleTriggerModel.findById(trigger.id);
    expect(storedTrigger?.nextDueAt?.toISOString()).toBe(
      "2026-03-18T08:00:00.000Z",
    );
  });
});
