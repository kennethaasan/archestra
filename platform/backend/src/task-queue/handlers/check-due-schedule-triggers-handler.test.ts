import { vi } from "vitest";
import { beforeEach, describe, expect, test } from "@/test";

const { mockFindDueTriggerIds, mockClaimDueRunsInTransaction, mockEnqueue } =
  vi.hoisted(() => ({
    mockFindDueTriggerIds: vi.fn().mockResolvedValue([]),
    mockClaimDueRunsInTransaction: vi.fn().mockResolvedValue([]),
    mockEnqueue: vi.fn().mockResolvedValue("task-id"),
  }));

vi.mock("@/models", () => ({
  ScheduleTriggerModel: {
    findDueTriggerIds: mockFindDueTriggerIds,
    claimDueRunsInTransaction: mockClaimDueRunsInTransaction,
  },
}));

vi.mock("@/task-queue", () => ({
  taskQueueService: { enqueue: mockEnqueue },
}));

vi.mock("@/logging", () => ({
  default: {
    warn: vi.fn(),
  },
}));

import { handleCheckDueScheduleTriggers } from "./check-due-schedule-triggers-handler";

describe("handleCheckDueScheduleTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("enqueues one execution task per claimed run", async () => {
    mockFindDueTriggerIds.mockResolvedValue(["trigger-1"]);
    mockClaimDueRunsInTransaction.mockResolvedValue([
      { id: "run-1" },
      { id: "run-2" },
    ]);

    await handleCheckDueScheduleTriggers();

    expect(mockEnqueue).toHaveBeenNthCalledWith(1, {
      taskType: "schedule_trigger_run_execute",
      payload: { runId: "run-1" },
      tx: expect.anything(),
    });
    expect(mockEnqueue).toHaveBeenNthCalledWith(2, {
      taskType: "schedule_trigger_run_execute",
      payload: { runId: "run-2" },
      tx: expect.anything(),
    });
  });

  test("continues processing later triggers after one claim fails", async () => {
    mockFindDueTriggerIds.mockResolvedValue(["trigger-1", "trigger-2"]);
    mockClaimDueRunsInTransaction
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([{ id: "run-2" }]);

    await handleCheckDueScheduleTriggers();

    expect(mockEnqueue).toHaveBeenCalledWith({
      taskType: "schedule_trigger_run_execute",
      payload: { runId: "run-2" },
      tx: expect.anything(),
    });
  });
});
