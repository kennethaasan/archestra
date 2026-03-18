import db from "@/database";
import logger from "@/logging";
import { ScheduleTriggerModel } from "@/models";
import {
  SCHEDULE_TRIGGERS_MAX_DUE_TRIGGERS_PER_SWEEP,
  SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS,
} from "@/schedule-triggers/utils";
import { taskQueueService } from "@/task-queue";

export async function handleCheckDueScheduleTriggers(): Promise<void> {
  const now = new Date();
  const triggerIds = await ScheduleTriggerModel.findDueTriggerIds({
    now,
    limit: SCHEDULE_TRIGGERS_MAX_DUE_TRIGGERS_PER_SWEEP,
  });

  for (const triggerId of triggerIds) {
    try {
      await db.transaction(async (tx) => {
        const runs = await ScheduleTriggerModel.claimDueRunsInTransaction(tx, {
          triggerId,
          now,
          maxMissedSlotsPerPass: SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS,
        });

        for (const run of runs) {
          await taskQueueService.enqueue({
            taskType: "schedule_trigger_run_execute",
            payload: { runId: run.id },
            tx,
          });
        }
      });
    } catch (error) {
      logger.warn(
        {
          triggerId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to claim due schedule trigger runs",
      );
    }
  }
}
