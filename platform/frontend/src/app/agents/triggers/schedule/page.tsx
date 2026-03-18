"use client";

import { DocsPage, getDocsUrl } from "@shared";
import {
  AlertCircle,
  CalendarClock,
  ChevronRight,
  Clock3,
  ExternalLink,
  Loader2,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useMemo, useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionButton } from "@/components/ui/permission-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useProfiles } from "@/lib/agent.query";
import { formatCronSchedule } from "@/lib/format-cron";
import { useInteractions } from "@/lib/interaction.query";
import {
  type ScheduleTrigger,
  type ScheduleTriggerRun,
  type ScheduleTriggerRunStatus,
  useCreateScheduleTrigger,
  useDeleteScheduleTrigger,
  useDisableScheduleTrigger,
  useEnableScheduleTrigger,
  useRunScheduleTriggerNow,
  useScheduleTriggerRuns,
  useScheduleTriggers,
  useUpdateScheduleTrigger,
} from "@/lib/schedule-trigger.query";

type ScheduleTriggerFormState = {
  name: string;
  agentId: string;
  cronExpression: string;
  timezone: string;
  messageTemplate: string;
  enabled: boolean;
};

const DEFAULT_FORM_STATE = (): ScheduleTriggerFormState => ({
  name: "",
  agentId: "",
  cronExpression: "0 9 * * 1-5",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  messageTemplate: "",
  enabled: true,
});

type AgentOption = {
  value: string;
  label: string;
  description: string;
};

export default function ScheduleTriggersPage() {
  const { data: triggersResponse, isLoading } = useScheduleTriggers({
    limit: 50,
    offset: 0,
    refetchInterval: 5_000,
  });
  const { data: agents = [], isLoading: agentsLoading } = useProfiles({
    filters: { agentType: "agent" },
  });
  const createMutation = useCreateScheduleTrigger();
  const updateMutation = useUpdateScheduleTrigger();
  const deleteMutation = useDeleteScheduleTrigger();
  const enableMutation = useEnableScheduleTrigger();
  const disableMutation = useDisableScheduleTrigger();
  const runNowMutation = useRunScheduleTriggerNow();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<ScheduleTrigger | null>(
    null,
  );
  const [formState, setFormState] =
    useState<ScheduleTriggerFormState>(DEFAULT_FORM_STATE);

  const triggers = triggersResponse?.data ?? [];
  const enabledCount = triggers.filter((trigger) => trigger.enabled).length;
  const agentOptions = useMemo(
    () =>
      agents.map((agent) => ({
        value: agent.id,
        label: agent.name || "Untitled agent",
        description:
          agent.scope === "personal"
            ? "Personal agent"
            : `${agent.scope} agent`,
      })),
    [agents],
  );

  const formPayload = buildScheduleTriggerPayload(formState);
  const isFormValid = formPayload !== null;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const openCreateDialog = () => {
    setEditingTrigger(null);
    setFormState(DEFAULT_FORM_STATE());
    setDialogOpen(true);
  };

  const openEditDialog = (trigger: ScheduleTrigger) => {
    setEditingTrigger(trigger);
    setFormState({
      name: trigger.name,
      agentId: trigger.agentId,
      cronExpression: trigger.cronExpression,
      timezone: trigger.timezone,
      messageTemplate: trigger.messageTemplate,
      enabled: trigger.enabled,
    });
    setDialogOpen(true);
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingTrigger(null);
      setFormState(DEFAULT_FORM_STATE());
    }
  };

  const submitForm = async () => {
    if (!formPayload) {
      return;
    }

    const result = editingTrigger
      ? await updateMutation.mutateAsync({
          id: editingTrigger.id,
          body: formPayload,
        })
      : await createMutation.mutateAsync(formPayload);

    if (result) {
      closeDialog(false);
    }
  };

  const cronPreview = formState.cronExpression.trim()
    ? formatCronSchedule(formState.cronExpression.trim())
    : "Enter a cron expression";
  const timezonePreview = getTimezonePreview(formState.timezone);
  const hasAgents = agentOptions.length > 0;

  return (
    <div className="space-y-6">
      <Card className="border-dashed bg-card/60">
        <CardContent className="flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-primary" />
              <p className="text-sm font-medium">
                Run internal agents on a persisted cron schedule
              </p>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Each trigger stores its execution actor, survives restarts, and
              keeps per-run history for due and manual runs.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                variant="outline"
                className="border-primary/30 text-primary"
              >
                {enabledCount} enabled
              </Badge>
              <span>{triggers.length} total triggers</span>
              <Link
                href={getDocsUrl(DocsPage.PlatformAgentTriggersSchedule)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Schedule trigger docs
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
          <ScheduleTriggerCreateButton
            hasAgents={hasAgents}
            onClick={openCreateDialog}
          >
            New Schedule
          </ScheduleTriggerCreateButton>
        </CardContent>
      </Card>

      {!hasAgents && !agentsLoading && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No internal agents available</AlertTitle>
          <AlertDescription>
            Schedule triggers can only target internal agents that you can
            access.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="flex h-32 items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">
              Loading scheduled triggers...
            </span>
          </CardContent>
        </Card>
      ) : triggers.length === 0 ? (
        <Empty className="border border-dashed bg-card/40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>No schedule triggers yet</EmptyTitle>
            <EmptyDescription>
              Create a cron-based trigger to run an internal agent without a
              chat channel.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ScheduleTriggerCreateButton
              hasAgents={hasAgents}
              onClick={openCreateDialog}
            >
              Create Schedule
            </ScheduleTriggerCreateButton>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          {triggers.map((trigger) => (
            <ScheduleTriggerCard
              key={trigger.id}
              trigger={trigger}
              deletingId={deleteMutation.variables ?? null}
              enablingId={enableMutation.variables ?? null}
              disablingId={disableMutation.variables ?? null}
              runningId={runNowMutation.variables ?? null}
              onEdit={openEditDialog}
              onDelete={(id) => deleteMutation.mutate(id)}
              onEnable={(id) => enableMutation.mutate(id)}
              onDisable={(id) => disableMutation.mutate(id)}
              onRunNow={(id) => runNowMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={closeDialog}
        title={
          editingTrigger ? "Edit Schedule Trigger" : "Create Schedule Trigger"
        }
        description="Use a 5-field cron expression and a valid IANA timezone. Runs are executed with the stored actor's agent access."
      >
        <DialogForm
          onSubmit={() => {
            void submitForm();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ScheduleTriggerFormFields
            formState={formState}
            agentOptions={agentOptions}
            agentsLoading={agentsLoading}
            hasAgents={hasAgents}
            cronPreview={cronPreview}
            timezonePreview={timezonePreview}
            onNameChange={(name) =>
              setFormState((current) => ({ ...current, name }))
            }
            onAgentChange={(agentId) =>
              setFormState((current) => ({ ...current, agentId }))
            }
            onCronExpressionChange={(cronExpression) =>
              setFormState((current) => ({
                ...current,
                cronExpression,
              }))
            }
            onTimezoneChange={(timezone) =>
              setFormState((current) => ({ ...current, timezone }))
            }
            onMessageTemplateChange={(messageTemplate) =>
              setFormState((current) => ({
                ...current,
                messageTemplate,
              }))
            }
            onEnabledChange={(enabled) =>
              setFormState((current) => ({ ...current, enabled }))
            }
          />

          <DialogFooter className="mt-0">
            <Button
              variant="outline"
              type="button"
              onClick={() => closeDialog(false)}
            >
              Cancel
            </Button>
            <PermissionButton
              permissions={{
                agentTrigger: [editingTrigger ? "update" : "create"],
              }}
              type="submit"
              disabled={isSaving || !isFormValid}
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingTrigger ? "Save Changes" : "Create Trigger"}
            </PermissionButton>
          </DialogFooter>
        </DialogForm>
      </FormDialog>
    </div>
  );
}

function ScheduleTriggerCreateButton({
  hasAgents,
  onClick,
  children,
}: {
  hasAgents: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <PermissionButton
      permissions={{ agentTrigger: ["create"] }}
      onClick={onClick}
      disabled={!hasAgents}
      tooltip={
        hasAgents
          ? undefined
          : "You need access to at least one internal agent to create a schedule."
      }
    >
      <Plus className="mr-2 h-4 w-4" />
      {children}
    </PermissionButton>
  );
}

function ScheduleTriggerFormFields({
  formState,
  agentOptions,
  agentsLoading,
  hasAgents,
  cronPreview,
  timezonePreview,
  onNameChange,
  onAgentChange,
  onCronExpressionChange,
  onTimezoneChange,
  onMessageTemplateChange,
  onEnabledChange,
}: {
  formState: ScheduleTriggerFormState;
  agentOptions: AgentOption[];
  agentsLoading: boolean;
  hasAgents: boolean;
  cronPreview: string;
  timezonePreview: string | null;
  onNameChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onCronExpressionChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onMessageTemplateChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
}) {
  return (
    <DialogBody className="grid gap-4 py-2">
      <div className="grid gap-2">
        <Label htmlFor="schedule-trigger-name">Trigger name</Label>
        <Input
          id="schedule-trigger-name"
          value={formState.name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Weekday summary"
        />
      </div>

      <div className="grid gap-2">
        <Label>Target agent</Label>
        <SearchableSelect
          value={formState.agentId}
          onValueChange={onAgentChange}
          items={agentOptions}
          placeholder="Select an internal agent"
          searchPlaceholder="Search agents..."
          className="w-full"
          disabled={agentsLoading || !hasAgents}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="schedule-trigger-cron">Cron expression</Label>
          <Input
            id="schedule-trigger-cron"
            value={formState.cronExpression}
            onChange={(event) => onCronExpressionChange(event.target.value)}
            placeholder="0 9 * * 1-5"
          />
          <p className="text-xs text-muted-foreground">
            5-field cron only. Preview: {cronPreview}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="schedule-trigger-timezone">Timezone</Label>
          <Input
            id="schedule-trigger-timezone"
            value={formState.timezone}
            onChange={(event) => onTimezoneChange(event.target.value)}
            placeholder="Europe/Oslo"
          />
          <p className="text-xs text-muted-foreground">
            {timezonePreview ??
              "Use an IANA timezone such as Europe/Oslo or America/New_York."}
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="schedule-trigger-message">Message template</Label>
        <Textarea
          id="schedule-trigger-message"
          value={formState.messageTemplate}
          onChange={(event) => onMessageTemplateChange(event.target.value)}
          placeholder="Review yesterday's failures and send me a short summary."
          className="min-h-32"
        />
        <p className="text-xs text-muted-foreground">
          This exact message is copied into each run snapshot when the run is
          created.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border px-3 py-3">
        <div className="space-y-1">
          <Label htmlFor="schedule-trigger-enabled">Enabled</Label>
          <p className="text-xs text-muted-foreground">
            Disabled triggers keep history but do not create future due runs.
          </p>
        </div>
        <Switch
          id="schedule-trigger-enabled"
          checked={formState.enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
    </DialogBody>
  );
}

function ScheduleTriggerCard({
  trigger,
  deletingId,
  enablingId,
  disablingId,
  runningId,
  onEdit,
  onDelete,
  onEnable,
  onDisable,
  onRunNow,
}: {
  trigger: ScheduleTrigger;
  deletingId: string | null;
  enablingId: string | null;
  disablingId: string | null;
  runningId: string | null;
  onEdit: (trigger: ScheduleTrigger) => void;
  onDelete: (id: string) => void;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onRunNow: (id: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: runsResponse, isLoading: runsLoading } = useScheduleTriggerRuns(
    trigger.id,
    {
      limit: 10,
      offset: 0,
      enabled: historyOpen,
      refetchInterval: historyOpen ? 3_000 : false,
    },
  );
  const selectedRun =
    selectedRunId === null
      ? null
      : (runsResponse?.data.find((run) => run.id === selectedRunId) ?? null);

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{trigger.name}</CardTitle>
              <StatusBadge
                label={trigger.enabled ? "Enabled" : "Paused"}
                tone={trigger.enabled ? "success" : "muted"}
              />
              {trigger.lastRunStatus && (
                <StatusBadge
                  label={`Last run ${trigger.lastRunStatus}`}
                  tone={statusToneMap[trigger.lastRunStatus]}
                />
              )}
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{formatCronSchedule(trigger.cronExpression)}</p>
              <p>
                {trigger.cronExpression} in {trigger.timezone}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <PermissionButton
              permissions={{ agentTrigger: ["update"] }}
              variant="outline"
              size="sm"
              onClick={() => onRunNow(trigger.id)}
              disabled={runningId === trigger.id}
            >
              {runningId === trigger.id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run Now
            </PermissionButton>

            <PermissionButton
              permissions={{ agentTrigger: ["update"] }}
              variant="outline"
              size="sm"
              onClick={() => onEdit(trigger)}
            >
              Edit
            </PermissionButton>

            {trigger.enabled ? (
              <PermissionButton
                permissions={{ agentTrigger: ["update"] }}
                variant="outline"
                size="sm"
                onClick={() => onDisable(trigger.id)}
                disabled={disablingId === trigger.id}
              >
                {disablingId === trigger.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PowerOff className="mr-2 h-4 w-4" />
                )}
                Disable
              </PermissionButton>
            ) : (
              <PermissionButton
                permissions={{ agentTrigger: ["update"] }}
                variant="outline"
                size="sm"
                onClick={() => onEnable(trigger.id)}
                disabled={enablingId === trigger.id}
              >
                {enablingId === trigger.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Power className="mr-2 h-4 w-4" />
                )}
                Enable
              </PermissionButton>
            )}

            <PermissionButton
              permissions={{ agentTrigger: ["delete"] }}
              variant="outline"
              size="sm"
              onClick={() => onDelete(trigger.id)}
              disabled={deletingId === trigger.id}
            >
              {deletingId === trigger.id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </PermissionButton>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailItem
            label="Target agent"
            value={trigger.agent?.name ?? trigger.agentId}
          />
          <DetailItem
            label="Execution actor"
            value={
              trigger.actor?.name || trigger.actor?.email || trigger.actorUserId
            }
          />
          <DetailItem
            label="Next due"
            value={formatTimestamp(trigger.nextDueAt)}
          />
          <DetailItem
            label="Last completed run"
            value={formatTimestamp(trigger.lastRunAt)}
          />
        </div>

        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Message template
          </p>
          <p className="whitespace-pre-wrap text-sm">
            {trigger.messageTemplate}
          </p>
        </div>

        {trigger.lastError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Last run failed</AlertTitle>
            <AlertDescription>{trigger.lastError}</AlertDescription>
          </Alert>
        )}

        <Accordion
          type="single"
          collapsible
          value={historyOpen ? "history" : undefined}
          onValueChange={(value) => setHistoryOpen(value === "history")}
        >
          <AccordionItem
            value="history"
            className="rounded-lg border px-4 last:border-b"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 text-sm">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                Run history
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              {runsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading recent runs...
                </div>
              ) : (runsResponse?.data.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No runs recorded yet.
                </p>
              ) : (
                runsResponse?.data.map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    className="w-full rounded-lg border bg-card/60 px-3 py-3 text-left transition-colors hover:bg-card"
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={run.status}
                          tone={statusToneMap[run.status]}
                        />
                        <Badge variant="outline">{run.runKind}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {run.runKind === "due"
                            ? `Due ${formatTimestamp(run.dueAt)}`
                            : `Queued ${formatTimestamp(run.createdAt)}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          Completed {formatTimestamp(run.completedAt)}
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          View details
                          <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                    {run.error && (
                      <p className="mt-2 text-sm text-destructive">
                        {run.error}
                      </p>
                    )}
                  </button>
                ))
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>

      <RunDetailDialog
        run={selectedRun}
        open={selectedRunId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRunId(null);
          }
        }}
      />
    </Card>
  );
}

function RunDetailDialog({
  run,
  open,
  onOpenChange,
}: {
  run: ScheduleTriggerRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sessionId = run ? getScheduleTriggerRunSessionId(run.id) : undefined;
  const isRunActive = run?.status === "pending" || run?.status === "running";
  const { data: interactionsResponse, isLoading: interactionsLoading } =
    useInteractions({
      sessionId,
      limit: 50,
      offset: 0,
      sortBy: "createdAt",
      sortDirection: "desc",
      enabled: open && !!sessionId,
      refetchInterval: open && isRunActive ? 3_000 : false,
    });

  const output = extractScheduleRunOutput(interactionsResponse?.data ?? []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Run details</DialogTitle>
          <DialogDescription>
            Review the queued prompt, the latest run status, and any output
            captured for this execution.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {!run ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading run details...
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailItem label="Status" value={run.status} />
                <DetailItem label="Kind" value={run.runKind} />
                <DetailItem
                  label="Queued"
                  value={formatTimestamp(run.createdAt)}
                />
                <DetailItem
                  label="Completed"
                  value={formatTimestamp(run.completedAt)}
                />
              </div>

              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Prompt snapshot
                </p>
                <p className="whitespace-pre-wrap text-sm">
                  {run.messageTemplateSnapshot}
                </p>
              </div>

              <div className="rounded-lg border bg-card/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Output
                  </p>
                  <Link
                    href={`/llm/logs/session/${encodeURIComponent(getScheduleTriggerRunSessionId(run.id))}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open session logs
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>

                {interactionsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading captured output...
                  </div>
                ) : output ? (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">
                    {output}
                  </pre>
                ) : run.error ? (
                  <p className="whitespace-pre-wrap text-sm text-destructive">
                    {run.error}
                  </p>
                ) : isRunActive ? (
                  <p className="text-sm text-muted-foreground">
                    This run is still in progress. Output will appear here when
                    the execution finishes.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No output was captured for this run.
                  </p>
                )}
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "danger" | "warning" | "muted" | "running";
}) {
  const toneClassName =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "danger"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : tone === "running"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
            : "border-border bg-muted text-muted-foreground";

  return (
    <Badge variant="outline" className={toneClassName}>
      {label}
    </Badge>
  );
}

const statusToneMap: Record<
  ScheduleTriggerRunStatus,
  "success" | "danger" | "warning" | "running"
> = {
  pending: "warning",
  running: "running",
  success: "success",
  failed: "danger",
};

function buildScheduleTriggerPayload(formState: ScheduleTriggerFormState) {
  const payload = {
    name: formState.name.trim(),
    agentId: formState.agentId,
    cronExpression: formState.cronExpression.trim(),
    timezone: formState.timezone.trim(),
    messageTemplate: formState.messageTemplate.trim(),
    enabled: formState.enabled,
  };

  if (
    !payload.name ||
    !payload.agentId ||
    !payload.cronExpression ||
    !payload.timezone ||
    !payload.messageTemplate
  ) {
    return null;
  }

  return payload;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not yet";
  }

  return new Date(value).toLocaleString();
}

function getTimezonePreview(timezone: string): string | null {
  const normalized = timezone.trim();
  if (!normalized) {
    return null;
  }

  try {
    return `Current time there: ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: normalized,
    }).format(new Date())}`;
  } catch {
    return "Timezone must be a valid IANA value such as Europe/Oslo.";
  }
}

function getScheduleTriggerRunSessionId(runId: string): string {
  return `schedule-trigger-run:${runId}`;
}

function extractScheduleRunOutput(
  interactions: Array<{ response?: unknown }>,
): string | null {
  for (const interaction of interactions) {
    const output = extractTextFromInteractionResponse(interaction.response);
    if (output) {
      return output;
    }
  }

  return null;
}

function extractTextFromInteractionResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidateResponse = response as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    choices?: Array<{
      message?: {
        content?:
          | string
          | Array<{ type?: string; text?: string; refusal?: string }>;
      };
    }>;
    content?: Array<{ type?: string; text?: string }>;
  };

  const geminiText = candidateResponse.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (geminiText) {
    return geminiText;
  }

  for (const choice of candidateResponse.choices ?? []) {
    const content = choice.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) =>
          part.type === "text"
            ? part.text
            : part.type === "refusal"
              ? part.refusal
              : undefined,
        )
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
    }
  }

  const anthropicText = candidateResponse.content
    ?.filter((block) => block.type === "text" && !!block.text)
    .map((block) => block.text?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (anthropicText) {
    return anthropicText;
  }

  return null;
}
