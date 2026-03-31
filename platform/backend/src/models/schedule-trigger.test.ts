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
      overlapPolicy: "allow_all",
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

  describe("overlap policy", () => {
    test("skip policy: skips all runs when an active run exists", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Skip overlap test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        overlapPolicy: "skip",
        nextDueAt: new Date("2026-03-18T08:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      // Create an active (running) run for this trigger
      await db.insert(schema.scheduleTriggerRunsTable).values({
        organizationId: organization.id,
        triggerId: trigger.id,
        runKind: "due",
        status: "running",
        dueAt: new Date("2026-03-18T07:00:00.000Z"),
        agentIdSnapshot: agent.id,
        messageTemplateSnapshot: "Do work",
        actorUserIdSnapshot: actor.id,
        timezoneSnapshot: "UTC",
        cronExpressionSnapshot: "0 * * * *",
        startedAt: new Date("2026-03-18T07:00:01.000Z"),
      });

      const runs = await ScheduleTriggerModel.claimDueRuns({
        triggerId: trigger.id,
        now: new Date("2026-03-18T10:30:00.000Z"),
        maxMissedSlotsPerPass: 10,
      });

      expect(runs).toHaveLength(0);

      // nextDueAt should be advanced past now
      const updated = await ScheduleTriggerModel.findById(trigger.id);
      expect(
        updated?.nextDueAt &&
          updated.nextDueAt > new Date("2026-03-18T10:30:00.000Z"),
      ).toBe(true);
    });

    test("skip policy: creates runs normally when no active runs exist", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Skip no overlap test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        overlapPolicy: "skip",
        nextDueAt: new Date("2026-03-18T09:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      const runs = await ScheduleTriggerModel.claimDueRuns({
        triggerId: trigger.id,
        now: new Date("2026-03-18T09:30:00.000Z"),
        maxMissedSlotsPerPass: 10,
      });

      // skip still limits to 1 run per claim
      expect(runs).toHaveLength(1);
      expect(runs[0].dueAt?.toISOString()).toBe("2026-03-18T09:00:00.000Z");
    });

    test("buffer_one policy: allows one buffered run when a running run exists", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Buffer one test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        overlapPolicy: "buffer_one",
        nextDueAt: new Date("2026-03-18T08:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      // Create one active running run
      await db.insert(schema.scheduleTriggerRunsTable).values({
        organizationId: organization.id,
        triggerId: trigger.id,
        runKind: "due",
        status: "running",
        dueAt: new Date("2026-03-18T07:00:00.000Z"),
        agentIdSnapshot: agent.id,
        messageTemplateSnapshot: "Do work",
        actorUserIdSnapshot: actor.id,
        timezoneSnapshot: "UTC",
        cronExpressionSnapshot: "0 * * * *",
        startedAt: new Date("2026-03-18T07:00:01.000Z"),
      });

      const runs = await ScheduleTriggerModel.claimDueRuns({
        triggerId: trigger.id,
        now: new Date("2026-03-18T10:30:00.000Z"),
        maxMissedSlotsPerPass: 10,
      });

      // With 1 active run (running), buffer_one allows creating 1 more (buffered)
      expect(runs).toHaveLength(1);
    });

    test("buffer_one policy: skips when already 2 active runs", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Buffer one full test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        overlapPolicy: "buffer_one",
        nextDueAt: new Date("2026-03-18T08:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      // Create 2 active runs (one running, one pending)
      await db.insert(schema.scheduleTriggerRunsTable).values([
        {
          organizationId: organization.id,
          triggerId: trigger.id,
          runKind: "due",
          status: "running",
          dueAt: new Date("2026-03-18T06:00:00.000Z"),
          agentIdSnapshot: agent.id,
          messageTemplateSnapshot: "Do work",
          actorUserIdSnapshot: actor.id,
          timezoneSnapshot: "UTC",
          cronExpressionSnapshot: "0 * * * *",
          startedAt: new Date("2026-03-18T06:00:01.000Z"),
        },
        {
          organizationId: organization.id,
          triggerId: trigger.id,
          runKind: "due",
          status: "pending",
          dueAt: new Date("2026-03-18T07:00:00.000Z"),
          agentIdSnapshot: agent.id,
          messageTemplateSnapshot: "Do work",
          actorUserIdSnapshot: actor.id,
          timezoneSnapshot: "UTC",
          cronExpressionSnapshot: "0 * * * *",
        },
      ]);

      const runs = await ScheduleTriggerModel.claimDueRuns({
        triggerId: trigger.id,
        now: new Date("2026-03-18T10:30:00.000Z"),
        maxMissedSlotsPerPass: 10,
      });

      expect(runs).toHaveLength(0);

      // nextDueAt should still advance past now
      const updated = await ScheduleTriggerModel.findById(trigger.id);
      expect(
        updated?.nextDueAt &&
          updated.nextDueAt > new Date("2026-03-18T10:30:00.000Z"),
      ).toBe(true);
    });

    test("allow_all policy: creates runs for all missed slots", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Allow all test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        overlapPolicy: "allow_all",
        nextDueAt: new Date("2026-03-18T08:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      // Create an active running run — allow_all ignores it
      await db.insert(schema.scheduleTriggerRunsTable).values({
        organizationId: organization.id,
        triggerId: trigger.id,
        runKind: "due",
        status: "running",
        dueAt: new Date("2026-03-18T07:00:00.000Z"),
        agentIdSnapshot: agent.id,
        messageTemplateSnapshot: "Do work",
        actorUserIdSnapshot: actor.id,
        timezoneSnapshot: "UTC",
        cronExpressionSnapshot: "0 * * * *",
        startedAt: new Date("2026-03-18T07:00:01.000Z"),
      });

      const runs = await ScheduleTriggerModel.claimDueRuns({
        triggerId: trigger.id,
        now: new Date("2026-03-18T10:30:00.000Z"),
        maxMissedSlotsPerPass: 10,
      });

      expect(runs.length).toBeGreaterThan(1);
    });
  });

  describe("pause on failure", () => {
    test("increments consecutiveFailures on failed outcome", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Failure counter test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        maxConsecutiveFailures: 5,
        nextDueAt: new Date("2026-03-19T09:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      await ScheduleTriggerModel.recordRunOutcome({
        triggerId: trigger.id,
        status: "failed",
        completedAt: new Date("2026-03-18T10:00:00.000Z"),
        error: "some error",
      });

      const [stored] = await db
        .select()
        .from(schema.scheduleTriggersTable)
        .where(eq(schema.scheduleTriggersTable.id, trigger.id));

      expect(stored.consecutiveFailures).toBe(1);
      expect(stored.enabled).toBe(true);
    });

    test("resets consecutiveFailures on success", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Reset counter test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        maxConsecutiveFailures: 5,
        nextDueAt: new Date("2026-03-19T09:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      // Record 3 failures
      for (let i = 0; i < 3; i++) {
        await ScheduleTriggerModel.recordRunOutcome({
          triggerId: trigger.id,
          status: "failed",
          completedAt: new Date(`2026-03-18T10:0${i}:00.000Z`),
          error: "error",
        });
      }

      // Then record success
      await ScheduleTriggerModel.recordRunOutcome({
        triggerId: trigger.id,
        status: "success",
        completedAt: new Date("2026-03-18T10:05:00.000Z"),
        error: null,
      });

      const [stored] = await db
        .select()
        .from(schema.scheduleTriggersTable)
        .where(eq(schema.scheduleTriggersTable.id, trigger.id));

      expect(stored.consecutiveFailures).toBe(0);
    });

    test("auto-disables trigger after reaching maxConsecutiveFailures", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Auto-pause test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        maxConsecutiveFailures: 3,
        nextDueAt: new Date("2026-03-19T09:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      for (let i = 0; i < 3; i++) {
        await ScheduleTriggerModel.recordRunOutcome({
          triggerId: trigger.id,
          status: "failed",
          completedAt: new Date(`2026-03-18T10:0${i}:00.000Z`),
          error: `failure ${i + 1}`,
        });
      }

      const [stored] = await db
        .select()
        .from(schema.scheduleTriggersTable)
        .where(eq(schema.scheduleTriggersTable.id, trigger.id));

      expect(stored.enabled).toBe(false);
      expect(stored.nextDueAt).toBeNull();
      expect(stored.consecutiveFailures).toBe(3);
    });

    test("re-enabling resets consecutiveFailures via update", async ({
      makeInternalAgent,
      makeOrganization,
      makeUser,
    }) => {
      const organization = await makeOrganization();
      const actor = await makeUser();
      const agent = await makeInternalAgent({
        organizationId: organization.id,
      });

      const trigger = await ScheduleTriggerModel.create({
        organizationId: organization.id,
        name: "Re-enable test",
        agentId: agent.id,
        messageTemplate: "Do work",
        scheduleKind: "cron",
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        enabled: true,
        actorUserId: actor.id,
        maxConsecutiveFailures: 2,
        nextDueAt: new Date("2026-03-19T09:00:00.000Z"),
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      });

      // Auto-pause after 2 failures
      for (let i = 0; i < 2; i++) {
        await ScheduleTriggerModel.recordRunOutcome({
          triggerId: trigger.id,
          status: "failed",
          completedAt: new Date(`2026-03-18T10:0${i}:00.000Z`),
          error: `failure ${i + 1}`,
        });
      }

      // Re-enable (simulating what the enable endpoint does)
      await ScheduleTriggerModel.update(trigger.id, {
        enabled: true,
        consecutiveFailures: 0,
        nextDueAt: new Date("2026-03-20T09:00:00.000Z"),
      });

      const [stored] = await db
        .select()
        .from(schema.scheduleTriggersTable)
        .where(eq(schema.scheduleTriggersTable.id, trigger.id));

      expect(stored.enabled).toBe(true);
      expect(stored.consecutiveFailures).toBe(0);
      expect(stored.nextDueAt).not.toBeNull();
    });
  });
});
