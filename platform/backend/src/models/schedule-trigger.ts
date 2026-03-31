import {
  and,
  count,
  desc,
  eq,
  inArray,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import db, { schema, type Transaction } from "@/database";
import ScheduleTriggerRunModel from "@/models/schedule-trigger-run";
import {
  calculateNextDueAt,
  calculateNextDueAtOnOrAfter,
  normalizeCronExpression,
  normalizeTimezone,
  SCHEDULE_TRIGGER_BACKFILL_WINDOW_MS,
  SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS,
} from "@/schedule-triggers/utils";
import type {
  InsertScheduleTrigger,
  ScheduleTrigger,
  ScheduleTriggerOverlapPolicy,
  ScheduleTriggerRun,
  ScheduleTriggerRunStatus,
  UpdateScheduleTrigger,
} from "@/types";
import { InsertScheduleTriggerSchema } from "@/types";

type ScheduleTriggerListFilters = {
  organizationId: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
  agentIds?: string[];
};

class ScheduleTriggerModel {
  static async countByOrganization(
    params: Pick<
      ScheduleTriggerListFilters,
      "organizationId" | "enabled" | "agentIds"
    >,
  ): Promise<number> {
    const filters = [
      eq(schema.scheduleTriggersTable.organizationId, params.organizationId),
    ];

    if (params.enabled !== undefined) {
      filters.push(eq(schema.scheduleTriggersTable.enabled, params.enabled));
    }

    if (params.agentIds !== undefined) {
      if (params.agentIds.length === 0) {
        return 0;
      }
      filters.push(
        inArray(schema.scheduleTriggersTable.agentId, params.agentIds),
      );
    }

    const [result] = await db
      .select({ count: count() })
      .from(schema.scheduleTriggersTable)
      .where(and(...filters));

    return result?.count ?? 0;
  }

  static async listByOrganization(
    params: ScheduleTriggerListFilters,
  ): Promise<ScheduleTrigger[]> {
    const filters = [
      eq(schema.scheduleTriggersTable.organizationId, params.organizationId),
    ];

    if (params.enabled !== undefined) {
      filters.push(eq(schema.scheduleTriggersTable.enabled, params.enabled));
    }

    if (params.agentIds !== undefined) {
      if (params.agentIds.length === 0) {
        return [];
      }
      filters.push(
        inArray(schema.scheduleTriggersTable.agentId, params.agentIds),
      );
    }

    let query = db
      .select({
        id: schema.scheduleTriggersTable.id,
        organizationId: schema.scheduleTriggersTable.organizationId,
        name: schema.scheduleTriggersTable.name,
        agentId: schema.scheduleTriggersTable.agentId,
        messageTemplate: schema.scheduleTriggersTable.messageTemplate,
        scheduleKind: schema.scheduleTriggersTable.scheduleKind,
        cronExpression: schema.scheduleTriggersTable.cronExpression,
        timezone: schema.scheduleTriggersTable.timezone,
        enabled: schema.scheduleTriggersTable.enabled,
        actorUserId: schema.scheduleTriggersTable.actorUserId,
        overlapPolicy: schema.scheduleTriggersTable.overlapPolicy,
        consecutiveFailures: schema.scheduleTriggersTable.consecutiveFailures,
        maxConsecutiveFailures:
          schema.scheduleTriggersTable.maxConsecutiveFailures,
        nextDueAt: schema.scheduleTriggersTable.nextDueAt,
        lastRunAt: schema.scheduleTriggersTable.lastRunAt,
        lastRunStatus: schema.scheduleTriggersTable.lastRunStatus,
        lastError: schema.scheduleTriggersTable.lastError,
        createdAt: schema.scheduleTriggersTable.createdAt,
        updatedAt: schema.scheduleTriggersTable.updatedAt,
        actor: {
          id: schema.usersTable.id,
          name: schema.usersTable.name,
          email: schema.usersTable.email,
        },
        agent: {
          id: schema.agentsTable.id,
          name: schema.agentsTable.name,
          agentType: schema.agentsTable.agentType,
        },
      })
      .from(schema.scheduleTriggersTable)
      .leftJoin(
        schema.usersTable,
        eq(schema.scheduleTriggersTable.actorUserId, schema.usersTable.id),
      )
      .leftJoin(
        schema.agentsTable,
        eq(schema.scheduleTriggersTable.agentId, schema.agentsTable.id),
      )
      .where(and(...filters))
      .orderBy(desc(schema.scheduleTriggersTable.createdAt))
      .$dynamic();

    if (params.limit !== undefined) {
      query = query.limit(params.limit);
    }

    if (params.offset !== undefined) {
      query = query.offset(params.offset);
    }

    return await query;
  }

  static async findById(id: string): Promise<ScheduleTrigger | null> {
    const [trigger] = await db
      .select({
        id: schema.scheduleTriggersTable.id,
        organizationId: schema.scheduleTriggersTable.organizationId,
        name: schema.scheduleTriggersTable.name,
        agentId: schema.scheduleTriggersTable.agentId,
        messageTemplate: schema.scheduleTriggersTable.messageTemplate,
        scheduleKind: schema.scheduleTriggersTable.scheduleKind,
        cronExpression: schema.scheduleTriggersTable.cronExpression,
        timezone: schema.scheduleTriggersTable.timezone,
        enabled: schema.scheduleTriggersTable.enabled,
        actorUserId: schema.scheduleTriggersTable.actorUserId,
        overlapPolicy: schema.scheduleTriggersTable.overlapPolicy,
        consecutiveFailures: schema.scheduleTriggersTable.consecutiveFailures,
        maxConsecutiveFailures:
          schema.scheduleTriggersTable.maxConsecutiveFailures,
        nextDueAt: schema.scheduleTriggersTable.nextDueAt,
        lastRunAt: schema.scheduleTriggersTable.lastRunAt,
        lastRunStatus: schema.scheduleTriggersTable.lastRunStatus,
        lastError: schema.scheduleTriggersTable.lastError,
        createdAt: schema.scheduleTriggersTable.createdAt,
        updatedAt: schema.scheduleTriggersTable.updatedAt,
        actor: {
          id: schema.usersTable.id,
          name: schema.usersTable.name,
          email: schema.usersTable.email,
        },
        agent: {
          id: schema.agentsTable.id,
          name: schema.agentsTable.name,
          agentType: schema.agentsTable.agentType,
        },
      })
      .from(schema.scheduleTriggersTable)
      .leftJoin(
        schema.usersTable,
        eq(schema.scheduleTriggersTable.actorUserId, schema.usersTable.id),
      )
      .leftJoin(
        schema.agentsTable,
        eq(schema.scheduleTriggersTable.agentId, schema.agentsTable.id),
      )
      .where(eq(schema.scheduleTriggersTable.id, id));

    return trigger ?? null;
  }

  static async create(data: InsertScheduleTrigger): Promise<ScheduleTrigger> {
    const parsed = InsertScheduleTriggerSchema.parse(data);
    const [created] = await db
      .insert(schema.scheduleTriggersTable)
      .values({
        ...parsed,
        cronExpression: normalizeCronExpression(parsed.cronExpression),
        timezone: normalizeTimezone(parsed.timezone),
      })
      .returning();

    return (await ScheduleTriggerModel.findById(created.id)) ?? created;
  }

  static async update(
    id: string,
    data: Partial<UpdateScheduleTrigger>,
  ): Promise<ScheduleTrigger | null> {
    const [updated] = await db
      .update(schema.scheduleTriggersTable)
      .set({
        ...data,
        ...(data.cronExpression !== undefined && {
          cronExpression: normalizeCronExpression(data.cronExpression),
        }),
        ...(data.timezone !== undefined && {
          timezone: normalizeTimezone(data.timezone),
        }),
      })
      .where(eq(schema.scheduleTriggersTable.id, id))
      .returning({ id: schema.scheduleTriggersTable.id });

    if (!updated) {
      return null;
    }

    return await ScheduleTriggerModel.findById(updated.id);
  }

  static async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(schema.scheduleTriggersTable)
      .where(eq(schema.scheduleTriggersTable.id, id));

    return (result.rowCount ?? 0) > 0;
  }

  static async findDueTriggerIds(params: {
    now: Date;
    limit: number;
    excludeIds?: string[];
  }): Promise<string[]> {
    const filters = [
      eq(schema.scheduleTriggersTable.enabled, true),
      lte(schema.scheduleTriggersTable.nextDueAt, params.now),
    ];

    const excludeIds = params.excludeIds;
    if (excludeIds && excludeIds.length > 0) {
      filters.push(notInArray(schema.scheduleTriggersTable.id, excludeIds));
    }

    const result = await db
      .select({ id: schema.scheduleTriggersTable.id })
      .from(schema.scheduleTriggersTable)
      .where(and(...filters))
      .orderBy(schema.scheduleTriggersTable.nextDueAt)
      .limit(params.limit);

    return result.map((row) => row.id);
  }

  static async claimDueRuns(params: {
    triggerId: string;
    now: Date;
    maxMissedSlotsPerPass?: number;
  }): Promise<ScheduleTriggerRun[]> {
    return await db.transaction(async (tx) => {
      return await ScheduleTriggerModel.claimDueRunsInTransaction(tx, params);
    });
  }

  static async claimDueRunsInTransaction(
    tx: Transaction,
    params: {
      triggerId: string;
      now: Date;
      maxMissedSlotsPerPass?: number;
    },
  ): Promise<ScheduleTriggerRun[]> {
    const trigger = await ScheduleTriggerModel.lockDueTrigger(
      tx,
      params.triggerId,
      params.now,
    );
    if (!trigger?.nextDueAt) {
      return [];
    }

    const overlapPolicy = trigger.overlapPolicy ?? "skip";

    if (overlapPolicy === "skip" || overlapPolicy === "buffer_one") {
      const activeCount =
        await ScheduleTriggerRunModel.countActiveRunsForTrigger(trigger.id, tx);

      if (overlapPolicy === "skip" && activeCount > 0) {
        const advancedNextDueAt = advancePastNow({
          cronExpression: trigger.cronExpression,
          timezone: trigger.timezone,
          currentNextDueAt: trigger.nextDueAt,
          now: params.now,
        });

        await tx
          .update(schema.scheduleTriggersTable)
          .set({ nextDueAt: advancedNextDueAt })
          .where(eq(schema.scheduleTriggersTable.id, trigger.id));

        return [];
      }

      if (overlapPolicy === "buffer_one" && activeCount >= 2) {
        const advancedNextDueAt = advancePastNow({
          cronExpression: trigger.cronExpression,
          timezone: trigger.timezone,
          currentNextDueAt: trigger.nextDueAt,
          now: params.now,
        });

        await tx
          .update(schema.scheduleTriggersTable)
          .set({ nextDueAt: advancedNextDueAt })
          .where(eq(schema.scheduleTriggersTable.id, trigger.id));

        return [];
      }
    }

    const maxMissedSlotsPerPass =
      params.maxMissedSlotsPerPass ??
      SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS;
    const createdRuns: ScheduleTriggerRun[] = [];
    let nextDueAt: Date | null = trigger.nextDueAt;

    const oldestAllowedDueAt = new Date(
      params.now.getTime() - SCHEDULE_TRIGGER_BACKFILL_WINDOW_MS,
    );

    if (nextDueAt < oldestAllowedDueAt) {
      const clamped = calculateNextDueAtOnOrAfter({
        cronExpression: trigger.cronExpression,
        timezone: trigger.timezone,
        from: oldestAllowedDueAt,
      });

      nextDueAt = clamped;
    }

    const maxRunsToCreate =
      overlapPolicy === "buffer_one"
        ? 1
        : overlapPolicy === "skip"
          ? 1
          : maxMissedSlotsPerPass;

    let processedSlots = 0;
    while (
      nextDueAt &&
      nextDueAt <= params.now &&
      processedSlots < maxMissedSlotsPerPass &&
      createdRuns.length < maxRunsToCreate
    ) {
      const [createdRun] = await tx
        .insert(schema.scheduleTriggerRunsTable)
        .values({
          organizationId: trigger.organizationId,
          triggerId: trigger.id,
          runKind: "due",
          status: "pending",
          dueAt: nextDueAt,
          agentIdSnapshot: trigger.agentId,
          messageTemplateSnapshot: trigger.messageTemplate,
          actorUserIdSnapshot: trigger.actorUserId,
          timezoneSnapshot: trigger.timezone,
          cronExpressionSnapshot: trigger.cronExpression,
        })
        .onConflictDoNothing()
        .returning();

      if (!createdRun) {
        break;
      }

      createdRuns.push(createdRun);
      processedSlots += 1;
      nextDueAt = calculateNextDueAt({
        cronExpression: trigger.cronExpression,
        timezone: trigger.timezone,
        from: nextDueAt,
      });
    }

    while (
      nextDueAt &&
      nextDueAt <= params.now &&
      processedSlots < maxMissedSlotsPerPass
    ) {
      processedSlots += 1;
      nextDueAt = calculateNextDueAt({
        cronExpression: trigger.cronExpression,
        timezone: trigger.timezone,
        from: nextDueAt,
      });
    }

    await tx
      .update(schema.scheduleTriggersTable)
      .set({ nextDueAt })
      .where(eq(schema.scheduleTriggersTable.id, trigger.id));

    return createdRuns;
  }

  static async recordRunOutcome(params: {
    triggerId: string;
    status: ScheduleTriggerRunStatus;
    completedAt: Date;
    error: string | null;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      if (params.status === "failed") {
        await tx
          .update(schema.scheduleTriggersTable)
          .set({
            lastRunAt: params.completedAt,
            lastRunStatus: params.status,
            lastError: params.error,
            consecutiveFailures: sql`${schema.scheduleTriggersTable.consecutiveFailures} + 1`,
          })
          .where(eq(schema.scheduleTriggersTable.id, params.triggerId));

        await tx.execute(sql`
          UPDATE schedule_triggers
          SET enabled = false, next_due_at = NULL
          WHERE id = ${params.triggerId}
            AND consecutive_failures >= max_consecutive_failures
            AND enabled = true
        `);
      } else {
        await tx
          .update(schema.scheduleTriggersTable)
          .set({
            lastRunAt: params.completedAt,
            lastRunStatus: params.status,
            lastError: params.error,
            consecutiveFailures: 0,
          })
          .where(eq(schema.scheduleTriggersTable.id, params.triggerId));
      }
    });
  }

  private static async lockDueTrigger(
    tx: Transaction,
    triggerId: string,
    now: Date,
  ): Promise<
    | {
        id: string;
        organizationId: string;
        agentId: string;
        actorUserId: string;
        messageTemplate: string;
        cronExpression: string;
        timezone: string;
        overlapPolicy: ScheduleTriggerOverlapPolicy;
        nextDueAt: Date | null;
      }
    | undefined
  > {
    const { rows } = await tx.execute<{
      id: string;
      organizationId: string;
      agentId: string;
      actorUserId: string;
      messageTemplate: string;
      cronExpression: string;
      timezone: string;
      overlapPolicy: ScheduleTriggerOverlapPolicy;
      nextDueAt: Date | null;
    }>(sql`
      SELECT
        id,
        organization_id AS "organizationId",
        agent_id AS "agentId",
        actor_user_id AS "actorUserId",
        message_template AS "messageTemplate",
        cron_expression AS "cronExpression",
        timezone,
        overlap_policy AS "overlapPolicy",
        next_due_at AS "nextDueAt"
      FROM schedule_triggers
      WHERE id = ${triggerId}
        AND enabled = true
        AND next_due_at <= ${now}
      FOR UPDATE SKIP LOCKED
    `);

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    return {
      ...row,
      overlapPolicy: row.overlapPolicy ?? "skip",
      nextDueAt: normalizeDatabaseDate(row.nextDueAt),
    };
  }
}

function normalizeDatabaseDate(value: Date | string | null): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const hasExplicitTimezone = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(value);
  return new Date(hasExplicitTimezone ? value : `${value}Z`);
}

function advancePastNow(params: {
  cronExpression: string;
  timezone: string;
  currentNextDueAt: Date;
  now: Date;
}): Date | null {
  let nextDueAt: Date | null = params.currentNextDueAt;
  let iterations = 0;
  const maxIterations = SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS;

  while (nextDueAt && nextDueAt <= params.now && iterations < maxIterations) {
    nextDueAt = calculateNextDueAt({
      cronExpression: params.cronExpression,
      timezone: params.timezone,
      from: nextDueAt,
    });
    iterations += 1;
  }

  return nextDueAt;
}

export default ScheduleTriggerModel;
