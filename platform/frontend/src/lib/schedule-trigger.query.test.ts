import { describe, expect, test } from "vitest";
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
