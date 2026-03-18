import db from "@/database";
import logger from "@/logging";
import { ScheduleTriggerModel } from "@/models";
import {
  SCHEDULE_TRIGGERS_DUE_TRIGGER_BATCH_SIZE,
  SCHEDULE_TRIGGERS_MAX_DUE_TRIGGERS_PER_SWEEP,
  SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS,
} from "@/schedule-triggers/utils";
import { taskQueueService } from "@/task-queue";

export async function handleCheckDueScheduleTriggers(): Promise<void> {
  const now = new Date();
  const processedTriggerIds = new Set<string>();

  while (
    processedTriggerIds.size < SCHEDULE_TRIGGERS_MAX_DUE_TRIGGERS_PER_SWEEP
  ) {
    const triggerIds = await ScheduleTriggerModel.findDueTriggerIds({
      now,
      limit: Math.min(
        SCHEDULE_TRIGGERS_DUE_TRIGGER_BATCH_SIZE,
        SCHEDULE_TRIGGERS_MAX_DUE_TRIGGERS_PER_SWEEP - processedTriggerIds.size,
      ),
      excludeIds: [...processedTriggerIds],
    });

    if (triggerIds.length === 0) {
      break;
    }

    const freshTriggerIds = triggerIds.filter(
      (triggerId) => !processedTriggerIds.has(triggerId),
    );
    if (freshTriggerIds.length === 0) {
      break;
    }

    for (const triggerId of freshTriggerIds) {
      processedTriggerIds.add(triggerId);

      try {
        await db.transaction(async (tx) => {
          const runs = await ScheduleTriggerModel.claimDueRunsInTransaction(
            tx,
            {
              triggerId,
              now,
              maxMissedSlotsPerPass:
                SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS,
            },
          );

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
}
