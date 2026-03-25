"use client";

import type { UIMessage } from "@ai-sdk/react";
import type { SupportedProvider } from "@shared";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
} from "lucide-react";
import type { ChatStatus } from "ai";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { ChatMessages } from "@/components/chat/chat-messages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInternalAgents } from "@/lib/agent.query";
import {
  useConversation,
  useStopChatStream,
  useUpdateConversation,
} from "@/lib/chat/chat.query";
import { useChatSession } from "@/lib/chat/global-chat.context";
import {
  useChatModels,
  useModelsByProvider,
} from "@/lib/chat/chat-models.query";
import { useOrganization } from "@/lib/organization.query";
import {
  useCreateScheduleTriggerRunConversation,
  useScheduleTrigger,
  useScheduleTriggerRun,
} from "@/lib/schedule-trigger.query";
import { cn } from "@/lib/utils";
import { formatRelativeTimeFromNow } from "@/lib/utils/date-time";
import ArchestraPromptInput from "@/app/chat/prompt-input";
import {
  getScheduleTriggerRunSessionId,
  isScheduleTriggerRunActive,
} from "./schedule-trigger.utils";

type ScheduleTriggerRunPageProps = {
  triggerId: string;
  runId: string;
};

function areConversationMessagesSynced(
  localMessages: UIMessage[],
  backendMessages: UIMessage[],
) {
  if (localMessages.length !== backendMessages.length) {
    return false;
  }

  return localMessages.every((localMessage, index) => {
    const backendMessage = backendMessages[index];
    return (
      backendMessage &&
      localMessage.id === backendMessage.id &&
      localMessage.role === backendMessage.role &&
      JSON.stringify(localMessage.parts) === JSON.stringify(backendMessage.parts)
    );
  });
}

export function ScheduleTriggerRunPage({
  triggerId,
  runId,
}: ScheduleTriggerRunPageProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const loadedConversationRef = useRef<string | undefined>(undefined);
  const bootstrapRequestedRef = useRef(false);
  const recoveryAttemptedRef = useRef(false);
  const wasRunActiveRef = useRef(false);
  const [bootstrappedConversationId, setBootstrappedConversationId] =
    useState<string | null>(null);
  const [conversationBootstrapError, setConversationBootstrapError] =
    useState<string | null>(null);

  const { data: trigger, isLoading: triggerLoading } = useScheduleTrigger(
    triggerId,
    {
      enabled: !!triggerId,
      refetchInterval: 5_000,
    },
  );
  const { data: run, isLoading: runLoading } = useScheduleTriggerRun(
    triggerId,
    runId,
    {
      enabled: !!triggerId && !!runId,
      refetchInterval: 3_000,
    },
  );
  const ensureConversationMutation = useCreateScheduleTriggerRunConversation();
  const conversationId =
    run?.chatConversationId ?? bootstrappedConversationId ?? undefined;
  const { data: conversation, isLoading: conversationLoading } =
    useConversation(conversationId);
  const chatSession = useChatSession(conversationId);

  const isRunActive = isScheduleTriggerRunActive(run?.status);

  const { data: chatModels = [] } = useChatModels();
  const { modelsByProvider } = useModelsByProvider();
  const { data: organization } = useOrganization();
  const { data: internalAgents = [] } = useInternalAgents({
    enabled: !!conversation?.agentId,
  });

  const updateConversationMutation = useUpdateConversation();
  const stopChatStreamMutation = useStopChatStream();

  const messages = chatSession?.messages ?? [];
  const status = chatSession?.status ?? ("ready" as ChatStatus);
  const error = chatSession?.error;
  const sendMessage = chatSession?.sendMessage;
  const stop = chatSession?.stop;
  const setMessages = chatSession?.setMessages;
  const optimisticToolCalls = chatSession?.optimisticToolCalls ?? [];
  const addToolApprovalResponse = chatSession?.addToolApprovalResponse;
  const tokenUsage = chatSession?.tokenUsage;
  const tokensUsed = tokenUsage?.totalTokens;

  const currentProvider = useMemo((): SupportedProvider | undefined => {
    if (!conversation?.selectedModel) return undefined;
    const model = chatModels.find((item) => item.id === conversation.selectedModel);
    return model?.provider;
  }, [conversation?.selectedModel, chatModels]);

  const selectedModelContextLength = useMemo((): number | null => {
    if (!conversation?.selectedModel) return null;
    const model = chatModels.find((item) => item.id === conversation.selectedModel);
    return model?.capabilities?.contextLength ?? null;
  }, [conversation?.selectedModel, chatModels]);

  const selectedModelInputModalities = useMemo(() => {
    if (!conversation?.selectedModel) return null;
    const model = chatModels.find((item) => item.id === conversation.selectedModel);
    return model?.capabilities?.inputModalities ?? null;
  }, [conversation?.selectedModel, chatModels]);

  useEffect(() => {
    if (!run?.chatConversationId) {
      return;
    }

    setBootstrappedConversationId(run.chatConversationId);
    setConversationBootstrapError(null);
  }, [run?.chatConversationId]);

  const ensureConversation = useCallback(async () => {
    bootstrapRequestedRef.current = true;
    setConversationBootstrapError(null);

    try {
      const createdConversation = await ensureConversationMutation.mutateAsync({
        triggerId,
        runId,
      });
      setBootstrappedConversationId(createdConversation.id);
    } catch {
      setConversationBootstrapError(
        "Unable to prepare a chat conversation for this run.",
      );
    }
  }, [ensureConversationMutation, runId, triggerId]);

  useEffect(() => {
    if (
      !run ||
      ensureConversationMutation.isPending ||
      bootstrapRequestedRef.current
    ) {
      return;
    }

    void ensureConversation();
  }, [ensureConversation, ensureConversationMutation.isPending, run]);

  useEffect(() => {
    const wasRunActive = wasRunActiveRef.current;
    wasRunActiveRef.current = isRunActive;

    if (!run || isRunActive || !wasRunActive) {
      return;
    }

    void ensureConversation();
  }, [ensureConversation, isRunActive, run]);

  useEffect(() => {
    if (
      !conversationId ||
      conversationLoading ||
      conversation !== null ||
      recoveryAttemptedRef.current ||
      ensureConversationMutation.isPending
    ) {
      return;
    }

    recoveryAttemptedRef.current = true;
    void ensureConversation();
  }, [
    conversation,
    conversationId,
    conversationLoading,
    ensureConversation,
    ensureConversationMutation.isPending,
  ]);

  useEffect(() => {
    if (!setMessages || !conversationId || !conversation?.messages) {
      return;
    }

    if (loadedConversationRef.current !== conversationId) {
      loadedConversationRef.current = undefined;
    }

    const backendMessages = conversation.messages as UIMessage[];
    const shouldSync =
      conversation.id === conversationId &&
      status !== "submitted" &&
      status !== "streaming" &&
      backendMessages.length >= messages.length &&
      (loadedConversationRef.current !== conversationId ||
        messages.length === 0 ||
        !areConversationMessagesSynced(messages, backendMessages));

    if (shouldSync) {
      setMessages(backendMessages);
      loadedConversationRef.current = conversationId;
    }
  }, [conversation, conversationId, messages, setMessages, status]);

  useLayoutEffect(() => {
    if (status === "ready" && conversation?.id && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [conversation?.id, status]);

  useEffect(() => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const handleModelChange = useCallback(
    (modelId: string) => {
      if (!conversation) return;

      const provider = chatModels.find((item) => item.id === modelId)?.provider;
      updateConversationMutation.mutate({
        id: conversation.id,
        selectedModel: modelId,
        selectedProvider: provider,
      });
    },
    [chatModels, conversation, updateConversationMutation],
  );

  const handleProviderChange = useCallback(
    (provider: SupportedProvider, chatApiKeyId: string) => {
      if (!conversation) return;

      const providerModels = modelsByProvider[provider];
      const bestModel = providerModels?.find((item) => item.isBest) ?? providerModels?.[0];

      updateConversationMutation.mutate({
        id: conversation.id,
        chatApiKeyId,
        selectedModel: bestModel?.id,
        selectedProvider: bestModel ? provider : undefined,
      });
    },
    [conversation, modelsByProvider, updateConversationMutation],
  );

  const handleSubmit = useCallback(
    (
      message: {
        text?: string;
        files?: Array<{ url: string; mediaType: string; filename?: string }>;
      },
      event: FormEvent<HTMLFormElement>,
    ) => {
      event.preventDefault();

      if (isRunActive) {
        return;
      }

      if (status === "submitted" || status === "streaming") {
        if (conversationId) {
          stopChatStreamMutation.mutateAsync(conversationId).finally(() => {
            stop?.();
          });
        } else {
          stop?.();
        }
        return;
      }

      const hasText = message.text?.trim();
      const hasFiles = message.files && message.files.length > 0;

      if (!sendMessage || (!hasText && !hasFiles)) {
        return;
      }

      if (setMessages) {
        const hasPendingApprovals = messages.some((chatMessage) =>
          chatMessage.parts.some(
            (part) => "state" in part && part.state === "approval-requested",
          ),
        );

        if (hasPendingApprovals) {
          setMessages(
            messages.map((chatMessage) => ({
              ...chatMessage,
              parts: chatMessage.parts.map((part) =>
                "state" in part && part.state === "approval-requested"
                  ? {
                      ...part,
                      state: "output-denied" as const,
                      output:
                        "Tool approval was skipped because the user sent a new message",
                    }
                  : part,
              ),
            })) as UIMessage[],
          );
        }
      }

      const parts: Array<
        | { type: "text"; text: string }
        | { type: "file"; url: string; mediaType: string; filename?: string }
      > = [];

      if (hasText) {
        parts.push({ type: "text", text: message.text as string });
      }

      if (hasFiles) {
        for (const file of message.files ?? []) {
          parts.push({
            type: "file",
            url: file.url,
            mediaType: file.mediaType,
            filename: file.filename,
          });
        }
      }

      sendMessage({
        role: "user",
        parts,
      });
    },
    [
      conversationId,
      messages,
      sendMessage,
      setMessages,
      status,
      stop,
      stopChatStreamMutation,
      isRunActive,
    ],
  );

  const isLoadingPage = triggerLoading || runLoading;
  const activeAgentId = conversation?.agentId ?? run?.agentIdSnapshot;
  const activeAgentName =
    conversation?.agent?.name ??
    internalAgents.find((agent) => agent.id === activeAgentId)?.name ??
    trigger?.agent?.name ??
    "Scheduled agent";

  if (isLoadingPage) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading scheduled run...
      </div>
    );
  }

  if (!trigger || !run) {
    return (
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 rounded-xl border bg-background p-6 shadow-sm">
        <p className="text-sm font-medium text-foreground">Run not found</p>
        <p className="text-sm text-muted-foreground">
          The scheduled trigger or run could not be loaded.
        </p>
        <div>
          <Button variant="outline" asChild>
            <Link href="/agents/triggers/schedule">Back to schedules</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-auto flex w-full max-w-[1480px] flex-col gap-6">
      <section className="overflow-hidden rounded-xl border bg-background shadow-sm">
        <div className="flex flex-col gap-4 border-b px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Button variant="ghost" size="sm" asChild className="h-8 px-2">
                <Link href={`/agents/triggers/schedule/${trigger.id}`}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back to schedule
                </Link>
              </Button>
              <span className="hidden sm:inline">Scheduled run</span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {trigger.name}
                </h1>
                <StatusBadge label={run.status} />
                <Badge
                  variant="outline"
                  className="border-border/60 bg-muted/20 px-2.5 py-1 text-muted-foreground"
                >
                  {run.runKind}
                </Badge>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Review the queued prompt and run details, then continue the
                conversation with the same agent below.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link
                href={`/llm/logs/session/${encodeURIComponent(getScheduleTriggerRunSessionId(run.id))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Session logs
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6 px-4 py-4 lg:border-r">
            <RunPanel
              title="Prompt snapshot"
              description="The exact instruction used when this run was queued."
            >
              <div className="rounded-xl border bg-background px-4 py-3 shadow-sm">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {run.messageTemplateSnapshot}
                </p>
              </div>
            </RunPanel>
          </div>

          <div className="space-y-4 px-4 py-4">
            <RunPanel
              title="Run metadata"
              description="Compact execution details for the selected run."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <InlineMeta label="Target agent" value={activeAgentName} />
                <InlineMeta label="Timezone" value={run.timezoneSnapshot} />
                <InlineMeta
                  label="Schedule (Cron)"
                  value={run.cronExpressionSnapshot}
                />
                <InlineMeta
                  label="Queued"
                  value={formatTimestampWithRelative(run.createdAt)}
                />
                <InlineMeta
                  label="Started"
                  value={formatTimestampWithRelative(run.startedAt, "Not started")}
                />
                <InlineMeta
                  label="Completed"
                  value={formatTimestampWithRelative(run.completedAt, "In progress")}
                />
              </div>
            </RunPanel>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-background shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Chat thread</p>
            <p className="text-sm text-muted-foreground">
              Continue with {activeAgentName}.
            </p>
          </div>
          {((!conversationId && ensureConversationMutation.isPending) ||
            (!conversationBootstrapError &&
              !!conversationId &&
              conversationLoading)) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Preparing conversation
            </div>
          )}
        </div>

        <div className="flex min-h-[65vh] flex-col">
          {conversationId ? (
            <>
              <div className="flex-1 min-h-0 px-2 md:px-4">
                <ChatMessages
                  conversationId={conversationId}
                  agentId={activeAgentId}
                  messages={messages}
                  status={status}
                  optimisticToolCalls={optimisticToolCalls}
                  isLoadingConversation={conversationLoading}
                  onMessagesUpdate={setMessages}
                  error={error}
                  agentName={activeAgentName}
                  selectedModel={conversation?.selectedModel ?? ""}
                  onToolApprovalResponse={
                    addToolApprovalResponse
                      ? ({ id, approved, reason }) => {
                          addToolApprovalResponse({ id, approved, reason });
                        }
                      : undefined
                  }
                />
              </div>

              {activeAgentId && conversation ? (
                <div className="sticky bottom-0 border-t bg-background p-4">
                  <div className="mx-auto w-full max-w-4xl">
                    {isRunActive ? (
                      <div className="rounded-xl border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Waiting for the scheduled run to finish
                        </div>
                        <p className="mt-2 leading-6 text-muted-foreground">
                          Chat stays read-only until the original run completes.
                          When the run finishes, this page will sync the final
                          output and enable the prompt automatically.
                        </p>
                      </div>
                    ) : ensureConversationMutation.isPending ? (
                      <div className="rounded-xl border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Finalizing the chat thread
                        </div>
                        <p className="mt-2 leading-6 text-muted-foreground">
                          Syncing the completed run output into the chat thread.
                        </p>
                      </div>
                    ) : (
                      <ArchestraPromptInput
                        onSubmit={handleSubmit}
                        status={status}
                        selectedModel={conversation.selectedModel ?? ""}
                        onModelChange={handleModelChange}
                        agentId={activeAgentId}
                        conversationId={conversationId}
                        currentConversationChatApiKeyId={conversation.chatApiKeyId}
                        currentProvider={currentProvider}
                        textareaRef={textareaRef}
                        onProviderChange={handleProviderChange}
                        allowFileUploads={organization?.allowChatFileUploads ?? false}
                        tokensUsed={tokensUsed}
                        maxContextLength={selectedModelContextLength}
                        inputModalities={selectedModelInputModalities}
                        agentLlmApiKeyId={conversation.agent?.llmApiKeyId ?? null}
                        submitDisabled={false}
                        isPlaywrightSetupVisible={false}
                      />
                    )}
                  </div>
                </div>
              ) : null}
            </>
          ) : conversationBootstrapError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {conversationBootstrapError}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  bootstrapRequestedRef.current = false;
                  recoveryAttemptedRef.current = false;
                  setBootstrappedConversationId(null);
                  void ensureConversation();
                }}
                disabled={ensureConversationMutation.isPending}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating a conversation from this run...
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function RunPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
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

function StatusBadge({ label }: { label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-border/60 px-2.5 py-1 capitalize",
        label === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
        label === "failed" && "border-destructive/30 bg-destructive/10 text-destructive",
        (label === "pending" || label === "running") &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700",
      )}
    >
      {label}
    </Badge>
  );
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTimestampWithRelative(
  value: string | null | undefined,
  emptyLabel = "Never",
): string {
  if (!value) {
    return emptyLabel;
  }

  return `${formatTimestamp(value)} (${formatRelativeTimeFromNow(value, {
    neverLabel: emptyLabel,
  })})`;
}
