"use client";

import { DocsPage, getDocsUrl } from "@shared";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CronExpressionPicker,
  type CronPresetOption,
} from "@/components/ui/cron-expression-picker";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionButton } from "@/components/ui/permission-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProfiles } from "@/lib/agent.query";
import { useInteractions } from "@/lib/interactions/interaction.query";
import {
  type ScheduleTrigger,
  type ScheduleTriggerRun,
  type ScheduleTriggerRunStatus,
  useCreateScheduleTrigger,
  useDeleteScheduleTrigger,
  useDisableScheduleTrigger,
  useEnableScheduleTrigger,
  useRunScheduleTriggerNow,
  useScheduleTrigger,
  useScheduleTriggerRuns,
  useScheduleTriggers,
  useUpdateScheduleTrigger,
} from "@/lib/schedule-trigger.query";
import { cn } from "@/lib/utils";
import { formatRelativeTimeFromNow } from "@/lib/utils/date-time";
import { formatCronSchedule } from "@/lib/utils/format-cron";
import {
  type AgentOption,
  buildScheduleTriggerPayload,
  buildTimezoneOptions,
  DEFAULT_FORM_STATE,
  deriveScheduleTriggerName,
  getActiveMutationVariable,
  getRunNowTrackingState,
  type ScheduleTriggerFormState,
} from "./schedule-trigger.utils";

const SCHEDULE_PRESET_OPTIONS: CronPresetOption[] = [
  { label: "Weekdays at 09:00", value: "0 9 * * 1-5" },
  { label: "Every day at 09:00", value: "0 9 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every Monday at 09:00", value: "0 9 * * 1" },
];

export function ScheduleTriggersIndexPage() {
  const router = useRouter();
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
  const runNowMutation = useRunScheduleTriggerNow();

  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<ScheduleTrigger | null>(
    null,
  );
  const [formState, setFormState] =
    useState<ScheduleTriggerFormState>(DEFAULT_FORM_STATE);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [nextRunFilter, setNextRunFilter] = useState<
    "all" | "today" | "later" | "none"
  >("all");
  const composerRef = useRef<HTMLDivElement>(null);
  const [deletingTrigger, setDeletingTrigger] =
    useState<ScheduleTrigger | null>(null);

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

  const allTriggers = useMemo(
    () => sortScheduleTriggers(triggersResponse?.data ?? []),
    [triggersResponse?.data],
  );
  const filteredTriggers = useMemo(
    () =>
      allTriggers.filter((trigger) => {
        if (statusFilter === "enabled" && !trigger.enabled) {
          return false;
        }
        if (statusFilter === "disabled" && trigger.enabled) {
          return false;
        }
        if (agentFilter !== "all" && trigger.agentId !== agentFilter) {
          return false;
        }
        if (!matchesNextRunFilter(trigger.nextDueAt, nextRunFilter)) {
          return false;
        }

        return true;
      }),
    [agentFilter, allTriggers, nextRunFilter, statusFilter],
  );
  const enabledCount = allTriggers.filter((trigger) => trigger.enabled).length;
  const timezoneOptions = useMemo(
    () => buildTimezoneOptions(formState.timezone),
    [formState.timezone],
  );
  const hasAgents = agentOptions.length > 0;
  const preferredAgentId = agentOptions[0]?.value ?? "";
  const effectiveName = useMemo(
    () =>
      formState.name.trim() ||
      deriveScheduleTriggerName(
        formState,
        agentOptions.find((option) => option.value === formState.agentId)
          ?.label,
      ),
    [agentOptions, formState],
  );
  const formPayload = buildScheduleTriggerPayload({
    ...formState,
    name: effectiveName,
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isComposerOpen =
    editingTrigger !== null || createFormOpen || allTriggers.length === 0;

  useEffect(() => {
    if (!isLoading && allTriggers.length === 0) {
      setCreateFormOpen(true);
    }
  }, [allTriggers.length, isLoading]);

  useEffect(() => {
    if (!isComposerOpen) {
      return;
    }

    if (typeof composerRef.current?.scrollIntoView === "function") {
      composerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [isComposerOpen]);

  useEffect(() => {
    if (
      editingTrigger ||
      !createFormOpen ||
      !preferredAgentId ||
      formState.agentId
    ) {
      return;
    }

    setFormState((current) => ({ ...current, agentId: preferredAgentId }));
  }, [createFormOpen, editingTrigger, formState.agentId, preferredAgentId]);

  const openCreateComposer = () => {
    setEditingTrigger(null);
    setFormState({
      ...DEFAULT_FORM_STATE(),
      agentId: preferredAgentId,
    });
    setCreateFormOpen(true);
  };

  const openEditComposer = useCallback((trigger: ScheduleTrigger) => {
    setEditingTrigger(trigger);
    setCreateFormOpen(false);
    setFormState({
      name: trigger.name,
      agentId: trigger.agentId,
      cronExpression: trigger.cronExpression,
      timezone: trigger.timezone,
      messageTemplate: trigger.messageTemplate,
    });
  }, []);

  const closeComposer = () => {
    setEditingTrigger(null);
    setCreateFormOpen(false);
    setFormState(DEFAULT_FORM_STATE());
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

    if (!result) {
      return;
    }

    closeComposer();

    if (!editingTrigger) {
      router.push(`/agents/triggers/schedule/${result.id}`);
    }
  };

  const confirmDelete = async () => {
    if (!deletingTrigger) {
      return;
    }

    const result = await deleteMutation.mutateAsync(deletingTrigger.id);
    if (result?.success) {
      setDeletingTrigger(null);
    }
  };

  const columns = useMemo<ColumnDef<ScheduleTrigger>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Trigger",
        cell: ({ row }) => (
          <div className="min-w-0 space-y-1.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-medium text-foreground">
                {row.original.name}
              </span>
              <StatusBadge
                label={row.original.enabled ? "Enabled" : "Disabled"}
                tone={row.original.enabled ? "success" : "muted"}
              />
            </div>
            <p className="truncate text-xs text-muted-foreground/55">
              {truncateText(row.original.messageTemplate, 110)}
            </p>
          </div>
        ),
      },
      {
        id: "cadence",
        header: "Cadence",
        cell: ({ row }) => (
          <div className="space-y-1 py-1">
            <p className="text-sm font-medium text-foreground/95">
              {formatCronSchedule(row.original.cronExpression)}
            </p>
            <p className="text-xs text-muted-foreground/60">
              {row.original.agent?.name ?? row.original.agentId} in{" "}
              {row.original.timezone}
            </p>
          </div>
        ),
      },
      {
        id: "nextRun",
        header: "Next run",
        cell: ({ row }) => (
          <TimestampCell
            value={row.original.nextDueAt}
            emptyLabel="Not scheduled"
          />
        ),
      },
      {
        id: "lastResult",
        header: "Last result",
        cell: ({ row }) => (
          <div className="space-y-1">
            {row.original.lastRunStatus ? (
              <StatusBadge
                label={row.original.lastRunStatus}
                tone={statusToneMap[row.original.lastRunStatus]}
              />
            ) : (
              <span className="text-sm text-muted-foreground/70">
                No runs yet
              </span>
            )}
            <p className="text-xs text-muted-foreground/60">
              {row.original.lastRunAt
                ? formatRelativeTimeFromNow(row.original.lastRunAt)
                : "No recent completion"}
            </p>
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const trigger = row.original;
          const isRunningNow =
            getActiveMutationVariable(runNowMutation) === trigger.id;
          const isDeletePending =
            getActiveMutationVariable(deleteMutation) === trigger.id;

          return (
            <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity md:opacity-60 md:group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground/80 hover:text-foreground"
                    aria-label="Edit trigger"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openEditComposer(trigger);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Edit trigger</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground/80 hover:text-foreground"
                    aria-label={
                      isRunningNow ? "Running trigger" : "Run trigger"
                    }
                    disabled={isRunningNow}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!isRunningNow) {
                        void runNowMutation.mutateAsync(trigger.id);
                      }
                    }}
                  >
                    {isRunningNow ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isRunningNow ? "Running trigger" : "Run trigger"}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive/80 hover:text-destructive"
                    aria-label="Delete trigger"
                    disabled={isDeletePending}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeletingTrigger(trigger);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Delete trigger</TooltipContent>
              </Tooltip>
            </div>
          );
        },
      },
    ],
    [deleteMutation, runNowMutation, openEditComposer],
  );

  return (
    <div className="mr-auto flex w-full max-w-[1380px] flex-col gap-8">
      <WorkspaceHeader
        totalCount={allTriggers.length}
        enabledCount={enabledCount}
        hasAgents={hasAgents}
        onCreate={openCreateComposer}
      />

      {!hasAgents && !agentsLoading && (
        <Alert className="border-0 bg-muted/30">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No internal agents available</AlertTitle>
          <AlertDescription>
            Schedule triggers can only target internal agents that you can
            access.
          </AlertDescription>
        </Alert>
      )}

      {isComposerOpen && (
        <ScheduleTriggerFormFields
          formState={formState}
          effectiveName={effectiveName}
          agentOptions={agentOptions}
          timezoneOptions={timezoneOptions}
          agentsLoading={agentsLoading}
          hasAgents={hasAgents}
          isSaving={isSaving}
          isFormValid={formPayload !== null}
          isEditing={editingTrigger !== null}
          onCancel={allTriggers.length === 0 ? undefined : closeComposer}
          onSubmit={() => {
            void submitForm();
          }}
          onNameChange={(name) =>
            setFormState((current) => ({ ...current, name }))
          }
          onAgentChange={(agentId) =>
            setFormState((current) => ({ ...current, agentId }))
          }
          onCronExpressionChange={(cronExpression) =>
            setFormState((current) => ({ ...current, cronExpression }))
          }
          onTimezoneChange={(timezone) =>
            setFormState((current) => ({ ...current, timezone }))
          }
          onMessageTemplateChange={(messageTemplate) =>
            setFormState((current) => ({ ...current, messageTemplate }))
          }
        />
      )}

      <section className="space-y-4">
        <FilterToolbar
          statusFilter={statusFilter}
          agentFilter={agentFilter}
          nextRunFilter={nextRunFilter}
          agentOptions={agentOptions}
          onStatusFilterChange={setStatusFilter}
          onAgentFilterChange={setAgentFilter}
          onNextRunFilterChange={setNextRunFilter}
          onReset={() => {
            setStatusFilter("all");
            setAgentFilter("all");
            setNextRunFilter("all");
          }}
        />

        <DataTable
          columns={columns}
          data={filteredTriggers}
          isLoading={isLoading}
          emptyMessage="No scheduled triggers yet."
          filteredEmptyMessage="No scheduled triggers match the current filters."
          hasActiveFilters={
            statusFilter !== "all" ||
            agentFilter !== "all" ||
            nextRunFilter !== "all"
          }
          onClearFilters={() => {
            setStatusFilter("all");
            setAgentFilter("all");
            setNextRunFilter("all");
          }}
          onRowClick={(trigger) =>
            router.push(`/agents/triggers/schedule/${trigger.id}`)
          }
          getRowClassName={() => "group"}
          hideSelectedCount
          hidePaginationWhenSinglePage
        />
      </section>

      <DeleteConfirmDialog
        open={deletingTrigger !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingTrigger(null);
          }
        }}
        title="Delete scheduled trigger"
        description={
          deletingTrigger
            ? `Delete "${deletingTrigger.name}"? This action cannot be undone.`
            : "Delete this scheduled trigger? This action cannot be undone."
        }
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          void confirmDelete();
        }}
        confirmLabel="Delete trigger"
        pendingLabel="Deleting..."
      />
    </div>
  );
}

export function ScheduleTriggerDetailPage({
  triggerId,
}: {
  triggerId: string;
}) {
  const router = useRouter();
  const { data: trigger, isLoading } = useScheduleTrigger(triggerId, {
    refetchInterval: 5_000,
  });
  const { data: agents = [], isLoading: agentsLoading } = useProfiles({
    filters: { agentType: "agent" },
  });
  const updateMutation = useUpdateScheduleTrigger();
  const deleteMutation = useDeleteScheduleTrigger();
  const enableMutation = useEnableScheduleTrigger();
  const disableMutation = useDisableScheduleTrigger();
  const runNowMutation = useRunScheduleTriggerNow();

  const [editing, setEditing] = useState(false);
  const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
  const [formState, setFormState] =
    useState<ScheduleTriggerFormState>(DEFAULT_FORM_STATE);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!trigger) {
      return;
    }

    setFormState({
      name: trigger.name,
      agentId: trigger.agentId,
      cronExpression: trigger.cronExpression,
      timezone: trigger.timezone,
      messageTemplate: trigger.messageTemplate,
    });
  }, [trigger]);

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
  const timezoneOptions = useMemo(
    () => buildTimezoneOptions(formState.timezone),
    [formState.timezone],
  );
  const effectiveName = useMemo(
    () =>
      formState.name.trim() ||
      deriveScheduleTriggerName(
        formState,
        agentOptions.find((option) => option.value === formState.agentId)
          ?.label,
      ),
    [agentOptions, formState],
  );
  const formPayload = buildScheduleTriggerPayload({
    ...formState,
    name: effectiveName,
  });
  const isSaving = updateMutation.isPending;
  const runNowState = getRunNowTrackingState({
    activeMutationTriggerId: getActiveMutationVariable(runNowMutation),
    currentTriggerId: triggerId,
    trackedRunId,
  });

  const handleRunNow = async () => {
    const run = await runNowMutation.mutateAsync(triggerId);
    if (run) {
      setTrackedRunId(run.id);
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate(triggerId, {
      onSuccess: (result) => {
        if (result?.success) {
          setDeleteDialogOpen(false);
          router.push("/agents/triggers/schedule");
        }
      },
    });
  };

  const submitForm = async () => {
    if (!formPayload) {
      return;
    }

    const result = await updateMutation.mutateAsync({
      id: triggerId,
      body: formPayload,
    });

    if (result) {
      setEditing(false);
    }
  };

  const resetEditingState = () => {
    if (!trigger) {
      return;
    }

    setFormState({
      name: trigger.name,
      agentId: trigger.agentId,
      cronExpression: trigger.cronExpression,
      timezone: trigger.timezone,
      messageTemplate: trigger.messageTemplate,
    });
    setEditing(false);
  };

  if (isLoading) {
    return (
      <Card className="border-0 bg-muted/20">
        <CardContent className="flex h-40 items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">
            Loading schedule trigger...
          </span>
        </CardContent>
      </Card>
    );
  }

  if (!trigger) {
    return (
      <Alert className="border-0 bg-muted/30">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Schedule not found</AlertTitle>
        <AlertDescription>
          The trigger may have been removed, or you may no longer have access.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mr-auto flex w-full max-w-[1380px] flex-col gap-8">
      <section className="overflow-hidden rounded-xl border bg-background shadow-sm">
        <div className="flex flex-col gap-4 border-b px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Button variant="ghost" size="sm" asChild className="h-8 px-2">
                <Link href="/agents/triggers/schedule">
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back
                </Link>
              </Button>
              <span className="hidden sm:inline">Scheduled trigger</span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {editing
                    ? formState.name.trim() || effectiveName
                    : trigger.name}
                </h1>
                <StatusBadge
                  label={trigger.enabled ? "Enabled" : "Disabled"}
                  tone={trigger.enabled ? "success" : "muted"}
                />
                {trigger.lastRunStatus && (
                  <StatusBadge
                    label={trigger.lastRunStatus}
                    tone={statusToneMap[trigger.lastRunStatus]}
                  />
                )}
              </div>
              {editing ? (
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Update the core trigger details directly in place.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={resetEditingState}>
                  Cancel
                </Button>
                <PermissionButton
                  permissions={{ agentTrigger: ["update"] }}
                  size="sm"
                  onClick={() => {
                    void submitForm();
                  }}
                  disabled={isSaving || formPayload === null}
                >
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save changes
                </PermissionButton>
              </>
            ) : (
              <>
                <PermissionButton
                  permissions={{ agentTrigger: ["update"] }}
                  variant="default"
                  size="sm"
                  onClick={() => {
                    void handleRunNow();
                  }}
                  disabled={runNowState.isButtonSpinning}
                >
                  {runNowState.isButtonSpinning ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Run now
                </PermissionButton>
                <PermissionButton
                  permissions={{ agentTrigger: ["update"] }}
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit schedule
                </PermissionButton>
                <PermissionButton
                  permissions={{ agentTrigger: ["update"] }}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    trigger.enabled
                      ? disableMutation.mutate(trigger.id)
                      : enableMutation.mutate(trigger.id)
                  }
                >
                  {trigger.enabled ? (
                    <>
                      <PowerOff className="mr-2 h-4 w-4" />
                      Disable
                    </>
                  ) : (
                    <>
                      <Power className="mr-2 h-4 w-4" />
                      Enable
                    </>
                  )}
                </PermissionButton>
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    href={getDocsUrl(DocsPage.PlatformAgentTriggersSchedule)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Docs
                  </Link>
                </Button>
                <PermissionButton
                  permissions={{ agentTrigger: ["delete"] }}
                  variant="ghost"
                  size="sm"
                  className="text-destructive/80 hover:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete
                </PermissionButton>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="px-4 py-4 lg:border-r">
            <SectionHeading
              title="Prompt"
              description="The instruction replayed on every scheduled run."
            />
            {editing ? (
              <div className="rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Textarea
                  value={formState.messageTemplate}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      messageTemplate: event.target.value,
                    }))
                  }
                  className="min-h-48 resize-y border-0 bg-transparent px-4 py-3 text-sm leading-6 shadow-none focus-visible:ring-0"
                />
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {trigger.messageTemplate}
              </p>
            )}
            {trigger.lastError && (
              <Alert className="mt-4 border-0 bg-destructive/10">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Last run failed</AlertTitle>
                <AlertDescription>{trigger.lastError}</AlertDescription>
              </Alert>
            )}
          </div>

          <div className="border-t px-4 py-4 lg:border-t-0">
            <SectionHeading
              title="Configuration"
              description="Core schedule settings and execution context."
            />
            {editing ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <EditableMetaField label="Target agent">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <SearchableSelect
                          value={formState.agentId}
                          onValueChange={(agentId) =>
                            setFormState((current) => ({ ...current, agentId }))
                          }
                          items={agentOptions}
                          placeholder="Select agent"
                          searchPlaceholder="Search agents..."
                          disabled={agentsLoading || agentOptions.length === 0}
                          className="h-9"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">Target Agent</TooltipContent>
                  </Tooltip>
                </EditableMetaField>
                <EditableMetaField label="Schedule (Cron)">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <CronExpressionPicker
                          value={formState.cronExpression}
                          onChange={(cronExpression) =>
                            setFormState((current) => ({
                              ...current,
                              cronExpression,
                            }))
                          }
                          presets={SCHEDULE_PRESET_OPTIONS}
                          customPlaceholder="0 9 * * 1-5"
                          descriptionFallback=""
                          className="[&_[data-slot=select-trigger]]:h-9 [&_input]:h-9"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">Schedule (Cron)</TooltipContent>
                  </Tooltip>
                </EditableMetaField>
                <EditableMetaField label="Timezone">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <SearchableSelect
                          value={formState.timezone}
                          onValueChange={(timezone) =>
                            setFormState((current) => ({
                              ...current,
                              timezone,
                            }))
                          }
                          items={timezoneOptions}
                          placeholder="UTC"
                          searchPlaceholder="Search timezones"
                          className="h-9"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">Timezone</TooltipContent>
                  </Tooltip>
                </EditableMetaField>
                <EditableMetaField label="Trigger name">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        value={formState.name}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder={effectiveName}
                        className="h-9"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">Trigger Name</TooltipContent>
                  </Tooltip>
                </EditableMetaField>
                <InlineMeta
                  label="Next due"
                  value={formatTimestampWithRelative(
                    trigger.nextDueAt,
                    "Not scheduled",
                  )}
                />
                <InlineMeta
                  label="Execution actor"
                  value={
                    trigger.actor?.name ||
                    trigger.actor?.email ||
                    trigger.actorUserId
                  }
                />
                <InlineMeta
                  label="Last completed"
                  value={formatTimestampWithRelative(trigger.lastRunAt)}
                />
                <InlineMeta
                  label="Trigger mode"
                  value="Persisted cron schedule"
                />
                <InlineMeta
                  label="Permissions"
                  value="Runs with the trigger creator's agent access"
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <InlineMeta
                  label="Target agent"
                  value={trigger.agent?.name ?? trigger.agentId}
                />
                <InlineMeta
                  label="Schedule (Cron)"
                  value={formatCronSchedule(trigger.cronExpression)}
                />
                <InlineMeta label="Timezone" value={trigger.timezone} />
                <InlineMeta
                  label="Next due"
                  value={formatTimestampWithRelative(
                    trigger.nextDueAt,
                    "Not scheduled",
                  )}
                />
                <InlineMeta
                  label="Execution actor"
                  value={
                    trigger.actor?.name ||
                    trigger.actor?.email ||
                    trigger.actorUserId
                  }
                />
                <InlineMeta
                  label="Last completed"
                  value={formatTimestampWithRelative(trigger.lastRunAt)}
                />
                <InlineMeta
                  label="Trigger mode"
                  value="Persisted cron schedule"
                />
                <InlineMeta
                  label="Permissions"
                  value="Runs with the trigger creator's agent access"
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete scheduled trigger"
        description={`Delete "${trigger.name}"? This action cannot be undone.`}
        isPending={deleteMutation.isPending}
        onConfirm={handleDelete}
        confirmLabel="Delete trigger"
        pendingLabel="Deleting..."
      />

      <ScheduleTriggerRunsTable
        trigger={trigger}
        trackedRunId={trackedRunId}
        activeMutationTriggerId={getActiveMutationVariable(runNowMutation)}
        onTrackedRunSettled={(runId) => {
          if (trackedRunId === runId) {
            setTrackedRunId(null);
          }
        }}
      />
    </div>
  );
}

function WorkspaceHeader({
  totalCount,
  enabledCount,
  hasAgents,
  onCreate,
}: {
  totalCount: number;
  enabledCount: number;
  hasAgents: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Scheduled triggers
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground/70">
            Compose schedules, inspect recent runs, and jump straight into the
            trigger that needs attention.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge
            variant="outline"
            className="border-border/60 bg-muted/30 px-2.5 py-1 text-foreground/80"
          >
            {enabledCount} enabled
          </Badge>
          <Badge
            variant="outline"
            className="border-border/60 bg-muted/20 px-2.5 py-1 text-muted-foreground/80"
          >
            {totalCount} total
          </Badge>
          <span className="ml-1 text-sm text-muted-foreground/60">
            Open any trigger for run history, output, and control actions.
          </span>
          <Link
            href={getDocsUrl(DocsPage.PlatformAgentTriggersSchedule)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            Docs
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <ScheduleTriggerCreateButton hasAgents={hasAgents} onClick={onCreate}>
        New schedule
      </ScheduleTriggerCreateButton>
    </section>
  );
}

function QuietPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {title}
      </p>
      <div className="rounded-[28px] bg-muted/20 p-6">{children}</div>
    </section>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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

function FilterToolbar({
  statusFilter,
  agentFilter,
  nextRunFilter,
  agentOptions,
  onStatusFilterChange,
  onAgentFilterChange,
  onNextRunFilterChange,
  onReset,
}: {
  statusFilter: "all" | "enabled" | "disabled";
  agentFilter: string;
  nextRunFilter: "all" | "today" | "later" | "none";
  agentOptions: AgentOption[];
  onStatusFilterChange: (value: "all" | "enabled" | "disabled") => void;
  onAgentFilterChange: (value: string) => void;
  onNextRunFilterChange: (value: "all" | "today" | "later" | "none") => void;
  onReset: () => void;
}) {
  const hasActiveFilters =
    statusFilter !== "all" || agentFilter !== "all" || nextRunFilter !== "all";

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <QuietSelectField label="Status">
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-[150px] border-transparent bg-muted/30 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="enabled">Enabled</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </QuietSelectField>

        <QuietSelectField label="Agent">
          <SearchableSelect
            value={agentFilter}
            onValueChange={onAgentFilterChange}
            items={[
              { value: "all", label: "All agents", description: "No filter" },
              ...agentOptions,
            ]}
            placeholder="All agents"
            searchPlaceholder="Search agents..."
            className="w-[240px] border-transparent bg-muted/30"
          />
        </QuietSelectField>

        <QuietSelectField label="Next run">
          <Select value={nextRunFilter} onValueChange={onNextRunFilterChange}>
            <SelectTrigger className="w-[170px] border-transparent bg-muted/30 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any time</SelectItem>
              <SelectItem value="today">Within 24h</SelectItem>
              <SelectItem value="later">After 24h</SelectItem>
              <SelectItem value="none">No next run</SelectItem>
            </SelectContent>
          </Select>
        </QuietSelectField>
      </div>

      {hasActiveFilters && (
        <Button variant="ghost" onClick={onReset} className="self-start">
          Clear filters
        </Button>
      )}
    </div>
  );
}

function QuietSelectField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ScheduleTriggerFormFields({
  formState,
  effectiveName,
  agentOptions,
  timezoneOptions,
  agentsLoading,
  hasAgents,
  isSaving,
  isFormValid,
  isEditing,
  chrome = "standalone",
  onCancel,
  onSubmit,
  onNameChange,
  onAgentChange,
  onCronExpressionChange,
  onTimezoneChange,
  onMessageTemplateChange,
}: {
  formState: ScheduleTriggerFormState;
  effectiveName: string;
  agentOptions: AgentOption[];
  timezoneOptions: AgentOption[];
  agentsLoading: boolean;
  hasAgents: boolean;
  isSaving: boolean;
  isFormValid: boolean;
  isEditing: boolean;
  chrome?: "standalone" | "embedded";
  onCancel?: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onCronExpressionChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onMessageTemplateChange: (value: string) => void;
}) {
  const isCreateMode = !isEditing;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className={cn(
        "focus-within:ring-1 focus-within:ring-ring",
        chrome === "standalone"
          ? "rounded-xl border bg-background shadow-sm"
          : "rounded-none border-0 bg-transparent shadow-none",
      )}
    >
      <div className="relative">
        <Textarea
          id="schedule-trigger-message"
          value={formState.messageTemplate}
          onChange={(event) => onMessageTemplateChange(event.target.value)}
          placeholder={
            isCreateMode
              ? "What should happen? (e.g. Review yesterday's failures and send a short summary)"
              : "Prompt"
          }
          className="min-h-[80px] resize-y border-0 bg-transparent px-4 py-3 text-sm shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="flex flex-col gap-3 border-t bg-muted/10 px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-start gap-2 flex-1">
            <div className="w-[180px]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <SearchableSelect
                      value={formState.agentId}
                      onValueChange={onAgentChange}
                      items={agentOptions}
                      placeholder="Select agent"
                      searchPlaceholder="Search agents..."
                      disabled={agentsLoading || !hasAgents}
                      className="h-9 w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">Target Agent</TooltipContent>
              </Tooltip>
            </div>

            <div className="w-[200px] [&_[data-slot=select-trigger]]:h-9 [&_input]:h-9">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <CronExpressionPicker
                      value={formState.cronExpression}
                      onChange={onCronExpressionChange}
                      presets={SCHEDULE_PRESET_OPTIONS}
                      customPlaceholder="0 9 * * 1-5"
                      descriptionFallback=""
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">Schedule (Cron)</TooltipContent>
              </Tooltip>
            </div>

            <div className="w-[160px]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    id="schedule-trigger-name"
                    value={formState.name}
                    onChange={(event) => onNameChange(event.target.value)}
                    placeholder={effectiveName}
                    className="h-9 w-full"
                  />
                </TooltipTrigger>
                <TooltipContent side="top">Trigger Name</TooltipContent>
              </Tooltip>
            </div>

            <div className="w-[160px]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <SearchableSelect
                      value={formState.timezone}
                      onValueChange={onTimezoneChange}
                      items={timezoneOptions}
                      placeholder="UTC"
                      searchPlaceholder="Search timezones"
                      className="h-9 w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">Timezone</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-start gap-2 pt-0.5 shrink-0">
            {onCancel && isEditing && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={onCancel}
              >
                Cancel
              </Button>
            )}
            <PermissionButton
              permissions={{
                agentTrigger: [isEditing ? "update" : "create"],
              }}
              type="submit"
              size="sm"
              disabled={isSaving || !isFormValid}
            >
              {isSaving && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              )}
              {isEditing ? "Save changes" : "Create schedule"}
            </PermissionButton>
          </div>
        </div>
      </div>
    </form>
  );
}

function ScheduleTriggerRunsTable({
  trigger,
  trackedRunId,
  activeMutationTriggerId,
  onTrackedRunSettled,
}: {
  trigger: ScheduleTrigger;
  trackedRunId: string | null;
  activeMutationTriggerId: string | null;
  onTrackedRunSettled: (runId: string) => void;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: runsResponse, isLoading: runsLoading } = useScheduleTriggerRuns(
    trigger.id,
    {
      limit: 20,
      offset: 0,
      enabled: true,
      refetchInterval: trackedRunId ? 3_000 : false,
    },
  );

  const trackedRun =
    trackedRunId === null
      ? null
      : (runsResponse?.data.find((run) => run.id === trackedRunId) ?? null);
  const runNowState = getRunNowTrackingState({
    activeMutationTriggerId,
    currentTriggerId: trigger.id,
    trackedRunId,
    trackedRunStatus: trackedRun?.status,
  });

  useEffect(() => {
    if (!runNowState.shouldClearTrackedRun || !trackedRunId) {
      return;
    }

    onTrackedRunSettled(trackedRunId);
  }, [onTrackedRunSettled, runNowState.shouldClearTrackedRun, trackedRunId]);

  const columns = useMemo<ColumnDef<ScheduleTriggerRun>[]>(
    () => [
      {
        id: "run",
        header: "Run",
        cell: ({ row }) => (
          <div className="space-y-1 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                label={row.original.status}
                tone={statusToneMap[row.original.status]}
              />
              <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground/60">
                {row.original.runKind}
              </span>
            </div>
            <p className="text-sm text-muted-foreground/70">
              {row.original.error
                ? truncateText(row.original.error, 120)
                : "Open to inspect prompt snapshot and output."}
            </p>
          </div>
        ),
      },
      {
        id: "queued",
        header: "Queued",
        cell: ({ row }) => <TimestampCell value={row.original.createdAt} />,
      },
      {
        id: "completed",
        header: "Completed",
        cell: ({ row }) => (
          <TimestampCell
            value={row.original.completedAt}
            emptyLabel="In progress"
          />
        ),
      },
    ],
    [],
  );

  const selectedRun =
    selectedRunId === null
      ? null
      : (runsResponse?.data.find((run) => run.id === selectedRunId) ?? null);

  return (
    <>
      <section className="space-y-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">Run history</h2>
            <p className="text-sm text-muted-foreground/70">
              The primary surface for this trigger. Open a row to inspect the
              captured output.
            </p>
          </div>
          {runNowState.isButtonSpinning && (
            <span className="text-xs text-muted-foreground/60">
              Refreshing active run
            </span>
          )}
        </div>

        <DataTable
          columns={columns}
          data={runsResponse?.data ?? []}
          isLoading={runsLoading}
          emptyMessage="No runs recorded yet."
          onRowClick={(run) => setSelectedRunId(run.id)}
          hideSelectedCount
          hidePaginationWhenSinglePage
        />
      </section>

      <RunDetailDialog
        run={selectedRun}
        open={selectedRunId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRunId(null);
          }
        }}
      />
    </>
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
            Review the queued prompt, latest status, and captured output for
            this execution.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6">
          {!run ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading run details...
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <InlineMeta label="Status" value={run.status} />
                <InlineMeta label="Kind" value={run.runKind} />
                <InlineMeta
                  label="Queued"
                  value={formatTimestampWithRelative(run.createdAt)}
                />
                <InlineMeta
                  label="Completed"
                  value={formatTimestampWithRelative(
                    run.completedAt,
                    "In progress",
                  )}
                />
              </div>

              <QuietPanel title="Prompt snapshot">
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {run.messageTemplateSnapshot}
                </p>
              </QuietPanel>

              <QuietPanel title="Output">
                <div className="mb-3">
                  <Link
                    href={`/llm/logs/session/${encodeURIComponent(getScheduleTriggerRunSessionId(run.id))}`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-foreground"
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
                  <p className="text-sm text-muted-foreground/70">
                    This run is still in progress. Output will appear here when
                    execution finishes.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/70">
                    No output was captured for this run.
                  </p>
                )}
              </QuietPanel>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InlineMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}
      </p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

function EditableMetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}
      </p>
      {children}
    </div>
  );
}

function TimestampCell({
  value,
  emptyLabel = "Not yet",
}: {
  value: string | null;
  emptyLabel?: string;
}) {
  if (!value) {
    return (
      <span className="text-sm text-muted-foreground/70">{emptyLabel}</span>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-sm text-foreground">{formatTimestamp(value)}</p>
      <p className="text-xs text-muted-foreground/60">
        {formatRelativeTimeFromNow(value, { neverLabel: emptyLabel })}
      </p>
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
      ? "bg-emerald-500/10 text-emerald-300"
      : tone === "danger"
        ? "bg-destructive/10 text-destructive"
        : tone === "warning"
          ? "bg-amber-500/10 text-amber-300"
          : tone === "running"
            ? "bg-sky-500/10 text-sky-300"
            : "bg-muted text-muted-foreground";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] ${toneClassName}`}
    >
      {label}
    </span>
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

function sortScheduleTriggers(triggers: ScheduleTrigger[]) {
  return [...triggers].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    const leftDate = left.nextDueAt ?? left.updatedAt;
    const rightDate = right.nextDueAt ?? right.updatedAt;
    return rightDate.localeCompare(leftDate);
  });
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not yet";
  }

  return new Date(value).toLocaleString();
}

function formatTimestampWithRelative(
  value: string | null,
  emptyLabel = "Not yet",
): string {
  if (!value) {
    return emptyLabel;
  }

  return `${formatTimestamp(value)} (${formatRelativeTimeFromNow(value, {
    neverLabel: emptyLabel,
  })})`;
}

function matchesNextRunFilter(
  nextDueAt: string | null,
  filter: "all" | "today" | "later" | "none",
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "none") {
    return nextDueAt === null;
  }

  if (!nextDueAt) {
    return false;
  }

  const nextRunTime = new Date(nextDueAt).getTime();
  if (Number.isNaN(nextRunTime)) {
    return false;
  }

  const now = Date.now();
  const within24Hours = nextRunTime - now <= 24 * 60 * 60 * 1000;

  if (filter === "today") {
    return nextRunTime >= now && within24Hours;
  }

  return nextRunTime - now > 24 * 60 * 60 * 1000;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
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

  const openAiText = candidateResponse.choices
    ?.flatMap((choice) => {
      const content = choice.message?.content;
      if (typeof content === "string") {
        return [content];
      }

      return (content ?? [])
        .map((part) => part.text?.trim() || part.refusal?.trim())
        .filter(Boolean);
    })
    .join("\n")
    .trim();
  if (openAiText) {
    return openAiText;
  }

  const anthropicText = candidateResponse.content
    ?.map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (anthropicText) {
    return anthropicText;
  }

  return null;
}
