import { useEffect, useState } from 'react';
import type { AgUiEvent } from '@/shared/types';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  thinking?: boolean;
  createdAt?: number;
}

export function useAgentEvents(
  sessionId: string | null,
  onSessionNeeded?: () => Promise<string>,
) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    window.shorekeeper.messages.list(sessionId).then((list) => {
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
    });
  }, [sessionId]);

  useEffect(() => {
    let currentRunId: string | null = null;

    const unsubscribe = window.shorekeeper.agent.onEvent((raw) => {
      const event = raw as AgUiEvent;

      if (event.type === 'run_started') {
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

      if (!currentRunId) return;
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

      if (event.type === 'tool_call_start' || event.type === 'tool_call_end') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId && !m.content
              ? { ...m, thinking: true, streaming: true }
              : m,
          ),
        );
      }

      if (event.type === 'run_finished') {
        setIsRunning(false);
        currentRunId = null;
        setMessages((prev) => {
          const streamMsg = prev.find((m) => m.id === streamId);
          const withoutEmpty = prev
            .map((m) =>
              m.id === streamId
                ? { ...m, streaming: false, thinking: false }
                : m,
            )
            .filter((m) => !(m.id === streamId && !m.content.trim()));

          if (sessionId) {
            window.shorekeeper.messages.list(sessionId).then((list) => {
              const dbMessages = list
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .map((m) => ({
                  id: m.id,
                  role: m.role as 'user' | 'assistant',
                  content: m.content,
                  createdAt: m.createdAt,
                }));

              if (dbMessages.length > 0 || !streamMsg?.content.trim()) {
                setMessages(dbMessages);
              }
            });
          }

          return withoutEmpty;
        });
      }

      if (event.type === 'run_error') {
        setIsRunning(false);
        currentRunId = null;
        setError(event.message);
        setMessages((prev) => prev.filter((m) => !m.streaming));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isRunning) return;

    let activeSessionId = sessionId;
    if (!activeSessionId && onSessionNeeded) {
      activeSessionId = await onSessionNeeded();
    }
    if (!activeSessionId) return;

    const userMsg: UiMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setError(null);

    await window.shorekeeper.agent.send({
      sessionId: activeSessionId,
      message: trimmed,
    });
  };

  return { messages, isRunning, error, send };
}
