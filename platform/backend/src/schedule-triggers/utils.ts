import { Cron } from "croner";

export const SCHEDULE_TRIGGERS_MAX_DUE_TRIGGERS_PER_SWEEP = 25;
export const SCHEDULE_TRIGGERS_MAX_MISSED_SLOTS_PER_PASS = 20;
export const SCHEDULE_TRIGGER_BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeCronExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, " ");
}

export function normalizeTimezone(timezone: string): string {
  return timezone.trim();
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function createCron(params: {
  cronExpression: string;
  timezone: string;
}): Cron {
  return new Cron(normalizeCronExpression(params.cronExpression), {
    mode: "5-part",
    paused: true,
    timezone: normalizeTimezone(params.timezone),
  });
}

export function calculateNextDueAt(params: {
  cronExpression: string;
  timezone: string;
  from?: Date;
}): Date | null {
  return createCron(params).nextRun(params.from ?? new Date());
}

export function calculateNextDueAtOnOrAfter(params: {
  cronExpression: string;
  timezone: string;
  from: Date;
}): Date | null {
  return createCron(params).nextRun(new Date(params.from.getTime() - 1));
}
