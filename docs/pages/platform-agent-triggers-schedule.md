---
title: Scheduled Triggers
category: Agents
subcategory: Agent Triggers
order: 7
description: Run internal agents on cron schedules with persisted execution identity
lastUpdated: 2026-03-18
---

![Scheduled trigger dialog](/docs/automated_screenshots/platform-agent-triggers-schedule_create-dialog.png)

Scheduled Triggers let you run an internal agent without Slack, MS Teams, or email. Each trigger stores the target agent, cron expression, timezone, message template, and the user identity that will execute future runs.

## How It Works

1. Archestra persists `nextDueAt` for each enabled trigger.
2. A periodic scheduler claims due slots, creates immutable run snapshots, and enqueues execution.
3. Each run executes through the isolated A2A path and is written to run history.

Use a 5-field cron expression and a valid IANA timezone such as `Europe/Oslo` or `America/New_York`.

## Permissions And Identity

- Managing schedule triggers requires the relevant `agentTrigger:*` permission.
- Trigger permissions are not enough by themselves. The acting user must also have access to the referenced target agent.
- Future scheduled runs execute as the stored trigger actor (`actorUserId`), not as the user who most recently opened the page.
- `Run Now` keeps the same execution identity as the stored trigger and records the clicking user separately for audit.

## Failure Behavior

- If the stored actor is deleted, loses access to the target agent, or the target agent no longer exists, the run is marked as failed.
- Failed runs update the trigger's `lastRunStatus`, `lastRunAt`, and `lastError` fields.
- Disabling a trigger stops future due-run creation but does not remove already-created runs or existing history.

## Run History

The **Schedule** tab shows:

- trigger status and next due time
- last run outcome and error
- recent due and manual runs
- the exact message template that will be copied into each queued run
