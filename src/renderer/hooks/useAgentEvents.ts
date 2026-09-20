import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgUiEvent, AgentPlanItem, WorkspaceAttachment } from '@/shared/types';
import { formatRunErrorForUser } from '../../agent/run-errors';
import { sendAgentRequestSafely } from './agent-send';
import {
  appendStreamPlaceholder,
  appendTextDelta,
  attachToolArtifacts,
  endToolCall,
  finalizeStream,
  findLastPersistedAssistant,
  markThinking,
  removeMessageById,
  startToolCall,
  streamIdForRun,
  stopStream,
  toUiMessages,
  type UiMessage,
} from './agent-messages';

export type { UiMessage } from './agent-messages';

export interface AssistantReplyFinishedPayload {
  id: string;
  content: string;
  sessionId: string;
}

export interface AssistantMessagePersistedPayload {
  streamId: string;
  persistedId: string;
  sessionId: string;
}

export function useAgentEvents(
  sessionId: string | null,
  onSessionNeeded?: () => Promise<string>,
  options?: {
    onRunFinished?: () => void;
    onRunStarted?: () => void;
    onRunStopped?: () => void;
    onAssistantReplyFinished?: (message: AssistantReplyFinishedPayload) => void;
    onAssistantMessagePersisted?: (message: AssistantMessagePersistedPayload) => void;
  },
) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentPlan, setAgentPlan] = useState<AgentPlanItem[]>([]);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const runSessionIdRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const streamRunsRef = useRef(new Map<string, { sessionId: string; content: string }>());
  const loadGenerationRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 消息列表的唯一写入口。刻意不用 setState 的 updater 形式：
  // StrictMode 会双调用 updater，而运行结束那条分支需要在拿到新列表后发 IPC，
  // 放在 updater 里会发两次。这里 ref 先落值再 setState，handler 永远读得到最新列表，
  // 也不在渲染期回写 ref（React 批处理时会把 ref 退回旧值）。
  const messagesRef = useRef<UiMessage[]>(messages);
  const applyMessages = useCallback((next: UiMessage[] | ((prev: UiMessage[]) => UiMessage[])) => {
    const value = typeof next === 'function' ? next(messagesRef.current) : next;
    messagesRef.current = value;
    setMessages(value);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      applyMessages([]);
      setIsRunning(false);
      return;
    }

    setIsRunning(false);
    setError(null);
    applyMessages([]);
    loadGenerationRef.current += 1;
    setLoadingMessages(true);
    window.shorekeeper.messages
      .list(sessionId)
      .then((list) => {
        if (sessionIdRef.current !== sessionId) return;
        applyMessages(toUiMessages(list));
      })
      .catch(console.error)
      .finally(() => {
        if (sessionIdRef.current === sessionId) {
          setLoadingMessages(false);
        }
      });
  }, [sessionId, applyMessages]);

  useEffect(() => {
    currentRunIdRef.current = null;
    runSessionIdRef.current = null;
    streamRunsRef.current.clear();

    const unsubscribe = window.shorekeeper.agent.onEvent((raw) => {
      const event = raw as AgUiEvent;
      const activeSessionId = sessionIdRef.current;
      const options = optionsRef.current;

      if (event.type === 'run_finished') {
        const runId = event.runId;
        setAgentPlan([]);
        const streamId = streamIdForRun(runId);
        const streamEntry = streamRunsRef.current.get(runId);
        const finishedSessionId = runSessionIdRef.current ?? streamEntry?.sessionId ?? null;
        streamRunsRef.current.delete(runId);
        const content = streamEntry?.content ?? '';
        const hasContent = Boolean(content.trim());

        setIsRunning(false);
        currentRunIdRef.current = null;
        runSessionIdRef.current = null;
        options?.onRunFinished?.();

        const finalized = finalizeStream(messagesRef.current, streamId, content);
        applyMessages(finalized.messages);

        if (finishedSessionId && finishedSessionId === sessionIdRef.current) {
          const generation = loadGenerationRef.current;
          window.shorekeeper.messages.list(finishedSessionId).then((list) => {
            if (sessionIdRef.current !== finishedSessionId || loadGenerationRef.current !== generation) {
              return;
            }
            const dbMessages = attachToolArtifacts(toUiMessages(list), finalized);

            if (dbMessages.length > 0 || (!hasContent && !finalized.hasToolCalls)) {
              applyMessages(dbMessages);
            }

            if (optionsRef.current?.onAssistantMessagePersisted) {
              const persisted = findLastPersistedAssistant(dbMessages);
              if (persisted) {
                optionsRef.current.onAssistantMessagePersisted({
                  streamId,
                  persistedId: persisted.id,
                  sessionId: finishedSessionId,
                });
              }
            }
          });
        }

        if (finishedSessionId && finishedSessionId === sessionIdRef.current && hasContent) {
          optionsRef.current?.onAssistantReplyFinished?.({
            id: streamId,
            content,
            sessionId: finishedSessionId,
          });
        }
        return;
      }

      if (event.type === 'run_started') {
        if (event.sessionId !== activeSessionId) return;
        setAgentPlan([]);
        options?.onRunStarted?.();
        runSessionIdRef.current = event.sessionId;
        currentRunIdRef.current = event.runId;
        streamRunsRef.current.set(event.runId, { sessionId: event.sessionId, content: '' });
        setIsRunning(true);
        setError(null);
        applyMessages((prev) => appendStreamPlaceholder(prev, streamIdForRun(event.runId), Date.now()));
        return;
      }

      const currentRunId = currentRunIdRef.current;
      if (!currentRunId || runSessionIdRef.current !== activeSessionId) return;
      const streamId = streamIdForRun(currentRunId);

      if (event.type === 'reasoning_delta') {
        applyMessages((prev) => markThinking(prev, streamId));
      }

      if (event.type === 'text_delta') {
        let entry = streamRunsRef.current.get(event.runId);
        if (!entry && activeSessionId) {
          entry = { sessionId: activeSessionId, content: '' };
          streamRunsRef.current.set(event.runId, entry);
        }
        if (entry) {
          entry.content += event.delta;
        }
        applyMessages((prev) => appendTextDelta(prev, streamId, event.delta));
      }

      if (event.type === 'tool_call_start') {
        applyMessages((prev) =>
          startToolCall(prev, streamId, { callId: event.callId, name: event.name, args: event.args }),
        );
      }

      if (event.type === 'tool_call_end') {
        applyMessages((prev) => endToolCall(prev, streamId, { callId: event.callId, result: event.result }));
      }

      if (event.type === 'plan_updated') {
        if (currentRunIdRef.current !== event.runId) return;
        setAgentPlan(event.items);
        return;
      }

      if (event.type === 'run_error') {
        if (event.runId !== currentRunIdRef.current) return;
        setAgentPlan([]);
        streamRunsRef.current.delete(event.runId);
        if (runSessionIdRef.current !== activeSessionId) {
          if (event.sessionId && event.sessionId === activeSessionId && !runSessionIdRef.current) {
            setIsRunning(false);
            currentRunIdRef.current = null;
            setError(formatRunErrorForUser(event.message, event.runId));
            applyMessages(stopStream(messagesRef.current, streamIdForRun(event.runId), Boolean(event.reason)));
          }
          return;
        }
        options?.onRunStopped?.();
        setIsRunning(false);
        currentRunIdRef.current = null;
        runSessionIdRef.current = null;
        setError(formatRunErrorForUser(event.message, event.runId));
        applyMessages(stopStream(messagesRef.current, streamIdForRun(event.runId), Boolean(event.reason)));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [sessionId, applyMessages]);

  const send = async (text: string, attachments: WorkspaceAttachment[] = []) => {
    const trimmed = text.trim();
    if ((!trimmed && !attachments.length) || isRunning) return;

    let activeSessionId = sessionId;
    if (!activeSessionId && onSessionNeeded) {
      activeSessionId = await onSessionNeeded();
    }
    if (!activeSessionId) return;
    sessionIdRef.current = activeSessionId;

    const displayContent =
      attachments.length > 0 && trimmed
        ? trimmed
        : attachments.length > 0
          ? ''
          : trimmed;

    const userMsg: UiMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: displayContent,
      attachments: attachments.length ? attachments : undefined,
      createdAt: Date.now(),
    };
    applyMessages((prev) => [...prev, userMsg]);
    setError(null);

    const result = await sendAgentRequestSafely(
      () => window.shorekeeper.agent.send({
        sessionId: activeSessionId,
        message: trimmed,
        attachments,
      }),
      (message) => {
        // IPC 自身失败时主进程没有机会持久化消息；撤回乐观消息，避免界面伪装成已发送。
        applyMessages((prev) => removeMessageById(prev, userMsg.id));
        setError(formatRunErrorForUser(message));
        setIsRunning(false);
      },
    );
    if (!result) return;

    if (!result.ok && result.error) {
      setError(formatRunErrorForUser(result.error, result.runId ?? undefined));
      setIsRunning(false);
    }
  };

  return { messages, loadingMessages, isRunning, error, agentPlan, send };
}
