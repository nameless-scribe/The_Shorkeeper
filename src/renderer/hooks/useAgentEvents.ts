import { useEffect, useRef, useState } from 'react';
import type { AgUiEvent, WorkspaceAttachment } from '@/shared/types';
import type { UiToolCall } from '../components/ToolCallCard';
import { extractFilesFromToolCall, mergeAttachments } from '../components/file-attachment-utils';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  thinking?: boolean;
  toolCalls?: UiToolCall[];
  attachments?: WorkspaceAttachment[];
  /** 本轮工具涉及的工作区文件（用于可点击打开） */
  relatedFiles?: WorkspaceAttachment[];
  createdAt?: number;
}

export function useAgentEvents(
  sessionId: string | null,
  onSessionNeeded?: () => Promise<string>,
  options?: { onRunFinished?: () => void },
) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const runSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setIsRunning(false);
      return;
    }

    setIsRunning(false);
    setError(null);
    setMessages([]);
    setLoadingMessages(true);
    window.shorekeeper.messages
      .list(sessionId)
      .then((list) => {
        if (sessionIdRef.current !== sessionId) return;
        setMessages(
          list
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              createdAt: m.createdAt,
            })),
        );
      })
      .catch(console.error)
      .finally(() => {
        if (sessionIdRef.current === sessionId) {
          setLoadingMessages(false);
        }
      });
  }, [sessionId]);

  useEffect(() => {
    let currentRunId: string | null = null;

    const unsubscribe = window.shorekeeper.agent.onEvent((raw) => {
      const event = raw as AgUiEvent;
      const activeSessionId = sessionIdRef.current;

      if (event.type === 'run_started') {
        if (event.sessionId !== activeSessionId) return;
        runSessionIdRef.current = event.sessionId;
        currentRunId = event.runId;
        const streamId = `stream-${event.runId}`;
        setIsRunning(true);
        setError(null);
        setMessages((prev) => [
          ...prev,
          {
            id: streamId,
            role: 'assistant',
            content: '',
            streaming: true,
            thinking: true,
            createdAt: Date.now(),
          },
        ]);
        return;
      }

      if (!currentRunId || runSessionIdRef.current !== activeSessionId) return;
      const streamId = `stream-${currentRunId}`;

      if (event.type === 'reasoning_delta') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId ? { ...m, thinking: true, streaming: true } : m,
          ),
        );
      }

      if (event.type === 'text_delta') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId
              ? {
                  ...m,
                  content: m.content + event.delta,
                  thinking: false,
                  streaming: true,
                }
              : m,
          ),
        );
      }

      if (event.type === 'tool_call_start') {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== streamId) return m;
            const existing = m.toolCalls ?? [];
            if (existing.some((tc) => tc.callId === event.callId)) {
              return m;
            }
            return {
              ...m,
              thinking: false,
              streaming: true,
              toolCalls: [
                ...existing,
                {
                  callId: event.callId,
                  name: event.name,
                  args: event.args,
                  status: 'running' as const,
                },
              ],
            };
          }),
        );
      }

      if (event.type === 'tool_call_end') {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== streamId) return m;
            const toolCalls = (m.toolCalls ?? []).map((tc) =>
              tc.callId === event.callId
                ? {
                    ...tc,
                    status: event.result.success
                      ? ('done' as const)
                      : ('error' as const),
                    result: event.result,
                  }
                : tc,
            );
            const ended = toolCalls.find((tc) => tc.callId === event.callId);
            const relatedFiles = ended
              ? mergeAttachments(m.relatedFiles, extractFilesFromToolCall(ended))
              : m.relatedFiles;
            return { ...m, toolCalls, relatedFiles };
          }),
        );
      }

      if (event.type === 'run_finished') {
        const finishedSessionId = runSessionIdRef.current;
        setIsRunning(false);
        currentRunId = null;
        runSessionIdRef.current = null;
        options?.onRunFinished?.();
        setMessages((prev) => {
          const streamMsg = prev.find((m) => m.id === streamId);
          const toolCalls = streamMsg?.toolCalls;
          const relatedFiles = streamMsg?.relatedFiles;
          const hasToolCalls = Boolean(toolCalls?.length);
          const hasContent = Boolean(streamMsg?.content.trim());

          const withoutEmpty = prev
            .map((m) =>
              m.id === streamId
                ? { ...m, streaming: false, thinking: false }
                : m,
            )
            .filter(
              (m) =>
                !(m.id === streamId && !m.content.trim() && !hasToolCalls),
            );

          if (
            finishedSessionId &&
            finishedSessionId === sessionIdRef.current
          ) {
            window.shorekeeper.messages.list(finishedSessionId).then((list) => {
              if (sessionIdRef.current !== finishedSessionId) return;
              const dbMessages: UiMessage[] = list
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .map((m) => ({
                  id: m.id,
                  role: m.role as 'user' | 'assistant',
                  content: m.content,
                  createdAt: m.createdAt,
                }));

              if (toolCalls?.length || relatedFiles?.length) {
                for (let i = dbMessages.length - 1; i >= 0; i -= 1) {
                  if (dbMessages[i].role === 'assistant') {
                    dbMessages[i] = {
                      ...dbMessages[i],
                      ...(toolCalls?.length ? { toolCalls } : {}),
                      ...(relatedFiles?.length ? { relatedFiles } : {}),
                    };
                    break;
                  }
                }
              }

              if (dbMessages.length > 0 || (!hasContent && !hasToolCalls)) {
                setMessages(dbMessages);
              }
            });
          }

          return withoutEmpty;
        });
      }

      if (event.type === 'run_error') {
        if (runSessionIdRef.current !== activeSessionId) return;
        setIsRunning(false);
        currentRunId = null;
        runSessionIdRef.current = null;
        setError(event.message);
        setMessages((prev) => prev.filter((m) => !m.streaming));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [options?.onRunFinished]);

  const send = async (text: string, attachments: WorkspaceAttachment[] = []) => {
    const trimmed = text.trim();
    if ((!trimmed && !attachments.length) || isRunning) return;

    let activeSessionId = sessionId;
    if (!activeSessionId && onSessionNeeded) {
      activeSessionId = await onSessionNeeded();
    }
    if (!activeSessionId) return;

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
    setMessages((prev) => [...prev, userMsg]);
    setError(null);

    await window.shorekeeper.agent.send({
      sessionId: activeSessionId,
      message: trimmed,
      attachments,
    });
  };

  return { messages, loadingMessages, isRunning, error, send };
}
