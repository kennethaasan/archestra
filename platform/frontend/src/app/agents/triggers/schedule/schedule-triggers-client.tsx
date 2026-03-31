"use client";

import { DocsPage, getDocsUrl } from "@shared";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Clock3,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  CronExpressionPicker,
  type CronPresetOption,
} from "@/components/ui/cron-expression-picker";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { PermissionButton } from "@/components/ui/permission-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProfiles } from "@/lib/agent.query";
import { useHasPermissions } from "@/lib/auth/auth.query";
import { useGenerateConversationTitle } from "@/lib/chat/chat.query";
import {
  type ScheduleTrigger,
  type ScheduleTriggerOverlapPolicy,
  type ScheduleTriggerRun,
  type ScheduleTriggerRunStatus,
  useCreateScheduleTrigger,
  useCreateScheduleTriggerRunConversation,
  useDeleteScheduleTrigger,
  useDisableScheduleTrigger,
  useEnableScheduleTrigger,
  useRunScheduleTriggerNow,
  useScheduleTrigger,
  useScheduleTriggerRuns,
  useScheduleTriggers,
  useUpdateScheduleTrigger,
} from "@/lib/schedule-trigger.query";
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

const SCHEDULE_COMPOSER_PRESETS: Array<{
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  values: Pick<ScheduleTriggerFormState, "cronExpression" | "messageTemplate">;
}> = [
  {
    id: "daily-summary",
    title: "Generate a morning summary",
    description: "Weekdays at 09:00",
    icon: FileText,
    values: {
      cronExpression: "0 9 * * 1-5",
      messageTemplate:
        "Review the last 24 hours of activity, highlight anything blocked or unusual, and send a concise morning summary with recommended next steps.",
    },
  },
  {
    id: "daily-check",
    title: "Check key systems daily",
    description: "Every day at 09:00",
    icon: Bot,
    values: {
      cronExpression: "0 9 * * *",
      messageTemplate:
        "Inspect the latest runs, errors, and pending work across the configured systems. Summarize anything that needs follow-up and call out urgent failures first.",
    },
  },
  {
    id: "weekly-plan",
    title: "Prepare a weekly plan",
    description: "Every Monday at 09:00",
    icon: Clock3,
    values: {
      cronExpression: "0 9 * * 1",
      messageTemplate:
        "Create a plan for the week based on the latest activity, unresolved issues, and recent outputs. Keep it structured, short, and action-oriented.",
    },
  },
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
  const ensureRunConversationMutation =
    useCreateScheduleTriggerRunConversation();
  const generateConversationTitleMutation = useGenerateConversationTitle();

  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<ScheduleTrigger | null>(
    null,
  );
  const [showPresetRail, setShowPresetRail] = useState(true);
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
    setShowPresetRail(true);
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
      overlapPolicy: trigger.overlapPolicy ?? "skip",
      maxConsecutiveFailures: trigger.maxConsecutiveFailures ?? 5,
    });
  }, []);

  const closeComposer = () => {
    setEditingTrigger(null);
    setCreateFormOpen(false);
    setFormState(DEFAULT_FORM_STATE());
  };

  const applyComposerPreset = (
    preset: (typeof SCHEDULE_COMPOSER_PRESETS)[number],
  ) => {
    setFormState((current) => ({
      ...current,
      cronExpression: preset.values.cronExpression,
      messageTemplate: preset.values.messageTemplate,
      agentId: current.agentId || preferredAgentId,
    }));
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

  const openRunFollowUp = useCallback(
    async (triggerId: string) => {
      const run = await runNowMutation.mutateAsync(triggerId);
      if (!run) {
        return;
      }

      try {
        const conversation = await ensureRunConversationMutation.mutateAsync({
          triggerId: run.triggerId,
          runId: run.id,
        });

        void generateConversationTitleMutation
          .mutateAsync({
            id: conversation.id,
            regenerate: true,
          })
          .catch(() => {});

        router.push(
          `/chat?conversation=${conversation.id}&scheduleTriggerId=${run.triggerId}&scheduleRunId=${run.id}`,
        );
      } catch {
        router.push(
          `/agents/triggers/schedule/${run.triggerId}/runs/${run.id}`,
        );
      }
    },
    [
      ensureRunConversationMutation,
      generateConversationTitleMutation,
      router,
      runNowMutation,
    ],
  );

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
                        void openRunFollowUp(trigger.id);
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
    [deleteMutation, openEditComposer, openRunFollowUp, runNowMutation],
  );

  return (
    <div className="mr-auto flex w-full max-w-[1080px] flex-col gap-5">
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
        <div ref={composerRef} className="space-y-3">
          {editingTrigger === null && showPresetRail && (
            <ScheduleComposerPresetRail
              presets={SCHEDULE_COMPOSER_PRESETS}
              onDismiss={() => setShowPresetRail(false)}
              onSelectPreset={applyComposerPreset}
            />
          )}

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
        </div>
      )}

      <section className="space-y-3">
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

        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/95">
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
        </div>
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
  const { data: canUpdateTrigger = false } = useHasPermissions({
    agentTrigger: ["update"],
  });
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
  const ensureRunConversationMutation =
    useCreateScheduleTriggerRunConversation();
  const generateConversationTitleMutation = useGenerateConversationTitle();

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
      overlapPolicy: trigger.overlapPolicy ?? "skip",
      maxConsecutiveFailures: trigger.maxConsecutiveFailures ?? 5,
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
  const isTogglePending = enableMutation.isPending || disableMutation.isPending;
  const toggleScheduleEnabled = (enabled: boolean) => {
    if (!trigger || !canUpdateTrigger) {
      return;
    }

    if (enabled) {
      enableMutation.mutate(trigger.id);
      return;
    }

    disableMutation.mutate(trigger.id);
  };

  const handleRunNow = async () => {
    const run = await runNowMutation.mutateAsync(triggerId);
    if (!run) {
      return;
    }

    setTrackedRunId(run.id);

    try {
      const conversation = await ensureRunConversationMutation.mutateAsync({
        triggerId: run.triggerId,
        runId: run.id,
      });

      void generateConversationTitleMutation
        .mutateAsync({
          id: conversation.id,
          regenerate: true,
        })
        .catch(() => {});

      router.push(
        `/chat?conversation=${conversation.id}&scheduleTriggerId=${run.triggerId}&scheduleRunId=${run.id}`,
      );
    } catch {
      router.push(`/agents/triggers/schedule/${run.triggerId}/runs/${run.id}`);
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
      overlapPolicy: trigger.overlapPolicy ?? "skip",
      maxConsecutiveFailures: trigger.maxConsecutiveFailures ?? 5,
    });
    setEditing(false);
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
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
    <div className="mr-auto flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="h-8 -ml-2 px-2 text-muted-foreground"
          >
            <Link href="/agents/triggers/schedule">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Schedules
            </Link>
          </Button>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
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
            <p className="text-sm text-muted-foreground">
              {formatCronSchedule(trigger.cronExpression)} &middot;{" "}
              {trigger.agent?.name ?? trigger.agentId} &middot;{" "}
              {trigger.timezone}
            </p>
          </div>
        </div>

        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
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
              Edit
            </PermissionButton>
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
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitForm();
              }}
              className="flex flex-col gap-6"
            >
              <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Textarea
                  id="schedule-trigger-message"
                  value={formState.messageTemplate}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      messageTemplate: event.target.value,
                    }))
                  }
                  placeholder="Ask the scheduled agent to do something on every run..."
                  className="min-h-[120px] resize-y border-0 bg-transparent dark:bg-transparent px-5 py-4 text-sm shadow-none focus-visible:ring-0"
                />
              </section>

              <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
                <div className="divide-y divide-border/60">
                  <SettingsPanelRow
                    label="Name"
                    description="Display name for this trigger"
                    control={
                      <Input
                        id="schedule-trigger-name"
                        value={formState.name}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder={effectiveName}
                        className="h-9 w-[240px]"
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Agent"
                    description="The agent that runs on each execution"
                    control={
                      <SearchableSelect
                        value={formState.agentId}
                        onValueChange={(agentId) =>
                          setFormState((current) => ({ ...current, agentId }))
                        }
                        items={agentOptions}
                        placeholder="Select agent"
                        searchPlaceholder="Search agents..."
                        disabled={agentsLoading}
                        className="h-9 w-[240px]"
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Schedule"
                    description="How often this trigger fires"
                    control={
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
                        className="h-9 w-[240px]"
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Timezone"
                    description="All schedule times use this timezone"
                    control={
                      <SearchableSelect
                        value={formState.timezone}
                        onValueChange={(timezone) =>
                          setFormState((current) => ({ ...current, timezone }))
                        }
                        items={timezoneOptions}
                        placeholder="UTC"
                        searchPlaceholder="Search timezones"
                        className="h-9 w-[240px]"
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Overlap policy"
                    description="What to do when a previous run is still active"
                    control={
                      <Select
                        value={formState.overlapPolicy}
                        onValueChange={(value: ScheduleTriggerOverlapPolicy) =>
                          setFormState((current) => ({
                            ...current,
                            overlapPolicy: value,
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 w-[240px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="allow_all">
                            Allow all (no limit)
                          </SelectItem>
                          <SelectItem value="skip">
                            Skip (wait for current)
                          </SelectItem>
                          <SelectItem value="buffer_one">
                            Buffer one (queue at most 1)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsPanelRow
                    label="Auto-pause threshold"
                    description="Disable after this many consecutive failures"
                    control={
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={formState.maxConsecutiveFailures}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            maxConsecutiveFailures:
                              Number.parseInt(event.target.value, 10) || 5,
                          }))
                        }
                        className="h-9 w-[240px]"
                      />
                    }
                  />
                </div>
              </section>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={resetEditingState}
                >
                  Cancel
                </Button>
                <PermissionButton
                  permissions={{ agentTrigger: ["update"] }}
                  type="submit"
                  size="sm"
                  disabled={isSaving || !formPayload}
                >
                  {isSaving && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  )}
                  Save changes
                </PermissionButton>
              </div>
            </form>
          ) : (
            <>
              <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
                <div className="px-5 py-4">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
                    {trigger.messageTemplate}
                  </p>
                </div>
              </section>

              {trigger.lastError && (
                <Alert className="border-0 bg-destructive/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Last run failed</AlertTitle>
                  <AlertDescription>{trigger.lastError}</AlertDescription>
                </Alert>
              )}

              {!trigger.enabled &&
                trigger.consecutiveFailures >=
                  trigger.maxConsecutiveFailures && (
                  <Alert className="border-0 bg-amber-500/10">
                    <AlertCircle className="h-4 w-4 text-amber-400" />
                    <AlertTitle>Auto-paused due to failures</AlertTitle>
                    <AlertDescription>
                      This trigger was automatically disabled after{" "}
                      {trigger.consecutiveFailures} consecutive failures
                      (threshold: {trigger.maxConsecutiveFailures}). Re-enable
                      to resume scheduled runs. The failure counter will reset
                      on re-enable.
                    </AlertDescription>
                  </Alert>
                )}

              <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
                <div className="divide-y divide-border/60">
                  <SettingsPanelRow
                    label="Name"
                    description="Display name for this trigger"
                    control={<ReadonlySettingValue value={trigger.name} />}
                  />
                  <SettingsPanelRow
                    label="Agent"
                    description="The agent that runs on each execution"
                    control={
                      <ReadonlySettingValue
                        value={trigger.agent?.name ?? trigger.agentId}
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Schedule"
                    description="How often this trigger fires"
                    control={
                      <ReadonlySettingValue
                        value={formatCronSchedule(trigger.cronExpression)}
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Timezone"
                    description="All schedule times use this timezone"
                    control={<ReadonlySettingValue value={trigger.timezone} />}
                  />
                  <SettingsPanelRow
                    label="Enabled"
                    description="Pause or resume scheduled runs"
                    control={
                      <Switch
                        checked={trigger.enabled}
                        onCheckedChange={toggleScheduleEnabled}
                        disabled={isTogglePending || !canUpdateTrigger}
                        aria-label="Toggle schedule enabled"
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Overlap policy"
                    description="What to do when a previous run is still active"
                    control={
                      <ReadonlySettingValue
                        value={formatOverlapPolicy(trigger.overlapPolicy)}
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Auto-pause threshold"
                    description="Disable after this many consecutive failures"
                    control={
                      <ReadonlySettingValue
                        value={String(trigger.maxConsecutiveFailures)}
                      />
                    }
                  />
                  <SettingsPanelRow
                    label="Next due"
                    description="When the next run is scheduled"
                    control={
                      <span className="text-sm text-foreground">
                        {formatTimestampWithRelative(
                          trigger.nextDueAt,
                          "Not scheduled",
                        )}
                      </span>
                    }
                  />
                  <SettingsPanelRow
                    label="Last run"
                    description="Most recent execution result"
                    control={
                      <div className="flex items-center gap-2">
                        {trigger.lastRunStatus && (
                          <StatusBadge
                            label={trigger.lastRunStatus}
                            tone={statusToneMap[trigger.lastRunStatus]}
                          />
                        )}
                        <span className="text-sm text-muted-foreground">
                          {trigger.lastRunAt
                            ? formatRelativeTimeFromNow(trigger.lastRunAt)
                            : "No runs yet"}
                        </span>
                      </div>
                    }
                  />
                  <SettingsPanelRow
                    label="Created by"
                    description="Who originally created this trigger"
                    control={
                      <span className="text-sm text-foreground">
                        {trigger.actor?.name ||
                          trigger.actor?.email ||
                          trigger.actorUserId}
                      </span>
                    }
                  />
                </div>
              </section>
            </>
          )}
        </div>

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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Scheduled triggers
          </h2>
          {totalCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {enabledCount} of {totalCount} active
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Run an agent on a cadence. Manual runs open in chat for follow-up.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link
            href={getDocsUrl(DocsPage.PlatformAgentTriggersSchedule)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Docs
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
        <ScheduleTriggerCreateButton hasAgents={hasAgents} onClick={onCreate}>
          New schedule
        </ScheduleTriggerCreateButton>
      </div>
    </div>
  );
}

function ScheduleComposerPresetRail({
  presets,
  onDismiss,
  onSelectPreset,
}: {
  presets: typeof SCHEDULE_COMPOSER_PRESETS;
  onDismiss: () => void;
  onSelectPreset: (preset: (typeof SCHEDULE_COMPOSER_PRESETS)[number]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Start from a template, or write your own below.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground/70"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Hide presets</span>
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {presets.map((preset) => {
          const Icon = preset.icon;

          return (
            <button
              type="button"
              key={preset.id}
              onClick={() => onSelectPreset(preset)}
              className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent/10"
            >
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground transition-colors group-hover:text-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {preset.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {preset.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ComposerToolbarField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}
      </p>
      {children}
    </div>
  );
}

function SettingsPanelRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ReadonlySettingValue({ value }: { value: string }) {
  return <span className="text-sm text-foreground">{value}</span>;
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

function formatOverlapPolicy(
  policy: ScheduleTriggerOverlapPolicy | undefined,
): string {
  switch (policy) {
    case "skip":
      return "Skip (wait for current)";
    case "buffer_one":
      return "Buffer one (queue at most 1)";
    default:
      return "Allow all (no limit)";
  }
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
        <ComposerToolbarField label="Status">
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
        </ComposerToolbarField>

        <ComposerToolbarField label="Agent">
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
        </ComposerToolbarField>

        <ComposerToolbarField label="Next run">
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
        </ComposerToolbarField>
      </div>

      {hasActiveFilters && (
        <Button variant="ghost" onClick={onReset} className="self-start">
          Clear filters
        </Button>
      )}
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
  onCancel?: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onCronExpressionChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onMessageTemplateChange: (value: string) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="rounded-xl border border-border/60 bg-card shadow-sm focus-within:ring-1 focus-within:ring-ring"
    >
      <div className="relative">
        <Textarea
          id="schedule-trigger-message"
          value={formState.messageTemplate}
          onChange={(event) => onMessageTemplateChange(event.target.value)}
          placeholder="Ask the scheduled agent to do something on every run..."
          className="min-h-[80px] resize-y border-0 bg-transparent dark:bg-transparent px-4 py-3 text-sm shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="flex flex-col gap-3 px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-start gap-2">
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

            <div className="w-[200px]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <CronExpressionPicker
                      value={formState.cronExpression}
                      onChange={onCronExpressionChange}
                      presets={SCHEDULE_PRESET_OPTIONS}
                      customPlaceholder="0 9 * * 1-5"
                      className="h-9 w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">Schedule (Cron)</TooltipContent>
              </Tooltip>
            </div>

            {isEditing && (
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
            )}

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

          <div className="flex shrink-0 items-start gap-2 pt-0.5">
            {onCancel && (
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
  const router = useRouter();
  const pageSize = 10;
  const [pageIndex, setPageIndex] = useState(0);
  const [statusFilter, setStatusFilter] = useState<
    ScheduleTriggerRunStatus | "all"
  >("all");

  const { data: runsResponse, isLoading: runsLoading } = useScheduleTriggerRuns(
    trigger.id,
    {
      limit: pageSize,
      offset: pageIndex * pageSize,
      status: statusFilter === "all" ? undefined : statusFilter,
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

  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value as ScheduleTriggerRunStatus | "all");
    setPageIndex(0);
  }, []);

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

  const hasActiveFilters = statusFilter !== "all";

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">Run history</h2>
          <p className="text-sm text-muted-foreground/70">
            The primary surface for this trigger. Open a row to continue in
            chat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {runNowState.isButtonSpinning && (
            <span className="text-xs text-muted-foreground/60">
              Refreshing active run
            </span>
          )}
          <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
            <SelectTrigger className="h-8 w-[130px] border-transparent bg-muted/30 text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={runsResponse?.data ?? []}
        isLoading={runsLoading}
        emptyMessage="No runs recorded yet."
        manualPagination
        pagination={{
          pageIndex,
          pageSize,
          total: runsResponse?.pagination.total ?? 0,
        }}
        onPaginationChange={(p) => setPageIndex(p.pageIndex)}
        hasActiveFilters={hasActiveFilters}
        filteredEmptyMessage="No runs match the selected status."
        onClearFilters={() => {
          setStatusFilter("all");
          setPageIndex(0);
        }}
        onRowClick={(run) => {
          if (run.chatConversationId) {
            router.push(
              `/chat?conversation=${run.chatConversationId}&scheduleTriggerId=${trigger.id}&scheduleRunId=${run.id}`,
            );
          } else {
            router.push(
              `/agents/triggers/schedule/${trigger.id}/runs/${run.id}`,
            );
          }
        }}
        hideSelectedCount
        hidePaginationWhenSinglePage
      />
    </section>
  );
}
