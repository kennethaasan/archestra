import { and, count, desc, eq, inArray, lt, or } from "drizzle-orm";
import db, { schema, type Transaction } from "@/database";
import type {
  ScheduleTrigger,
  ScheduleTriggerRun,
  ScheduleTriggerRunStatus,
} from "@/types";

class ScheduleTriggerRunModel {
  static async createManualRun(params: {
    trigger: ScheduleTrigger;
    initiatedByUserId: string;
    txOrDb?: Transaction | typeof db;
  }): Promise<ScheduleTriggerRun> {
    const txOrDb = params.txOrDb ?? db;
    const [run] = await txOrDb
      .insert(schema.scheduleTriggerRunsTable)
      .values({
        organizationId: params.trigger.organizationId,
        triggerId: params.trigger.id,
        runKind: "manual",
        status: "pending",
        dueAt: null,
        initiatedByUserId: params.initiatedByUserId,
        agentIdSnapshot: params.trigger.agentId,
        messageTemplateSnapshot: params.trigger.messageTemplate,
        actorUserIdSnapshot: params.trigger.actorUserId,
        timezoneSnapshot: params.trigger.timezone,
        cronExpressionSnapshot: params.trigger.cronExpression,
      })
      .returning();

    return run;
  }

  static async countByTrigger(params: {
    organizationId: string;
    triggerId: string;
  }): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(schema.scheduleTriggerRunsTable)
      .where(
        and(
          eq(
            schema.scheduleTriggerRunsTable.organizationId,
            params.organizationId,
          ),
          eq(schema.scheduleTriggerRunsTable.triggerId, params.triggerId),
        ),
      );

    return result?.count ?? 0;
  }

  static async listByTrigger(params: {
    organizationId: string;
    triggerId: string;
    limit?: number;
    offset?: number;
  }): Promise<ScheduleTriggerRun[]> {
    let query = db
      .select()
      .from(schema.scheduleTriggerRunsTable)
      .where(
        and(
          eq(
            schema.scheduleTriggerRunsTable.organizationId,
            params.organizationId,
          ),
          eq(schema.scheduleTriggerRunsTable.triggerId, params.triggerId),
        ),
      )
      .orderBy(desc(schema.scheduleTriggerRunsTable.createdAt))
      .$dynamic();

    if (params.limit !== undefined) {
      query = query.limit(params.limit);
    }

    if (params.offset !== undefined) {
      query = query.offset(params.offset);
    }

    return await query;
  }

  static async findById(id: string): Promise<ScheduleTriggerRun | null> {
    const [run] = await db
      .select()
      .from(schema.scheduleTriggerRunsTable)
      .where(eq(schema.scheduleTriggerRunsTable.id, id));

    return run ?? null;
  }

  static async setChatConversationId(params: {
    runId: string;
    chatConversationId: string | null;
  }): Promise<ScheduleTriggerRun | null> {
    const [run] = await db
      .update(schema.scheduleTriggerRunsTable)
      .set({ chatConversationId: params.chatConversationId })
      .where(eq(schema.scheduleTriggerRunsTable.id, params.runId))
      .returning();

    return run ?? null;
  }

  static async findByIds(ids: string[]): Promise<ScheduleTriggerRun[]> {
    if (ids.length === 0) {
      return [];
    }

    return await db
      .select()
      .from(schema.scheduleTriggerRunsTable)
      .where(inArray(schema.scheduleTriggerRunsTable.id, ids));
  }

  static async claimForExecution(
    runId: string,
    staleAfterMs?: number,
  ): Promise<ScheduleTriggerRun | null> {
    const staleStartedAtCutoff =
      staleAfterMs === undefined ? null : new Date(Date.now() - staleAfterMs);
    const [run] = await db
      .update(schema.scheduleTriggerRunsTable)
      .set({
        status: "running",
        startedAt: new Date(),
        error: null,
      })
      .where(
        and(
          eq(schema.scheduleTriggerRunsTable.id, runId),
          or(
            eq(schema.scheduleTriggerRunsTable.status, "pending"),
            staleStartedAtCutoff === null
              ? eq(schema.scheduleTriggerRunsTable.status, "running")
              : and(
                  eq(schema.scheduleTriggerRunsTable.status, "running"),
                  lt(
                    schema.scheduleTriggerRunsTable.startedAt,
                    staleStartedAtCutoff,
                  ),
                ),
          ),
        ),
      )
      .returning();

    return run ?? null;
  }

  static async markCompleted(params: {
    runId: string;
    status: Extract<ScheduleTriggerRunStatus, "success" | "failed">;
    error?: string | null;
  }): Promise<ScheduleTriggerRun | null> {
    const [run] = await db
      .update(schema.scheduleTriggerRunsTable)
      .set({
        status: params.status,
        completedAt: new Date(),
        error: params.error ?? null,
      })
      .where(eq(schema.scheduleTriggerRunsTable.id, params.runId))
      .returning();

    return run ?? null;
  }

  static async resetStuckRuns(timeoutMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutMs);

    const result = await db
      .update(schema.scheduleTriggerRunsTable)
      .set({
        status: "pending",
        startedAt: null,
      })
      .where(
        and(
          eq(schema.scheduleTriggerRunsTable.status, "running"),
          lt(schema.scheduleTriggerRunsTable.startedAt, cutoff),
        ),
      )
      .returning({ id: schema.scheduleTriggerRunsTable.id });

    return result.length;
  }

  static async hasPendingOrRunningForIds(runIds: string[]): Promise<boolean> {
    if (runIds.length === 0) {
      return false;
    }

    const [result] = await db
      .select({ count: count() })
      .from(schema.scheduleTriggerRunsTable)
      .where(
        and(
          inArray(schema.scheduleTriggerRunsTable.id, runIds),
          or(
            eq(schema.scheduleTriggerRunsTable.status, "pending"),
            eq(schema.scheduleTriggerRunsTable.status, "running"),
          ),
        ),
      );

    return (result?.count ?? 0) > 0;
  }
}

export default ScheduleTriggerRunModel;
