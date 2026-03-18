import { eq } from "drizzle-orm";
import db, { schema } from "@/database";
import { describe, expect, test } from "@/test";
import ScheduleTriggerModel from "./schedule-trigger";
import ScheduleTriggerRunModel from "./schedule-trigger-run";

describe("ScheduleTriggerModel", () => {
  test("creates a trigger and normalizes cron and timezone fields", async ({
    makeInternalAgent,
    makeOrganization,
    makeUser,
  }) => {
    const organization = await makeOrganization();
    const actor = await makeUser();
    const agent = await makeInternalAgent({ organizationId: organization.id });

    const trigger = await ScheduleTriggerModel.create({
      organizationId: organization.id,
      name: "Morning summary",
      agentId: agent.id,
      messageTemplate: "Send the daily summary",
      scheduleKind: "cron",
      cronExpression: " 0   9 * * 1-5 ",
      timezone: " Europe/Oslo ",
      enabled: true,
      actorUserId: actor.id,
      nextDueAt: new Date("2026-03-19T08:00:00.000Z"),
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
    });

    expect(trigger.cronExpression).toBe("0 9 * * 1-5");
    expect(trigger.timezone).toBe("Europe/Oslo");
  });

  test("claims one run per missed due slot and advances nextDueAt", async ({
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

    const runs = await ScheduleTriggerModel.claimDueRuns({
      triggerId: trigger.id,
      now: new Date("2026-03-18T10:30:00.000Z"),
      maxMissedSlotsPerPass: 10,
    });

    expect(runs.map((run) => run.dueAt?.toISOString())).toEqual([
      "2026-03-18T08:00:00.000Z",
      "2026-03-18T09:00:00.000Z",
      "2026-03-18T10:00:00.000Z",
    ]);

    const updatedTrigger = await ScheduleTriggerModel.findById(trigger.id);
    expect(updatedTrigger?.nextDueAt?.toISOString()).toBe(
      "2026-03-18T11:00:00.000Z",
    );
  });

  test("manual runs keep an immutable snapshot even after the trigger changes", async ({
    makeInternalAgent,
    makeOrganization,
    makeUser,
  }) => {
    const organization = await makeOrganization();
    const actor = await makeUser();
    const initiator = await makeUser();
    const agent = await makeInternalAgent({ organizationId: organization.id });

    const trigger = await ScheduleTriggerModel.create({
      organizationId: organization.id,
      name: "Snapshot test",
      agentId: agent.id,
      messageTemplate: "Original prompt",
      scheduleKind: "cron",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      enabled: true,
      actorUserId: actor.id,
      nextDueAt: new Date("2026-03-19T09:00:00.000Z"),
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
    });

    const manualRun = await ScheduleTriggerRunModel.createManualRun({
      trigger,
      initiatedByUserId: initiator.id,
    });

    await ScheduleTriggerModel.update(trigger.id, {
      messageTemplate: "Updated prompt",
      cronExpression: "0 12 * * *",
    });

    const persistedRun = await ScheduleTriggerRunModel.findById(manualRun.id);
    expect(persistedRun).toMatchObject({
      messageTemplateSnapshot: "Original prompt",
      cronExpressionSnapshot: "0 9 * * *",
      initiatedByUserId: initiator.id,
      actorUserIdSnapshot: actor.id,
    });
  });

  test("records run outcomes on the trigger", async ({
    makeInternalAgent,
    makeOrganization,
    makeUser,
  }) => {
    const organization = await makeOrganization();
    const actor = await makeUser();
    const agent = await makeInternalAgent({ organizationId: organization.id });

    const trigger = await ScheduleTriggerModel.create({
      organizationId: organization.id,
      name: "Outcome test",
      agentId: agent.id,
      messageTemplate: "Do the work",
      scheduleKind: "cron",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      enabled: true,
      actorUserId: actor.id,
      nextDueAt: new Date("2026-03-19T09:00:00.000Z"),
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
    });

    const completedAt = new Date("2026-03-18T10:15:00.000Z");
    await ScheduleTriggerModel.recordRunOutcome({
      triggerId: trigger.id,
      status: "failed",
      completedAt,
      error: "Actor lost access",
    });

    const [stored] = await db
      .select()
      .from(schema.scheduleTriggersTable)
      .where(eq(schema.scheduleTriggersTable.id, trigger.id));

    expect(stored.lastRunStatus).toBe("failed");
    expect(stored.lastError).toBe("Actor lost access");
    expect(stored.lastRunAt?.toISOString()).toBe(completedAt.toISOString());
  });
});

