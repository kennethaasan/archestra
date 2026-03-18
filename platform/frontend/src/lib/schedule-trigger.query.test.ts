import { describe, expect, test } from "vitest";
import {
  getActiveMutationVariable,
  getRunNowTrackingState,
  isScheduleTriggerRunActive,
} from "../app/agents/triggers/schedule/page";
import {
  getScheduleTriggerListQueryParams,
  getScheduleTriggerRunsQueryParams,
} from "./schedule-trigger.query";

describe("getScheduleTriggerListQueryParams", () => {
  test("ignores client-only polling options", () => {
    expect(
      getScheduleTriggerListQueryParams({
        enabled: true,
        limit: 50,
        offset: 0,
        refetchInterval: 5_000,
      }),
    ).toEqual({
      enabled: true,
      limit: 50,
      offset: 0,
    });
  });
});

describe("getScheduleTriggerRunsQueryParams", () => {
  test("ignores accordion state and polling options", () => {
    expect(
      getScheduleTriggerRunsQueryParams({
        limit: 10,
        offset: 0,
        enabled: false,
        refetchInterval: 3_000,
      }),
    ).toEqual({
      limit: 10,
      offset: 0,
    });
  });
});

describe("getActiveMutationVariable", () => {
  test("returns null once the mutation is no longer pending", () => {
    expect(
      getActiveMutationVariable({
        isPending: false,
        variables: "trigger-123",
      }),
    ).toBeNull();
  });

  test("returns the mutation variable while pending", () => {
    expect(
      getActiveMutationVariable({
        isPending: true,
        variables: "trigger-123",
      }),
    ).toBe("trigger-123");
  });
});

describe("isScheduleTriggerRunActive", () => {
  test("returns true for pending and running states", () => {
    expect(isScheduleTriggerRunActive("pending")).toBe(true);
    expect(isScheduleTriggerRunActive("running")).toBe(true);
  });

  test("returns false for finished or missing states", () => {
    expect(isScheduleTriggerRunActive("success")).toBe(false);
    expect(isScheduleTriggerRunActive("failed")).toBe(false);
    expect(isScheduleTriggerRunActive(null)).toBe(false);
    expect(isScheduleTriggerRunActive(undefined)).toBe(false);
  });
});

describe("getRunNowTrackingState", () => {
  test("keeps the button spinning while the created run is still unresolved", () => {
    expect(
      getRunNowTrackingState({
        activeMutationTriggerId: null,
        currentTriggerId: "trigger-123",
        trackedRunId: "run-123",
        trackedRunStatus: undefined,
      }),
    ).toEqual({
      isButtonSpinning: true,
      shouldPollRuns: true,
      shouldClearTrackedRun: false,
    });
  });

  test("stops the spinner only after the tracked run completes", () => {
    expect(
      getRunNowTrackingState({
        activeMutationTriggerId: null,
        currentTriggerId: "trigger-123",
        trackedRunId: "run-123",
        trackedRunStatus: "success",
      }),
    ).toEqual({
      isButtonSpinning: false,
      shouldPollRuns: false,
      shouldClearTrackedRun: true,
    });
  });
});
