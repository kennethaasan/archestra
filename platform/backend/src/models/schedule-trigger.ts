import { and, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import db, { schema, type Transaction } from "@/database";
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
  }): Promise<string[]> {
    const result = await db
      .select({ id: schema.scheduleTriggersTable.id })
      .from(schema.scheduleTriggersTable)
      .where(
        and(
          eq(schema.scheduleTriggersTable.enabled, true),
          lte(schema.scheduleTriggersTable.nextDueAt, params.now),
        ),
      )
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

    let processedSlots = 0;
    while (
      nextDueAt &&
      nextDueAt <= params.now &&
      processedSlots < maxMissedSlotsPerPass
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
    await db
      .update(schema.scheduleTriggersTable)
      .set({
        lastRunAt: params.completedAt,
        lastRunStatus: params.status,
        lastError: params.error,
      })
      .where(eq(schema.scheduleTriggersTable.id, params.triggerId));
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

export default ScheduleTriggerModel;
