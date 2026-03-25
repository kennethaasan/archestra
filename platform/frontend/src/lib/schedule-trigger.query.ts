import type { ApiError, PaginationMeta } from "@shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { handleApiError } from "./utils";

export type ScheduleTriggerRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed";

export type ScheduleTriggerRunKind = "due" | "manual";

export type ScheduleTrigger = {
  id: string;
  organizationId: string;
  name: string;
  agentId: string;
  messageTemplate: string;
  scheduleKind: "cron";
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  actorUserId: string;
  nextDueAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: ScheduleTriggerRunStatus | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  actor?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  agent?: {
    id: string;
    name: string | null;
    agentType: string | null;
  } | null;
};

export type ScheduleTriggerRun = {
  id: string;
  organizationId: string;
  triggerId: string;
  runKind: ScheduleTriggerRunKind;
  status: ScheduleTriggerRunStatus;
  dueAt: string | null;
  initiatedByUserId: string | null;
  agentIdSnapshot: string;
  messageTemplateSnapshot: string;
  actorUserIdSnapshot: string;
  timezoneSnapshot: string;
  cronExpressionSnapshot: string;
  chatConversationId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type PaginatedResponse<T> = {
  data: T[];
  pagination: PaginationMeta;
};

type ScheduleTriggerRequestBody = {
  name: string;
  agentId: string;
  cronExpression: string;
  timezone: string;
  messageTemplate: string;
  enabled?: boolean;
};

export const scheduleTriggerKeys = {
  all: ["schedule-triggers"] as const,
  detail: (triggerId: string) =>
    [...scheduleTriggerKeys.all, "detail", triggerId] as const,
  list: (params: { enabled?: boolean; limit?: number; offset?: number }) =>
    [...scheduleTriggerKeys.all, "list", params] as const,
  runsPrefix: (triggerId: string) =>
    [...scheduleTriggerKeys.all, triggerId, "runs"] as const,
  runs: (triggerId: string, params: { limit?: number; offset?: number }) =>
    [...scheduleTriggerKeys.runsPrefix(triggerId), params] as const,
  run: (triggerId: string, runId: string) =>
    [...scheduleTriggerKeys.runsPrefix(triggerId), "detail", runId] as const,
  status: () => [...scheduleTriggerKeys.all, "status"] as const,
};

export function getScheduleTriggerListQueryParams(params?: {
  enabled?: boolean;
  limit?: number;
  offset?: number;
  refetchInterval?: number | false;
}) {
  return {
    enabled: params?.enabled,
    limit: params?.limit,
    offset: params?.offset,
  };
}

export function getScheduleTriggerRunsQueryParams(params?: {
  limit?: number;
  offset?: number;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  return {
    limit: params?.limit,
    offset: params?.offset,
  };
}

export function useScheduleTriggers(params?: {
  enabled?: boolean;
  limit?: number;
  offset?: number;
  refetchInterval?: number | false;
}) {
  const queryParams = getScheduleTriggerListQueryParams(params);
  const query = new URLSearchParams();
  query.set("limit", String(queryParams.limit ?? 50));
  query.set("offset", String(queryParams.offset ?? 0));
  if (queryParams.enabled !== undefined) {
    query.set("enabled", String(queryParams.enabled));
  }

  return useQuery({
    queryKey: scheduleTriggerKeys.list(queryParams),
    queryFn: async () =>
      await scheduleTriggerRequest<PaginatedResponse<ScheduleTrigger>>(
        `/api/schedule-triggers?${query.toString()}`,
      ),
    ...(params?.refetchInterval
      ? { refetchInterval: params.refetchInterval }
      : {}),
  });
}

export function useScheduleTrigger(
  triggerId: string | null,
  params?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  },
) {
  return useQuery({
    queryKey: scheduleTriggerKeys.detail(triggerId ?? ""),
    queryFn: async () =>
      await scheduleTriggerRequest<ScheduleTrigger>(
        `/api/schedule-triggers/${triggerId}`,
      ),
    enabled: !!triggerId && (params?.enabled ?? true),
    ...(params?.refetchInterval
      ? { refetchInterval: params.refetchInterval }
      : {}),
  });
}

export function useScheduleTriggerRuns(
  triggerId: string | null,
  params?: {
    limit?: number;
    offset?: number;
    enabled?: boolean;
    refetchInterval?: number | false;
  },
) {
  const queryParams = getScheduleTriggerRunsQueryParams(params);
  const query = new URLSearchParams();
  query.set("limit", String(queryParams.limit ?? 10));
  query.set("offset", String(queryParams.offset ?? 0));

  return useQuery({
    queryKey: scheduleTriggerKeys.runs(triggerId ?? "", queryParams),
    queryFn: async () =>
      await scheduleTriggerRequest<PaginatedResponse<ScheduleTriggerRun>>(
        `/api/schedule-triggers/${triggerId}/runs?${query.toString()}`,
      ),
    enabled: !!triggerId && (params?.enabled ?? true),
    ...(params?.refetchInterval
      ? { refetchInterval: params.refetchInterval }
      : {}),
  });
}

export function useHasActiveScheduleTriggers() {
  return useQuery({
    queryKey: scheduleTriggerKeys.status(),
    queryFn: async () => {
      const response = await scheduleTriggerRequest<
        PaginatedResponse<ScheduleTrigger>
      >("/api/schedule-triggers?enabled=true&limit=1&offset=0");
      return (response?.data.length ?? 0) > 0;
    },
  });
}

export function useScheduleTriggerRun(
  triggerId: string | null,
  runId: string | null,
  params?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  },
) {
  return useQuery({
    queryKey: scheduleTriggerKeys.run(triggerId ?? "", runId ?? ""),
    queryFn: async () =>
      await scheduleTriggerRequest<ScheduleTriggerRun>(
        `/api/schedule-triggers/${triggerId}/runs/${runId}`,
      ),
    enabled: !!triggerId && !!runId && (params?.enabled ?? true),
    ...(params?.refetchInterval
      ? { refetchInterval: params.refetchInterval }
      : {}),
  });
}

export function useCreateScheduleTriggerRunConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      triggerId,
      runId,
    }: {
      triggerId: string;
      runId: string;
    }) => {
      const conversation = await scheduleTriggerRequest<{ id: string }>(
        `/api/schedule-triggers/${triggerId}/runs/${runId}/conversation`,
        {
          method: "POST",
        },
      );
      if (!conversation) {
        throw new Error("Failed to create a conversation for this run");
      }
      return conversation;
    },
    onSuccess: (conversation, variables) => {
      queryClient.invalidateQueries({
        queryKey: scheduleTriggerKeys.run(variables.triggerId, variables.runId),
      });
      queryClient.invalidateQueries({
        queryKey: scheduleTriggerKeys.runsPrefix(variables.triggerId),
      });
      queryClient.invalidateQueries({
        queryKey: ["conversation", conversation.id],
      });
    },
  });
}

export function useCreateScheduleTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: ScheduleTriggerRequestBody) =>
      await scheduleTriggerRequest<ScheduleTrigger>("/api/schedule-triggers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      if (!data) return;
      toast.success("Schedule trigger created");
      queryClient.invalidateQueries({ queryKey: scheduleTriggerKeys.all });
    },
  });
}

export function useUpdateScheduleTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: Partial<ScheduleTriggerRequestBody>;
    }) =>
      await scheduleTriggerRequest<ScheduleTrigger>(
        `/api/schedule-triggers/${id}`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    onSuccess: (data) => {
      if (!data) return;
      toast.success("Schedule trigger updated");
      queryClient.invalidateQueries({ queryKey: scheduleTriggerKeys.all });
    },
  });
}

export function useDeleteScheduleTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) =>
      await scheduleTriggerRequest<{ success: boolean }>(
        `/api/schedule-triggers/${id}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: (data) => {
      if (!data?.success) return;
      toast.success("Schedule trigger deleted");
      queryClient.invalidateQueries({ queryKey: scheduleTriggerKeys.all });
    },
  });
}

export function useEnableScheduleTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) =>
      await scheduleTriggerRequest<ScheduleTrigger>(
        `/api/schedule-triggers/${id}/enable`,
        {
          method: "POST",
        },
      ),
    onSuccess: (data) => {
      if (!data) return;
      toast.success("Schedule trigger enabled");
      queryClient.invalidateQueries({ queryKey: scheduleTriggerKeys.all });
    },
  });
}

export function useDisableScheduleTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) =>
      await scheduleTriggerRequest<ScheduleTrigger>(
        `/api/schedule-triggers/${id}/disable`,
        {
          method: "POST",
        },
      ),
    onSuccess: (data) => {
      if (!data) return;
      toast.success("Schedule trigger disabled");
      queryClient.invalidateQueries({ queryKey: scheduleTriggerKeys.all });
    },
  });
}

export function useRunScheduleTriggerNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) =>
      await scheduleTriggerRequest<ScheduleTriggerRun>(
        `/api/schedule-triggers/${id}/run-now`,
        {
          method: "POST",
        },
      ),
    onSuccess: (data) => {
      if (!data) return;
      toast.success("Run queued");
      queryClient.invalidateQueries({ queryKey: scheduleTriggerKeys.all });
      queryClient.invalidateQueries({
        queryKey: scheduleTriggerKeys.runsPrefix(data.triggerId),
      });
    },
  });
}

async function scheduleTriggerRequest<T>(
  input: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const response = await fetch(input, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const payload = (await readJson(response)) as ErrorPayload | T;

    if (!response.ok) {
      handleApiError({
        error: extractApiError(payload) ?? new Error(response.statusText),
      });
      return null;
    }

    return payload as T;
  } catch (error) {
    handleApiError({
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}

type ErrorPayload = {
  error?: Partial<ApiError>;
};

function extractApiError(payload: unknown): Partial<ApiError> | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }

  return (payload as ErrorPayload).error;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
