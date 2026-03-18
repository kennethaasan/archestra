# Issue #3378 Implementation Plan: Scheduled Agent Triggers

Issue: https://github.com/archestra-ai/archestra/issues/3378

## Objective

Implement scheduled agent triggers with an OpenClaw-like UX, adapted to Archestra architecture (permissions, trigger tabs, task queue, and agent execution paths).

This feature uses the OpenClaw cron-job model as inspiration, but adapts it to Archestra's multi-user permission model, existing `/agents/triggers` UI, the shared Postgres-backed task queue/worker, and the existing A2A execution path.

The implementation should reuse the existing `croner` dependency for cron parsing and next-occurrence calculation, and it should reuse the existing background task queue/worker for both due-checking and execution. It should not introduce a long-lived in-memory scheduler registry, singleton scheduler, or parallel queueing mechanism as the source of truth. Distributed scheduling state must remain persisted in the database and driven by the task queue plus persisted trigger/run rows.

## Review-Friendly PR Slicing

The implementation should be developed in these logical slices, but the first submission may still be a single PR if that is faster and easier for maintainers to review end-to-end. The branch and commit history should preserve these boundaries so the work can be split into stacked PRs later if maintainers request it.

## Status In This MR

This MR intentionally ships the full Iteration 1 / MVP scope in one branch rather than as stacked PRs. The slicing below remains useful as a review map, but the actual MR includes work from all four slices.

### Completed In This MR

- Data model, migrations, shared schemas/types, and model coverage for `schedule_triggers` and `schedule_trigger_runs`.
- Shared task queue integration using new task types for due-checking and scheduled-run execution, without introducing a parallel scheduler/queueing system.
- Persisted cron scheduling with timezone support, transactional due-slot claiming, immutable run snapshots, and bounded catch-up for missed slots.
- Schedule trigger APIs for create, read, list, update, delete, enable, disable, run-now, and run-history.
- Authorization checks combining `agentTrigger:*` permissions with target-agent access checks.
- Execution through the existing isolated A2A path using the stored trigger actor identity.
- Schedule UI under `/agents/triggers`, including create/edit flows, enable/disable, run-now, list/history views, live run-history updates, and clickable run details/output.
- Backend Vitest coverage, frontend Vitest coverage, Playwright coverage, and user-facing docs for the shipped MVP behavior.

### Intentionally Left Out Of This MR

- Additional schedule kinds beyond cron, including one-shot (`at`) and interval (`every`) schedules.
- Alternative execution modes beyond isolated A2A scheduled runs.
- Delivery/announcement/webhook options and failure notification routing.
- Per-trigger retry/backoff policy beyond the shared task queue behavior already used for dispatch.
- Explicit concurrency policies such as skip/queue/parallel when a prior scheduled run is still active.
- Richer operational UX such as clone trigger, advanced filtering/search/sorting, and other OpenClaw-parity polish beyond the shipped MVP UI.
- Retention/pruning controls, dedicated scheduled-run dashboards, and other platform-operations follow-up work.

### PR 1: Data Model + Migration + Shared Types

- Add `schedule_trigger` and `schedule_trigger_run` entities.
- Define the MVP trigger contract:
  - tenant `organizationId`
  - target `agentId`
  - required `messageTemplate`
  - `scheduleKind = "cron"`
  - `cronExpression`
  - `timezone`
  - `enabled`
  - persisted execution actor `actorUserId`
  - `nextDueAt`
  - `lastRunAt`
  - `lastRunStatus`
  - `lastError`
- Define the MVP run contract:
  - tenant `organizationId`
  - parent `triggerId`
  - `runKind = "due" | "manual"`
  - nullable `dueAt` (required for `due`, null for `manual`)
  - nullable `initiatedByUserId` for manual audit
  - immutable execution snapshot copied at run creation time:
    - `agentIdSnapshot`
    - `messageTemplateSnapshot`
    - `actorUserIdSnapshot`
    - `timezoneSnapshot`
    - `cronExpressionSnapshot`
- Add indexes and uniqueness/idempotency support for due runs.
- Enforce unique due-run creation on `trigger_id + due_at` for scheduled (`due`) runs.
- Add shared schemas/types and validation.
- Add model and validation tests.

### PR 2: Scheduler Engine + Task Queue Integration

- Add periodic due-check task (similar to `check_due_connectors`) named `check_due_schedule_triggers`.
- Reuse the existing `tasks` table, queue worker, handler registration, retry/backoff behavior, and periodic-task seeding flow; scheduled triggers should add task types to that mechanism rather than introducing a new scheduler service.
- Use persisted `nextDueAt` as the source of truth for due-checking.
- Use `croner` only to validate cron expressions and compute the next due occurrence in the stored timezone.
- Do not keep trigger ownership or scheduling state in memory across process lifetime; the shared task queue plus persisted trigger/run rows remain the authoritative mechanism.
- Require transactional due-slot claiming:
  - lock/claim trigger rows before creating due runs (`FOR UPDATE SKIP LOCKED` or equivalent compare-and-swap update)
  - insert the due-run row and advance `nextDueAt` in the same transaction
  - never advance `nextDueAt` from a stale in-memory read after a uniqueness conflict
- Add due-run creation flow:
  - select enabled triggers with `nextDueAt <= now`
  - create a `schedule_trigger_run` row for that exact due slot, including the immutable execution snapshot
  - enqueue an execution task for the new run through the existing task queue
  - advance `nextDueAt` to the next cron occurrence in the stored timezone
- Add idempotent enqueue behavior and duplicate prevention using the run row uniqueness constraint.
- Be explicit that this is not the same dedupe shape as connector syncs: connectors avoid duplicate pending tasks per connector, while scheduled triggers must persist one run row per due slot/manual invocation so they can preserve immutable snapshots, audit history, and catch-up behavior.
- Add catch-up behavior for downtime:
  - enqueue one run per missed due slot
  - do not collapse missed slots into one synthetic run
  - bound catch-up work per sweep with explicit limits:
    - maximum missed slots processed per trigger per scheduler pass
    - maximum historical backfill window
  - leave `nextDueAt` at the next unprocessed missed slot when limits are hit so later sweeps continue catch-up safely
- Add run lifecycle state transitions and run-history persistence.
- Add due-check/idempotency/enqueue tests.

### PR 3: Schedule Trigger APIs

- Add CRUD, enable/disable, and run-now endpoints.
- Add run-history endpoints.
- Add authorization checks for both:
  - trigger-management permissions (`agentTrigger:*`)
  - access to the referenced target agent
- Persist the creating/updating user as `actorUserId`.
- Define manual run semantics:
  - `Run Now` creates a manual run snapshot from the trigger's current config
  - execution uses the manual run's stored `actorUserIdSnapshot`
  - the clicking user is recorded separately as `initiatedByUserId` for audit only
- Add response DTOs exposing:
  - schedule config
  - timezone
  - enabled state
  - actor summary
  - `nextDueAt`
  - `lastRunAt`
  - `lastRunStatus`
  - `lastError`
- Add API integration tests.

### PR 4: UI + Docs + Final Wiring

- Add `Schedule` tab under Agent Triggers.
- Add list/create/edit/enable-disable/run-now/run-history UI.
- Require the following fields in the create/edit flow:
  - target agent
  - trigger name
  - cron expression
  - timezone
  - message template
- Add validation/help text for cron and timezone input.
- Add docs for:
  - permission model
  - execution identity model
  - failure behavior when the stored actor loses access
- Add final integration/e2e coverage.
- Include `/claim #3378` in the PR body for bounty claim.

## MVP Scope

### Iteration 1 (MVP)

- Core schedule trigger CRUD + enable/disable + run-now.
- Cron schedule + timezone support.
- Periodic scheduler + execution enqueue + run history.
- Basic list and per-trigger run history in UI.
- Isolated scheduled agent execution only.
- Stored execution actor (`actorUserId`) on each trigger.
- Required `messageTemplate` for each trigger.
- Catch-up for missed due slots after downtime.
- Immutable per-run execution snapshot copied from the trigger at run creation time.
- Authorization based on both `agentTrigger:*` permissions and target-agent access.

### Explicit MVP decisions

- Execution mode:
  - scheduled runs execute as isolated A2A agent turns
  - no main-session/system-event mode in MVP
- Schedule kinds:
  - only `cron` is supported in MVP
  - `at` and `every` remain Iteration 2 work
- Run identity:
  - background scheduled runs execute as the persisted trigger creator/updater (`actorUserId`)
  - `Run Now` uses the same execution identity as the stored trigger
  - the user who clicks `Run Now` is audit-only via `initiatedByUserId`
  - queued runs execute from the run snapshot, not from mutable trigger fields
- Due-checking:
  - `nextDueAt` is persisted and used as the due-check source of truth
  - due checks must not derive scheduling state from `lastRunAt`
  - cron parsing may use `croner`, but due ownership must not depend on an in-memory scheduler registry
  - due-slot creation and `nextDueAt` advancement must happen under an atomic row claim/transaction
- Catch-up limits:
  - downtime catch-up remains one real run per missed slot
  - scheduler sweeps must enforce bounded backfill to avoid unbounded queue floods after long outages

### Iteration 2 (Stretch)

- UX parity improvements inspired by OpenClaw:
  - rich filters/sorting/search for jobs and runs
  - clone trigger action
  - better validation/help text for schedule input
- Additional schedule kinds:
  - one-shot (`at`) and interval (`every`) in addition to cron
- Operational UX:
  - job-level statuses (`next run`, `last run`, `last error`) surfaced clearly
  - richer manual run semantics if needed beyond MVP audit behavior

### Iteration 3 (Stretch)

- Advanced execution and delivery controls:
  - delivery modes (`none`, `announce`, `webhook`) and target settings
  - best-effort delivery option
  - failure alert destination and cooldown settings
- Reliability and policy controls:
  - per-trigger retry/backoff policy for recurring failures
  - concurrency policy (`already-running` handling: skip/queue/parallel)
- Scheduling controls:
  - exact timing vs jitter/stagger windows to reduce synchronized spikes
- Platform operations:
  - run/session retention and pruning config
  - metrics/dashboard hooks for scheduled-run health and delivery outcomes

## Execution and Authorization Model

### Trigger payload contract

Each schedule trigger must define the minimum information required to execute an agent run:

- `organizationId`: tenant ownership for authorization and background execution
- `agentId`: target internal agent
- `messageTemplate`: required prompt/message to send on each run
- `cronExpression`: 5-field cron expression for MVP
- `timezone`: IANA timezone used to compute due times
- `actorUserId`: persisted execution actor
- `enabled`: whether future due runs may be created

Each persisted run must also store the immutable execution payload that will actually be executed:

- `organizationId`
- `triggerId`
- `runKind`
- `dueAt`
- `initiatedByUserId`
- `agentIdSnapshot`
- `messageTemplateSnapshot`
- `actorUserIdSnapshot`
- `timezoneSnapshot`
- `cronExpressionSnapshot`

### Scheduled execution model

- Scheduled runs are created and dispatched through the existing shared task queue/worker, then execute through the existing isolated A2A execution path.
- The new queue integration is additive, not parallel: the only new pieces are task types and persisted `schedule_trigger_runs` records needed for schedule-specific semantics.
- Each run uses the run snapshot's stored `actorUserIdSnapshot` as the execution identity.
- Scheduled runs use a dedicated isolated session id for traceability.
- Scheduled runs must resolve MCP/tool/API-key access using the stored actor's real access scope.
- Scheduled runs must not be treated as implicit agent-admin executions for tool resolution.
- If the target agent no longer exists, the actor no longer exists, or the actor no longer has access to the target agent, the run fails and is recorded as failed.
- The system must not silently fall back to a broader service identity in MVP.

### Authorization model

All schedule-trigger APIs must enforce both configuration permissions and target-agent access:

- Create:
  - requires `agentTrigger:create`
  - requires access to the selected target agent
- Update:
  - requires `agentTrigger:update`
  - requires access to the referenced target agent
- Delete:
  - requires `agentTrigger:delete`
  - requires access to the referenced target agent
- Run Now:
  - requires `agentTrigger:update`
  - requires access to the referenced target agent
- Read/list/history:
  - requires `agentTrigger:read`
  - requires access to the referenced target agent

This matches the existing Archestra trigger model, where trigger configuration rights alone are not sufficient to invoke an agent a user cannot access.

## Scheduler Semantics

### Due-run creation

- The scheduler shall use persisted `nextDueAt` as the source of truth for due-checking.
- The system may use `croner` to calculate the next occurrence, but persisted trigger state and run rows shall remain authoritative.
- The scheduler shall claim due triggers atomically before creating run rows so multiple workers cannot advance the same trigger from stale state.
- When an enabled trigger reaches `nextDueAt`, the system shall create exactly one due-run record for that trigger and due time.
- If multiple workers/pods attempt the same due slot, the uniqueness constraint on the run row shall prevent duplicates.
- After successfully creating or claiming the due run, the system shall advance `nextDueAt` within the same transaction used to create the run row.
- The due run shall store an immutable execution snapshot copied from the trigger at creation time.
- After commit, the system shall enqueue execution for the persisted run id.

### Catch-up behavior

- If the system is down or delayed and multiple due slots are missed, the scheduler shall enqueue one run per missed due slot.
- MVP shall not coalesce missed due slots into a single run.
- MVP shall bound catch-up processing per scheduler sweep using explicit limits for missed-slot count and/or historical window.
- If catch-up limits are reached, the scheduler shall stop after the last persisted missed slot and leave the next missed slot in `nextDueAt` for a later sweep.
- Disabling a trigger prevents future due-run creation but does not cancel an already-created or already-running run.

### Manual runs

- `Run Now` creates a manual run record with `runKind = "manual"`.
- Manual runs do not participate in `trigger_id + due_at` uniqueness.
- Manual runs execute with the run snapshot copied from the trigger at manual-run creation time.
- The user who initiated the manual run is stored separately as `initiatedByUserId`.

## EARS Acceptance Criteria

### Ubiquitous Requirements

- The system shall allow authorized users to create, edit, delete, enable, disable, and run schedule triggers.
- The system shall persist and display target agent, schedule, timezone, enabled state, execution actor, next run, and last run status.
- The system shall require a message template for every scheduled trigger.
- The system shall persist tenant ownership and immutable per-run execution snapshots so queued runs are stable even if the trigger changes later.

### Event-Driven Requirements

- When an enabled trigger reaches due time, the system shall enqueue exactly one run for that trigger and due time.
- When a user selects Run Now, the system shall enqueue an immediate manual run.
- When a run finishes, the system shall record status, timestamps, and error details.
- When a run is executed, the system shall invoke the target agent through the isolated A2A execution path using the run snapshot's stored execution actor.

### State-Driven Requirements

- While a trigger is disabled, the system shall not create new scheduled due runs.
- While the system is recovering from downtime, it shall enqueue one run per missed due slot until `nextDueAt` is in the future.
- While catch-up exceeds configured safety limits, it shall continue recovery across later sweeps instead of flooding the queue in one pass.
- While a trigger run is active, the system shall apply configured concurrency policy if and when that feature is added (Iteration 3).

### Unwanted Behavior Requirements

- If a duplicate enqueue is attempted for the same trigger and due time, the system shall reject the duplicate via persisted due-run uniqueness.
- If schedule configuration is invalid, the system shall prevent save and return validation feedback.
- If a user has trigger-management permissions but lacks access to the target agent, the system shall reject create/update/delete/run/history operations for that trigger.
- If the stored execution actor is invalid or no longer authorized at execution time, the system shall fail the run and record the error instead of running under a fallback identity.
- If a trigger is edited or deleted after a run is queued, the queued run shall continue using its persisted execution snapshot.

### Optional-Feature Requirements

- Where advanced delivery is configured (`announce`/`webhook`), the system shall route outputs to configured destinations (Iteration 3).
- Where retry/backoff is configured, the system shall apply retry delays and record outcomes (Iteration 3).
- Where exact/jitter timing is configured, the system shall schedule runs accordingly (Iteration 3).

## Test Plan

- Model tests:
  - trigger create/update validation
  - `nextDueAt` calculation
  - due-run uniqueness
  - manual-run creation
  - run snapshot creation and immutability
  - run lifecycle transitions
- Scheduler tests:
  - enabled trigger due now enqueues exactly one due run
  - duplicate due-check attempts across pods do not create duplicate runs
  - duplicate due-check attempts across pods do not advance `nextDueAt` incorrectly
  - disabled triggers do not enqueue
  - multiple missed due slots after downtime create one run per slot
  - catch-up respects configured per-sweep limits and resumes on later sweeps
  - cron next-occurrence calculation uses timezone-aware evaluation without relying on in-memory trigger registration
- Authorization tests:
  - user with `agentTrigger:*` but without target-agent access is rejected
  - user with target-agent access can create/update/delete/run/list history
  - due run fails safely when stored actor later loses access
  - scheduled run does not gain broader tool/API-key access than the stored actor actually has
- API tests:
  - CRUD
  - enable/disable
  - run-now
  - run-history pagination
  - DTO fields
- Integration tests:
  - scheduled run invokes the target agent through isolated A2A execution
  - stored `actorUserId` is used for execution context
  - `initiatedByUserId` is recorded for manual runs
  - queued run still executes the original snapshot after trigger edits
- UI/e2e tests:
  - create/edit/enable-disable/run-now/history flows
  - permission-gated visibility
  - validation for cron/timezone/message template

## Bounty Workflow Notes

- Prefer one implementation branch with clean commits aligned to the logical slices above.
- If maintainers prefer a single review, open one PR and structure the PR description around the same slices.
- If maintainers prefer stacked reviews, split the branch along those same commit boundaries and link each as `Part of #3378`.
- Put `/claim #3378` in the final integration PR that closes the issue.
