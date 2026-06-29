import { useEffect, useState } from 'react';
import type { AgUiEvent } from '@/shared/types';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
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
          })),
      );
    });
  }, [sessionId]);

  useEffect(() => {
    const unsubscribe = window.shorekeeper.agent.onEvent((raw) => {
      const event = raw as AgUiEvent;

      if (event.type === 'run_started') {
        setIsRunning(true);
        setError(null);
        setMessages((prev) => [
          ...prev,
          { id: `stream-${event.runId}`, role: 'assistant', content: '', streaming: true },
        ]);
      }

      if (event.type === 'text_delta') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `stream-${event.runId}`
              ? { ...m, content: m.content + event.delta }
              : m,
          ),
        );
      }

      if (event.type === 'run_finished') {
        setIsRunning(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `stream-${event.runId}` ? { ...m, streaming: false } : m,
          ),
        );
        if (sessionId) {
          window.shorekeeper.messages.list(sessionId).then((list) => {
            setMessages(
              list
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .map((m) => ({
                  id: m.id,
                  role: m.role as 'user' | 'assistant',
                  content: m.content,
                })),
            );
          });
        }
      }

      if (event.type === 'run_error') {
        setIsRunning(false);
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
