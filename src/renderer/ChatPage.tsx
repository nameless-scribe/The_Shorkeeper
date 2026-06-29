import { useCallback, useEffect, useState } from 'react';
import type { AppStatus } from '@/shared/types';
import { useAgentEvents } from './hooks/useAgentEvents';
import { AppBackground } from './components/AppBackground';
import { TitleBar } from './components/TitleBar';
import { MessageList } from './components/MessageList';
import { InputBar } from './components/InputBar';

export function ChatPage() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!window.shorekeeper) return;
    window.shorekeeper.app.status().then(setStatus).catch(console.error);
    window.shorekeeper.sessions.current().then((s) => setSessionId(s.id)).catch(console.error);
  }, []);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const session = await window.shorekeeper.sessions.current();
    setSessionId(session.id);
    return session.id;
  }, [sessionId]);

  const { messages, isRunning, error, send } = useAgentEvents(sessionId, ensureSession);

  return (
    <div className="relative h-screen overflow-hidden rounded-3xl border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground />

      <div className="relative z-10 flex h-full flex-col">
        <TitleBar status={status} />
        <MessageList messages={messages} />
        {error && (
          <div className="mx-4 mb-2 rounded-xl border border-red-400/30 bg-red-950/40 px-3 py-2 text-xs text-red-200 no-drag">
            {error}
          </div>
        )}
        <InputBar disabled={isRunning || !status?.apiConfigured} onSend={send} />
      </div>
    </div>
  );
}
